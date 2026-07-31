// src/app/api/cuadre-pollo/route.ts
// Cuadre de Pollo (merma diaria del beneficio). La fórmula NO vive aquí: está en
// src/lib/cuadre-pollo.ts, que es su única fuente.
//
//   GET  ?fecha=YYYY-MM-DD  → el cuadre completo del día
//   POST                    → guarda la captura manual (aves + kg que salieron a corte)
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { construirCuadrePollo } from "@/lib/cuadre-pollo";
import { evaluarExpresion } from "@/lib/expresion-numerica";

export const dynamic = "force-dynamic";

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** El desglose de pesadas tal como se tecleó ("62+62.2+62.5…"). */
const expresion = z.string().max(500).nullable().optional();

const GuardarSchema = z.object({
  fecha: z.string().regex(FECHA_REGEX, { message: "Fecha inválida" }),
  aves_macho: z.number().int().min(0).max(100000),
  aves_hembra: z.number().int().min(0).max(100000),
  kg_corte: z.number().min(0).max(100000),
  kg_corte_especial: z.number().min(0).max(100000),
  kg_pollo_entero: z.number().min(0).max(100000),
  observaciones: z.string().max(1000).nullable().optional(),
  expr_corte: expresion,
  expr_corte_especial: expresion,
  expr_pollo_entero: expresion,
  expr_aves_macho: expresion,
  expr_aves_hembra: expresion,
});

/**
 * El número guardado es la fuente de verdad del cálculo, así que no puede
 * contradecir al desglose que lo acompaña. Si vino expresión, se reevalúa aquí:
 * el servidor no confía en el total que mandó el navegador.
 */
function expresionIncoherente(
  expr: string | null | undefined,
  numero: number
): string | null {
  if (!expr || expr.trim() === "") return null;
  const { valor, valida } = evaluarExpresion(expr);
  if (!valida) return `"${expr}" no es una operación válida`;
  if (Math.abs(valor - numero) > 0.01) {
    return `"${expr}" da ${valor}, no ${numero}`;
  }
  return null;
}

/** admin y produccion, igual que el resto del cuadre físico. */
function sinPermiso(role?: string): boolean {
  return !role || !["admin", "produccion"].includes(role);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (sinPermiso(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    let fecha = req.nextUrl.searchParams.get("fecha") || "";

    if (!FECHA_REGEX.test(fecha)) {
      // Sin fecha válida, hoy en Lima (UTC-5, sin DST).
      const filas = (await sql`
        SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy
      `) as Array<{ hoy: string }>;
      fecha = filas[0]?.hoy ?? new Date().toISOString().slice(0, 10);
    }

    const cuadre = await construirCuadrePollo(sql, fecha);
    return NextResponse.json(cuadre);
  } catch (error) {
    console.error("Error al construir el cuadre de pollo:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (sinPermiso(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const validacion = GuardarSchema.safeParse(body);
    if (!validacion.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: validacion.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const d = validacion.data;

    const incoherencias = [
      expresionIncoherente(d.expr_corte, d.kg_corte),
      expresionIncoherente(d.expr_corte_especial, d.kg_corte_especial),
      expresionIncoherente(d.expr_pollo_entero, d.kg_pollo_entero),
      expresionIncoherente(d.expr_aves_macho, d.aves_macho),
      expresionIncoherente(d.expr_aves_hembra, d.aves_hembra),
    ].filter(Boolean);

    if (incoherencias.length > 0) {
      return NextResponse.json(
        { error: `El desglose no cuadra con el total: ${incoherencias.join("; ")}` },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);
    const limpiar = (v: string | null | undefined): string | null => {
      const t = (v ?? "").trim();
      return t === "" ? null : t;
    };

    // Un cuadre por día: la PK es la fecha, así que guardar dos veces corrige la
    // misma fila en vez de duplicarla.
    await sql`
      INSERT INTO public.cuadre_pollo_dia (
        fecha, aves_macho, aves_hembra,
        kg_corte, kg_corte_especial, kg_pollo_entero,
        expr_corte, expr_corte_especial, expr_pollo_entero,
        expr_aves_macho, expr_aves_hembra,
        observaciones, usuario_id
      ) VALUES (
        ${d.fecha}::date, ${d.aves_macho}, ${d.aves_hembra},
        ${d.kg_corte}, ${d.kg_corte_especial}, ${d.kg_pollo_entero},
        ${limpiar(d.expr_corte)}, ${limpiar(d.expr_corte_especial)}, ${limpiar(d.expr_pollo_entero)},
        ${limpiar(d.expr_aves_macho)}, ${limpiar(d.expr_aves_hembra)},
        ${d.observaciones ?? null}, ${session.user.id}
      )
      ON CONFLICT (fecha) DO UPDATE SET
        aves_macho = EXCLUDED.aves_macho,
        aves_hembra = EXCLUDED.aves_hembra,
        kg_corte = EXCLUDED.kg_corte,
        kg_corte_especial = EXCLUDED.kg_corte_especial,
        kg_pollo_entero = EXCLUDED.kg_pollo_entero,
        expr_corte = EXCLUDED.expr_corte,
        expr_corte_especial = EXCLUDED.expr_corte_especial,
        expr_pollo_entero = EXCLUDED.expr_pollo_entero,
        expr_aves_macho = EXCLUDED.expr_aves_macho,
        expr_aves_hembra = EXCLUDED.expr_aves_hembra,
        observaciones = EXCLUDED.observaciones,
        usuario_id = EXCLUDED.usuario_id,
        updated_at = (NOW() AT TIME ZONE 'America/Lima')
    `;

    // Recalcular con lo recién guardado y devolverlo (evita un GET extra).
    const cuadre = await construirCuadrePollo(sql, d.fecha);

    // Espejo en mermas_diarias: es lo que lee /api/rentabilidad para conocer el
    // rendimiento real del período. Sin esto caería siempre al
    // rendimiento_fallback_pct. Es informativo — NO mueve inventario (doc 09 §7.3).
    // Si falla, el cuadre igual quedó guardado: no se arrastra el error.
    if (cuadre.kgNetoIngresado > 0) {
      try {
        await sql`
          DELETE FROM public.mermas_diarias
          WHERE fecha = ${d.fecha}::date AND compra_id IS NULL
        `;
        await sql`
          INSERT INTO public.mermas_diarias (
            fecha, peso_bruto, peso_limpio, peso_menudencia, merma, porcentaje_merma, usuario_id
          ) VALUES (
            ${d.fecha}::date,
            ${cuadre.kgNetoIngresado},
            ${cuadre.kgTotalSalida},
            0,
            ${cuadre.mermaReal},
            ${cuadre.mermaPct},
            ${session.user.id}
          )
        `;
      } catch (error) {
        console.error("Cuadre guardado, pero falló el espejo en mermas_diarias:", error);
      }
    }

    return NextResponse.json(cuadre);
  } catch (error) {
    console.error("Error al guardar el cuadre de pollo:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
