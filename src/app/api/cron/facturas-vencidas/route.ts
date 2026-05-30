// src/app/api/cron/facturas-vencidas/route.ts
// Endpoint para Vercel Cron — corre diariamente y:
//   1. Marca como "Vencida" las facturas Pendientes cuya fecha pasó.
//   2. Notifica a la asesora de cada factura recién vencida.
//   3. Recordatorio a la asesora para facturas que vencen mañana.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { crearNotificacion } from "@/lib/notificaciones";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Vercel Cron envía Authorization: Bearer ${CRON_SECRET}.
  // CRON_SECRET es OBLIGATORIO — si la env var no está definida, rechazar.
  // Antes había `if (CRON_SECRET && authHeader !== ...)`, que dejaba el
  // endpoint público cuando la env var faltaba. Eso permitía spam de
  // notificaciones a las asesoras desde cualquier visitante anónimo.
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET no configurado en el servidor" },
      { status: 503 }
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // 1. Marcar como Vencida las facturas Pendientes cuya fecha pasó
    const vencidas = (await sql`
      UPDATE facturas
      SET estado = 'Vencida'
      WHERE fecha_vencimiento < (NOW() AT TIME ZONE 'America/Lima')::date
        AND fecha_pago IS NULL
        AND estado = 'Pendiente'
      RETURNING id, asesor_id, cliente_nombre, monto,
        TO_CHAR(fecha_vencimiento, 'DD/MM/YYYY') AS fecha_venc
    `) as Array<{
      id: string;
      asesor_id: string | null;
      cliente_nombre: string;
      monto: string | number;
      fecha_venc: string;
    }>;

    // 2. Notificar a las asesoras
    for (const f of vencidas) {
      if (!f.asesor_id) continue;
      await crearNotificacion({
        userId: f.asesor_id,
        tipo: "factura_vencida",
        titulo: "⚠️ Factura vencida",
        mensaje: `${f.cliente_nombre}: S/ ${Number(f.monto).toFixed(2)} venció el ${f.fecha_venc}`,
        link: "/dashboard/cobranzas",
      });
    }

    // 3. Recordatorio para facturas que vencen mañana
    const venceMañana = (await sql`
      SELECT id, asesor_id, cliente_nombre, monto
      FROM facturas
      WHERE fecha_vencimiento = ((NOW() AT TIME ZONE 'America/Lima')::date + INTERVAL '1 day')::date
        AND fecha_pago IS NULL
        AND estado = 'Pendiente'
    `) as Array<{
      id: string;
      asesor_id: string | null;
      cliente_nombre: string;
      monto: string | number;
    }>;

    for (const f of venceMañana) {
      if (!f.asesor_id) continue;
      await crearNotificacion({
        userId: f.asesor_id,
        tipo: "factura_por_vencer",
        titulo: "📅 Factura vence mañana",
        mensaje: `${f.cliente_nombre}: S/ ${Number(f.monto).toFixed(2)} vence mañana — coordiná cobranza`,
        link: "/dashboard/cobranzas",
      });
    }

    return NextResponse.json({
      procesadas: vencidas.length,
      recordatorios: venceMañana.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error en cron facturas-vencidas:", error);
    return NextResponse.json(
      { error: "Error procesando facturas" },
      { status: 500 }
    );
  }
}
