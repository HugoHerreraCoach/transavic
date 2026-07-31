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

/** Una línea propia de la usuaria (Corte, Corte especial, Muestras, lo que sea). */
const LineaSchema = z.object({
  seccion: z.enum(["entrada", "salida"]),
  concepto: z.string().trim().min(1).max(120),
  expresion: expresion,
  kilos: z.number().min(0).max(100000),
  jabas: z.number().int().min(0).max(10000).optional().default(0),
  pendiente_registrar: z.boolean().optional().default(false),
});

/**
 * Corrección manual de un total del sistema. El motivo es OBLIGATORIO: un ajuste
 * que Antonio no puede explicar deja de ser un control. `null` = sin corrección.
 */
const AjusteSchema = z
  .object({
    kilos: z.number().min(0).max(100000),
    motivo: z.string().trim().min(3, { message: "Explica por qué lo corriges (mín. 3 letras)" }),
  })
  .nullable()
  .optional();

const GuardarSchema = z.object({
  fecha: z.string().regex(FECHA_REGEX, { message: "Fecha inválida" }),
  aves_macho: z.number().int().min(0).max(100000),
  aves_hembra: z.number().int().min(0).max(100000),
  observaciones: z.string().max(1000).nullable().optional(),
  expr_aves_macho: expresion,
  expr_aves_hembra: expresion,
  lineas: z.array(LineaSchema).max(60).optional().default([]),
  ajuste_campo: AjusteSchema,
  ajuste_planta: AjusteSchema,
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

    // Se descartan las filas que quedaron en blanco (la UI siempre deja una vacía
    // al final para poder seguir tecleando) — mismo criterio que compras-client.
    const lineas = d.lineas.filter((l) => l.concepto.trim() !== "" || l.kilos > 0);

    const incoherencias = [
      expresionIncoherente(d.expr_aves_macho, d.aves_macho),
      expresionIncoherente(d.expr_aves_hembra, d.aves_hembra),
      ...lineas.map((l) => {
        const e = expresionIncoherente(l.expresion, l.kilos);
        return e ? `${l.concepto}: ${e}` : null;
      }),
    ].filter(Boolean);

    if (incoherencias.length > 0) {
      return NextResponse.json(
        { error: `El desglose no cuadra con el total: ${incoherencias.join("; ")}` },
        { status: 400 }
      );
    }

    // Una línea sin concepto no se puede leer después en el PDF.
    const sinConcepto = lineas.find((l) => l.concepto.trim() === "");
    if (sinConcepto) {
      return NextResponse.json(
        { error: "Hay una línea con kilos pero sin nombre. Ponle un concepto o bórrala." },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);
    const limpiar = (v: string | null | undefined): string | null => {
      const t = (v ?? "").trim();
      return t === "" ? null : t;
    };

    // Un cuadre por día: la PK es la fecha, así que guardar dos veces corrige la
    // misma fila en vez de duplicarla. Las líneas se reemplazan por completo
    // (DELETE + INSERT) dentro de la MISMA transacción que la cabecera, para que un
    // guardado a medias no deje el día con las líneas borradas.
    // ⚠️ El batch HTTP de Neon no encadena RETURNING: los ids se generan en JS.
    await sql.transaction([
      sql`
        INSERT INTO public.cuadre_pollo_dia (
          fecha, aves_macho, aves_hembra,
          expr_aves_macho, expr_aves_hembra,
          kg_campo_ajustado, kg_campo_motivo, kg_planta_ajustado, kg_planta_motivo,
          observaciones, usuario_id
        ) VALUES (
          ${d.fecha}::date, ${d.aves_macho}, ${d.aves_hembra},
          ${limpiar(d.expr_aves_macho)}, ${limpiar(d.expr_aves_hembra)},
          ${d.ajuste_campo?.kilos ?? null}, ${d.ajuste_campo?.motivo ?? null},
          ${d.ajuste_planta?.kilos ?? null}, ${d.ajuste_planta?.motivo ?? null},
          ${d.observaciones ?? null}, ${session.user.id}
        )
        ON CONFLICT (fecha) DO UPDATE SET
          aves_macho = EXCLUDED.aves_macho,
          aves_hembra = EXCLUDED.aves_hembra,
          expr_aves_macho = EXCLUDED.expr_aves_macho,
          expr_aves_hembra = EXCLUDED.expr_aves_hembra,
          kg_campo_ajustado = EXCLUDED.kg_campo_ajustado,
          kg_campo_motivo = EXCLUDED.kg_campo_motivo,
          kg_planta_ajustado = EXCLUDED.kg_planta_ajustado,
          kg_planta_motivo = EXCLUDED.kg_planta_motivo,
          observaciones = EXCLUDED.observaciones,
          usuario_id = EXCLUDED.usuario_id,
          updated_at = (NOW() AT TIME ZONE 'America/Lima')
      `,
      sql`DELETE FROM public.cuadre_pollo_lineas WHERE fecha = ${d.fecha}::date`,
      ...lineas.map(
        (l, i) => sql`
          INSERT INTO public.cuadre_pollo_lineas (
            id, fecha, seccion, concepto, expresion, kilos, jabas, pendiente_registrar, orden, usuario_id
          ) VALUES (
            ${crypto.randomUUID()}, ${d.fecha}::date, ${l.seccion}, ${l.concepto.trim()},
            ${limpiar(l.expresion)}, ${l.kilos}, ${l.jabas},
            ${l.seccion === "entrada" ? l.pendiente_registrar : false}, ${i}, ${session.user.id}
          )
        `
      ),
    ]);

    // Recalcular con lo recién guardado y devolverlo (evita un GET extra).
    const cuadre = await construirCuadrePollo(sql, d.fecha);

    // Espejo en mermas_diarias: es lo que lee /api/rentabilidad para conocer el
    // rendimiento real del período. Sin esto caería siempre al
    // rendimiento_fallback_pct. Es informativo — NO mueve inventario (doc 09 §7.3).
    //
    // ⚠️ Tres cuidados, todos aprendidos a la mala:
    //  · Solo se escribe con el día COMPLETO (entrada y salida). Un cuadre guardado a
    //    media mañana, con la compra cargada pero sin ventas, daría merma 100% →
    //    rendimiento 0 → costoRealPorKg = Infinity → Rentabilidad revienta al hacer
    //    .toFixed() sobre el null que produce la serialización JSON.
    //  · `porcentaje_merma` es DECIMAL(5,2): más de 999.99 lanza numeric overflow.
    //  · DELETE + INSERT van en la MISMA transacción: separados, un INSERT fallido
    //    dejaba el día sin fila y el usuario veía "Cuadre guardado" en verde.
    // El DELETE corre siempre, para que un día que se quedó sin compras no arrastre
    // una merma vieja alimentando Rentabilidad.
    try {
      const escribirEspejo = cuadre.kgNetoIngresado > 0 && cuadre.kgTotalSalida > 0;
      const pctAcotado = Math.max(-999, Math.min(999, cuadre.mermaPct));
      await sql.transaction([
        sql`
          DELETE FROM public.mermas_diarias
          WHERE fecha = ${d.fecha}::date AND compra_id IS NULL
        `,
        ...(escribirEspejo
          ? [
              sql`
                INSERT INTO public.mermas_diarias (
                  fecha, peso_bruto, peso_limpio, peso_menudencia, merma, porcentaje_merma, usuario_id
                ) VALUES (
                  ${d.fecha}::date,
                  ${cuadre.kgNetoIngresado},
                  ${cuadre.kgTotalSalida},
                  0,
                  ${cuadre.mermaReal},
                  ${pctAcotado},
                  ${session.user.id}
                )
              `,
            ]
          : []),
      ]);
    } catch (error) {
      // El cuadre ya quedó guardado: no se arrastra el error al usuario.
      console.error("Cuadre guardado, pero falló el espejo en mermas_diarias:", error);
    }

    return NextResponse.json(cuadre);
  } catch (error) {
    console.error("Error al guardar el cuadre de pollo:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
