// src/app/api/facturas/[id]/anular/route.ts
// POST — Anular (soft) una cobranza: pasa a estado 'Anulada' con motivo + rastro
// (quién/cuándo/por qué). NO borra la fila. Para cobranzas creadas por error o
// cuya factura/boleta se anuló con Nota de Crédito.
//
// Permisos (decisión de Antonio, jun 2026 — "darle más poder a la asesora en
// cobranzas"):
//   - Asesora: SOLO las suyas. **NO se exige una Nota de Crédito para anular**:
//     la cobranza es el registro interno de cobro, separado del comprobante
//     fiscal (anularla NO toca el comprobante en SUNAT). Único bloqueo: si ya
//     está Pagada → primero revertir el pago (integridad del cobro).
//   - Admin: cualquiera.
// Queda auditado (anulada_por/at/motivo) y es recuperable (soft-delete; el admin
// las ve con el filtro "Anuladas").
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { anularCobranza } from "@/lib/cobranzas";

export const dynamic = "force-dynamic";

const Schema = z.object({
  motivo: z.string().trim().min(3, "Explica el motivo (mín. 3 caracteres).").max(300),
});

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
      SELECT asesor_id, estado FROM facturas WHERE id = ${id}::uuid
    `) as Array<{ asesor_id: string | null; estado: string }>;
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
