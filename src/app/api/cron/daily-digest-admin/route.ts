// src/app/api/cron/daily-digest-admin/route.ts
// P3.14 — Daily digest a Antonio (admin).
//
// Una sola notificación al día con el resumen que necesita ver de mañana:
//   - Facturas vencidas (total + count)
//   - Facturas que vencen hoy (presión inmediata)
//   - Comprobantes en error / rechazado (necesitan reintento o NC)
//   - Pedidos pendientes sin asignar
//
// Diseño: el cron diario de Vercel pega a este endpoint, que arma el
// resumen y le pasa UNA notificación a cada admin. NO spamea — si no hay
// nada relevante (ningún dato > 0), no notifica.
//
// Se programa para las 8 AM Lima (= 13 UTC). Antonio lee el resumen mientras
// arranca el día.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { crearNotificacion, limpiarNotificacionesAntiguas } from "@/lib/notificaciones";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

    // 0) Mantenimiento — purgar notificaciones LEÍDAS de más de 30 días para que
    //    la tabla no crezca sin límite. Va acá (piggyback en un cron diario que
    //    ya existe) en vez de crear un cron nuevo, para no sumar otro job a
    //    Vercel. Corre ANTES del posible return temprano de abajo, así se ejecuta
    //    todos los días aunque no haya señales para el digest. Best-effort.
    const notifsPurgadas = await limpiarNotificacionesAntiguas(30);
    if (notifsPurgadas > 0) {
      console.log(
        `[daily-digest-admin] Notificaciones purgadas (leídas > 30 días): ${notifsPurgadas}`
      );
    }

    // 1) Vencidas — ya marcadas como Vencida por el cron facturas-vencidas
    //    (que corre 1h antes, a las 13 UTC). Acá solo agregamos.
    const vencidasRow = (await sql`
      SELECT COUNT(*)::int AS cnt, COALESCE(SUM(monto), 0)::numeric AS total
      FROM facturas
      WHERE estado = 'Vencida'
    `) as Array<{ cnt: number; total: string | number }>;
    const vencidas = vencidasRow[0] ?? { cnt: 0, total: 0 };

    // 2) Vencen HOY (presión inmediata — todavía pendientes).
    const venceHoyRow = (await sql`
      SELECT COUNT(*)::int AS cnt, COALESCE(SUM(monto), 0)::numeric AS total
      FROM facturas
      WHERE fecha_vencimiento = (NOW() AT TIME ZONE 'America/Lima')::date
        AND estado = 'Pendiente'
    `) as Array<{ cnt: number; total: string | number }>;
    const venceHoy = venceHoyRow[0] ?? { cnt: 0, total: 0 };

    // 3) Comprobantes con problema en los últimos 7 días (error o rechazado).
    //    Ignoramos los muy antiguos para no acumular ruido.
    const comprobantesError = (await sql`
      SELECT COUNT(*)::int AS cnt
      FROM comprobantes
      WHERE estado IN ('error', 'rechazado')
        AND created_at >= (NOW() AT TIME ZONE 'America/Lima' - INTERVAL '7 days')
    `) as Array<{ cnt: number }>;
    const errores = comprobantesError[0]?.cnt ?? 0;

    // 4) Pedidos pendientes sin asignar (operación).
    const pendSinAsignar = (await sql`
      SELECT COUNT(*)::int AS cnt
      FROM pedidos
      WHERE estado = 'Pendiente'
        AND fecha_pedido >= (NOW() AT TIME ZONE 'America/Lima')::date
    `) as Array<{ cnt: number }>;
    const pendientes = pendSinAsignar[0]?.cnt ?? 0;

    // Si NO hay nada que reportar, no spameamos al admin.
    const totalSenales =
      vencidas.cnt + venceHoy.cnt + errores + pendientes;
    if (totalSenales === 0) {
      return NextResponse.json({
        digestEnviado: false,
        motivo: "Sin señales relevantes hoy",
        notificacionesPurgadas: notifsPurgadas,
        timestamp: new Date().toISOString(),
      });
    }

    // 5) Armamos el mensaje. Lo dejamos compacto — la notificación es un
    //    pop-up corto. Si quieren detalle, abren /dashboard/cobranzas o
    //    /dashboard/comprobantes desde el link.
    const partes: string[] = [];
    if (vencidas.cnt > 0) {
      partes.push(
        `🔴 ${vencidas.cnt} factura${vencidas.cnt === 1 ? "" : "s"} vencida${vencidas.cnt === 1 ? "" : "s"} (S/ ${Number(vencidas.total).toFixed(2)})`
      );
    }
    if (venceHoy.cnt > 0) {
      partes.push(
        `🟡 ${venceHoy.cnt} vence${venceHoy.cnt === 1 ? "" : "n"} HOY (S/ ${Number(venceHoy.total).toFixed(2)})`
      );
    }
    if (errores > 0) {
      partes.push(
        `❌ ${errores} comprobante${errores === 1 ? "" : "s"} con error / rechazo (últimos 7 días)`
      );
    }
    if (pendientes > 0) {
      partes.push(
        `📦 ${pendientes} pedido${pendientes === 1 ? "" : "s"} pendiente${pendientes === 1 ? "" : "s"} de asignar`
      );
    }
    const mensaje = partes.join(" · ");

    // 6) Notificar a TODOS los admins (puede haber más de uno en algún momento).
    //    Linkeamos por defecto a cobranzas (lo más urgente que toca dinero).
    const linkSugerido =
      vencidas.cnt > 0 || venceHoy.cnt > 0
        ? "/dashboard/cobranzas"
        : errores > 0
          ? "/dashboard/comprobantes"
          : "/dashboard/despacho";

    const admins = (await sql`SELECT id FROM users WHERE role = 'admin'`) as Array<{
      id: string;
    }>;
    for (const a of admins) {
      await crearNotificacion({
        userId: a.id,
        tipo: "factura_vencida", // reusamos el tipo existente — el ícono encaja
        titulo: "📊 Resumen del día",
        mensaje,
        link: linkSugerido,
      });
    }

    return NextResponse.json({
      digestEnviado: true,
      destinatarios: admins.length,
      notificacionesPurgadas: notifsPurgadas,
      senales: {
        vencidas: vencidas.cnt,
        venceHoy: venceHoy.cnt,
        comprobantesError: errores,
        pedidosPendientes: pendientes,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error en cron daily-digest-admin:", error);
    return NextResponse.json(
      { error: "Error generando digest" },
      { status: 500 }
    );
  }
}
