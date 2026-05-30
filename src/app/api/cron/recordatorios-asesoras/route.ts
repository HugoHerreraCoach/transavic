// src/app/api/cron/recordatorios-asesoras/route.ts
// Cron diario que envía recordatorios proactivos a las asesoras:
//   1. Si su meta diaria está < 50% al mediodía → "te falta vender X para tu meta"
//   2. Clientes que NO compraron en los últimos 14 días → "contactar"
//   3. Facturas suyas por vencer en próximos 3 días → "coordinar cobranza"
//
// Configurar en vercel.json (12:00 Lima = 17:00 UTC):
//   { "path": "/api/cron/recordatorios-asesoras", "schedule": "0 17 * * *" }

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { crearNotificacion } from "@/lib/notificaciones";
import { calcularMetaDiaria, ventasMesActual } from "@/lib/metas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET no configurado" },
      { status: 503 }
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Traer todas las asesoras activas
  const asesoras = (await sql`
    SELECT id, name FROM users WHERE role = 'asesor'
  `) as Array<{ id: string; name: string }>;

  const recordatoriosEnviados: Array<{
    asesora: string;
    tipo: string;
    mensaje: string;
  }> = [];

  for (const asesora of asesoras) {
    // 1. Meta del día: si está atrasada, recordar
    try {
      const meta = await calcularMetaDiaria(asesora.id);
      const ventas = await ventasMesActual(asesora.id);
      const diasRest = Math.max(0, meta.diasHabilesMes - meta.diaDelMes);
      const ritmoNecesario =
        diasRest > 0 ? Math.max(0, (meta.metaMensual - ventas) / diasRest) : 0;
      const porcentajeMes =
        meta.metaMensual > 0 ? (ventas / meta.metaMensual) * 100 : 100;

      if (meta.metaMensual > 0 && porcentajeMes < 50 && meta.diaDelMes >= 5) {
        await crearNotificacion({
          userId: asesora.id,
          tipo: "meta_atrasada",
          titulo: "🎯 Tu meta mensual",
          mensaje: `Vas en ${porcentajeMes.toFixed(0)}% de tu meta. Necesitas vender ~S/ ${ritmoNecesario.toFixed(0)} por día para alcanzarla.`,
          link: "/dashboard/mis-metas",
        });
        recordatoriosEnviados.push({
          asesora: asesora.name,
          tipo: "meta_atrasada",
          mensaje: `${porcentajeMes.toFixed(0)}% de meta`,
        });
      }
    } catch (e) {
      console.error(`Error con meta de ${asesora.name}:`, e);
    }

    // 2. Clientes que no compraron en últimos 14 días (top 3 por gasto histórico)
    try {
      const clientesInactivos = (await sql`
        WITH cs AS (
          SELECT p.cliente_id, p.cliente AS nombre,
            MAX(p.fecha_pedido) AS ultimo,
            SUM(COALESCE(
              (SELECT SUM(COALESCE(pi.subtotal_real, pi.subtotal, 0))
               FROM pedido_items pi WHERE pi.pedido_id = p.id),
              0
            )) AS gastado
          FROM pedidos p
          WHERE p.estado = 'Entregado' AND p.cliente_id IS NOT NULL
            AND p.asesor_id = ${asesora.id}::uuid
          GROUP BY p.cliente_id, p.cliente
          HAVING COUNT(*) >= 2
        )
        SELECT nombre, gastado,
          ((NOW() AT TIME ZONE 'America/Lima')::date - ultimo)::int AS dias_sin_comprar
        FROM cs
        WHERE ((NOW() AT TIME ZONE 'America/Lima')::date - ultimo) BETWEEN 14 AND 21
        ORDER BY gastado DESC LIMIT 3
      `) as Array<{
        nombre: string;
        gastado: string | number;
        dias_sin_comprar: number;
      }>;

      if (clientesInactivos.length > 0) {
        const top = clientesInactivos[0];
        await crearNotificacion({
          userId: asesora.id,
          tipo: "cliente_inactivo",
          titulo: "📞 Cliente para reactivar",
          mensaje: `${top.nombre} lleva ${top.dias_sin_comprar} días sin comprar (histórico S/ ${Number(top.gastado).toFixed(0)}). ¿Lo contactas hoy?`,
          link: "/dashboard/asistente-ia",
        });
        recordatoriosEnviados.push({
          asesora: asesora.name,
          tipo: "cliente_inactivo",
          mensaje: `${top.nombre} (${top.dias_sin_comprar}d)`,
        });
      }
    } catch (e) {
      console.error(`Error con clientes inactivos de ${asesora.name}:`, e);
    }

    // 3. Facturas por vencer en los próximos 3 días
    try {
      const facturasPorVencer = (await sql`
        SELECT cliente_nombre, monto,
          TO_CHAR(fecha_vencimiento, 'DD/MM') AS fecha_venc
        FROM facturas
        WHERE asesor_id = ${asesora.id}::uuid
          AND estado = 'Pendiente'
          AND fecha_pago IS NULL
          AND fecha_vencimiento BETWEEN (NOW() AT TIME ZONE 'America/Lima')::date
            AND ((NOW() AT TIME ZONE 'America/Lima')::date + INTERVAL '3 days')::date
        ORDER BY fecha_vencimiento ASC
        LIMIT 5
      `) as Array<{
        cliente_nombre: string;
        monto: string | number;
        fecha_venc: string;
      }>;

      for (const f of facturasPorVencer) {
        await crearNotificacion({
          userId: asesora.id,
          tipo: "factura_por_vencer",
          titulo: "💰 Factura por vencer",
          mensaje: `${f.cliente_nombre}: S/ ${Number(f.monto).toFixed(2)} vence el ${f.fecha_venc}. Coordina cobranza.`,
          link: "/dashboard/cobranzas",
        });
      }
      if (facturasPorVencer.length > 0) {
        recordatoriosEnviados.push({
          asesora: asesora.name,
          tipo: "facturas_por_vencer",
          mensaje: `${facturasPorVencer.length} factura(s) próximas a vencer`,
        });
      }
    } catch (e) {
      console.error(`Error con facturas de ${asesora.name}:`, e);
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    asesoras_revisadas: asesoras.length,
    recordatorios_enviados: recordatoriosEnviados.length,
    detalle: recordatoriosEnviados,
  });
}
