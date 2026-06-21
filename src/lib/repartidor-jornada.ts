// src/lib/repartidor-jornada.ts
// "Jornada" del repartidor: la regla que define cuándo el GPS es OBLIGATORIO.
//
// Un repartidor está "en jornada" mientras tenga al menos un pedido ACTIVO del día,
// donde activo = estado IN ('Asignado','En_Camino') y fecha_pedido = HOY (Lima).
// Esta es la ÚNICA definición; la comparten el endpoint de ubicación/beacon y el
// cron de detección de "repartidor oscuro" para que no haya drift entre ellos.
//
// (El corte horario de privacidad — no rastrear de noche — vive aparte en
//  src/lib/ventana-operativa.ts, que es puro y también lo usa el cliente.)
//
// Server-only: instancia el cliente HTTP de Neon por llamada (es seguro reinstanciar,
// no es un pool — ver CLAUDE.md §10).
import { neon } from "@neondatabase/serverless";

/** ¿Este repartidor tiene pedidos activos (Asignado/En_Camino) hoy en Lima? */
export async function tienePedidosActivosHoy(repartidorId: string): Promise<boolean> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT 1
    FROM pedidos
    WHERE repartidor_id = ${repartidorId}
      AND estado IN ('Asignado', 'En_Camino')
      AND fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
    LIMIT 1
  `;
  return rows.length > 0;
}

/** Repartidores con al menos un pedido activo hoy (para el cron de detección). */
export async function ridersConPedidosActivosHoy(): Promise<Array<{ id: string; name: string }>> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT DISTINCT u.id, u.name
    FROM pedidos p
    JOIN users u ON u.id = p.repartidor_id
    WHERE p.estado IN ('Asignado', 'En_Camino')
      AND p.fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
      AND u.role = 'repartidor'
  `;
  return rows.map((r) => ({ id: r.id as string, name: ((r.name as string) ?? "").trim() }));
}
