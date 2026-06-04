// src/app/api/facturas/[id]/anular/route.ts
// POST — Anular (soft) una cobranza: pasa a estado 'Anulada' con motivo + rastro
// (quién/cuándo/por qué). NO borra la fila. Para cobranzas creadas por error o
// cuya factura/boleta se anuló con Nota de Crédito.
//
// Permisos (decisión de Antonio, jun 2026 — "darle más poder a la asesora, pero
// solo en las seguras"):
//   - Asesora: SOLO las suyas, y solo las "seguras":
//       · NO si ya está Pagada → primero revertir el pago.
//       · NO si respalda una factura/boleta VIGENTE (aceptada/observada sin NC)
//         → ahí lo correcto es emitir la Nota de Crédito, que la anula sola.
//   - Admin: cualquiera (puede override la guarda de "vigente"; a veces la
//     cobranza es un duplicado real).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { anularCobranza } from "@/lib/cobranzas";

export const dynamic = "force-dynamic";

const Schema = z.object({
  motivo: z.string().trim().min(3, "Explica el motivo (mín. 3 caracteres).").max(300),
});

interface FacturaRow {
  asesor_id: string | null;
  estado: string;
  comprobante_id: string | null;
  numero_comprobante: string | null;
  pedido_id: string | null;
}

/**
 * Busca el comprobante (factura/boleta) que respalda la cobranza y dice si sigue
 * VIGENTE (aceptado/observado) y si ya tiene una Nota de Crédito que lo acredita.
 * Devuelve null si no hay comprobante ligado o si ya no está vigente. Usa el
 * vínculo SÓLIDO por empresa (comprobante_id, o numero_comprobante + pedido_id);
 * la serie-número sola es ambigua porque las dos empresas comparten F001/B001.
 */
async function comprobanteVigenteSinNC(
  f: FacturaRow
): Promise<{ serieNumero: string } | null> {
  const sql = neon(process.env.DATABASE_URL!);

  let comp: { id: string; serie_numero: string; estado: string } | undefined;
  if (f.comprobante_id) {
    comp = (
      (await sql`
        SELECT id, serie_numero, estado FROM comprobantes
        WHERE id = ${f.comprobante_id}::uuid LIMIT 1
      `) as Array<{ id: string; serie_numero: string; estado: string }>
    )[0];
  } else if (f.numero_comprobante) {
    // Sin comprobante_id: matcheamos por serie-número. Si la cobranza viene de un
    // pedido, lo acotamos por pedido_id (desambigua la empresa). Excluimos las NC.
    comp = (
      f.pedido_id
        ? ((await sql`
            SELECT id, serie_numero, estado FROM comprobantes
            WHERE serie_numero = ${f.numero_comprobante}
              AND pedido_id = ${f.pedido_id}::uuid AND tipo <> '07'
            ORDER BY created_at DESC LIMIT 1
          `) as Array<{ id: string; serie_numero: string; estado: string }>)
        : ((await sql`
            SELECT id, serie_numero, estado FROM comprobantes
            WHERE serie_numero = ${f.numero_comprobante} AND tipo <> '07'
            ORDER BY created_at DESC LIMIT 1
          `) as Array<{ id: string; serie_numero: string; estado: string }>)
    )[0];
  }

  if (!comp) return null;
  // Solo bloqueamos si el comprobante sigue vigente.
  if (comp.estado !== "aceptado" && comp.estado !== "observado") return null;

  // ¿Ya tiene una NC aceptada/observada que lo acredita? Entonces NO bloqueamos.
  const nc = (await sql`
    SELECT 1 FROM comprobantes
    WHERE referencia_comprobante_id = ${comp.id}::uuid
      AND tipo = '07' AND estado IN ('aceptado', 'observado')
    LIMIT 1
  `) as Array<unknown>;
  if (nc.length > 0) return null;

  return { serieNumero: comp.serie_numero };
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const rol = session.user.role;
    if (rol !== "admin" && rol !== "asesor") {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 2]; // /api/facturas/[id]/anular

    const body = await request.json().catch(() => ({}));
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { motivo } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);
    const rows = (await sql`
      SELECT asesor_id, estado, comprobante_id, numero_comprobante, pedido_id
      FROM facturas WHERE id = ${id}::uuid
    `) as Array<FacturaRow>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Cobranza no encontrada" }, { status: 404 });
    }
    const f = rows[0];

    // Propiedad: la asesora solo anula las suyas.
    if (rol === "asesor" && f.asesor_id !== session.user.id) {
      return NextResponse.json({ error: "Esta cobranza no es tuya." }, { status: 403 });
    }

    // Idempotente: ya anulada → ok (sin error, para que la UI no rompa).
    if (f.estado === "Anulada") {
      return NextResponse.json({ ok: true, yaAnulada: true });
    }

    // Pagada → no se anula directo (implicaría una devolución). Revertir primero.
    if (f.estado === "Pagada") {
      return NextResponse.json(
        {
          error:
            "Esta cobranza ya está pagada. Si fue un error, primero revierte el pago y luego anúlala.",
        },
        { status: 409 }
      );
    }

    // Guarda "factura vigente sin NC" — solo para la asesora. El admin puede
    // override (a veces la cobranza es un duplicado real).
    if (rol === "asesor") {
      const vigente = await comprobanteVigenteSinNC(f);
      if (vigente) {
        return NextResponse.json(
          {
            error: `Esta cobranza corresponde a ${vigente.serieNumero}, una factura/boleta vigente. Para anularla, emite primero la Nota de Crédito desde Comprobantes — eso anula la cobranza sola.`,
          },
          { status: 409 }
        );
      }
    }

    await anularCobranza({
      id,
      motivo,
      anuladaPor: session.user.name?.trim() || "—",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error en POST /api/facturas/[id]/anular:", error);
    return NextResponse.json(
      { error: "Error al anular la cobranza" },
      { status: 500 }
    );
  }
}
