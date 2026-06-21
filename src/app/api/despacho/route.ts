// src/app/api/despacho/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fechaHoyLima } from "@/lib/sunat/fechas";
import { ridersConPedidosActivosHoy } from "@/lib/repartidor-jornada";

export const dynamic = "force-dynamic";

// Un motorizado CON pedidos activos cuya última ubicación tenga más de esto sin
// actualizarse se considera "sin señal" (oscuro ambiguo) en el mapa.
const OSCURO_STALE_MS = 10 * 60 * 1000;

export async function GET() {
  try {
    const session = await auth();
    // Despacho lo leen admin (gestión) y asesor (SOLO LECTURA: monitorea
    // motorizados y entregas en vivo). El alcance es total — la asesora ve
    // todos los pedidos y motorizados, igual que el admin. Las MUTACIONES
    // (asignar/optimizar/reordenar/asignar-externo) siguen siendo admin-only
    // en sus propios endpoints, así que esto no le da poder de gestión.
    const rol = session?.user?.role;
    if (!session?.user || (rol !== "admin" && rol !== "asesor")) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    // 0. Obtener ubicación base
    const baseResult = await sql`SELECT value FROM settings WHERE key = 'base_location'`;
    const baseLocation = baseResult.length > 0
      ? baseResult[0].value
      : { lat: -12.0464, lng: -77.0428, address: "Centro de Lima", name: "Local Principal" };

    // 0b. Obtener rutas bloqueadas para el día de hoy
    const hoy = fechaHoyLima();
    const rutasBloqueadasResult = await sql`SELECT value FROM settings WHERE key = 'despacho_rutas_bloqueadas'`;
    let rutasBloqueadas: string[] = [];
    if (rutasBloqueadasResult.length > 0) {
      const val = rutasBloqueadasResult[0].value as { fecha: string; bloqueados: string[] };
      if (val.fecha === hoy && Array.isArray(val.bloqueados)) {
        rutasBloqueadas = val.bloqueados;
      }
    }

    // 1. Pedidos del día de hoy sin asignar (Pendientes)
    const pendientes = await sql`
      SELECT
        p.id, p.cliente, p.direccion, p.distrito, p.whatsapp,
        p.latitude, p.longitude, p.estado, p.orden_ruta,
        p.hora_entrega, p.hora_llegada_estimada, p.inicio_viaje_at,
        p.razon_fallo, p.detalle, p.notas, p.empresa, p.fecha_pedido,
        p.distancia_km, p.duracion_estimada_min, p.numero_guia,
        EXISTS (
          SELECT 1 FROM comprobantes_guias g
          WHERE g.pedido_id = p.id AND g.estado IN ('aceptado', 'observado')
        ) AS tiene_gre
      FROM pedidos p
      WHERE p.fecha_pedido = (NOW() AT TIME ZONE 'America/Lima')::date
        AND p.estado IN ('Pendiente', 'Listo_Para_Despacho')
        AND p.repartidor_id IS NULL
        AND (p.es_delivery_externo = false OR p.es_delivery_externo IS NULL)
      ORDER BY p.created_at ASC
    `;

    // 2. Pedidos de la semana (lunes a ayer) sin completar y sin asignar
    const pendientesAnteriores = await sql`
      SELECT
        p.id, p.cliente, p.direccion, p.distrito, p.whatsapp,
        p.latitude, p.longitude, p.estado, p.orden_ruta,
        p.hora_entrega, p.hora_llegada_estimada, p.inicio_viaje_at,
        p.razon_fallo, p.detalle, p.notas, p.empresa, p.fecha_pedido,
        p.distancia_km, p.duracion_estimada_min, p.numero_guia,
        EXISTS (
          SELECT 1 FROM comprobantes_guias g
          WHERE g.pedido_id = p.id AND g.estado IN ('aceptado', 'observado')
        ) AS tiene_gre
      FROM pedidos p
      WHERE p.fecha_pedido >= date_trunc('week', (NOW() AT TIME ZONE 'America/Lima')::date)
        AND p.fecha_pedido < (NOW() AT TIME ZONE 'America/Lima')::date
        AND p.estado NOT IN ('Entregado', 'Fallido')
        AND p.repartidor_id IS NULL
        AND (p.es_delivery_externo = false OR p.es_delivery_externo IS NULL)
      ORDER BY p.fecha_pedido DESC, p.created_at ASC
    `;

    // 2b. Pedidos asignados a delivery externo (hoy + semana)
    const pedidosExternos = await sql`
      SELECT
        p.id, p.cliente, p.direccion, p.distrito, p.whatsapp,
        p.latitude, p.longitude, p.estado, p.orden_ruta,
        p.hora_entrega, p.hora_llegada_estimada, p.inicio_viaje_at,
        p.razon_fallo, p.detalle, p.notas, p.empresa, p.fecha_pedido,
        p.es_delivery_externo, p.delivery_externo_nombre,
        p.distancia_km, p.duracion_estimada_min, p.numero_guia,
        EXISTS (
          SELECT 1 FROM comprobantes_guias g
          WHERE g.pedido_id = p.id AND g.estado IN ('aceptado', 'observado')
        ) AS tiene_gre
      FROM pedidos p
      WHERE p.fecha_pedido >= date_trunc('week', (NOW() AT TIME ZONE 'America/Lima')::date)
        AND p.es_delivery_externo = true
        AND p.estado NOT IN ('Entregado', 'Fallido')
      ORDER BY p.created_at DESC
    `;

    // 3. Repartidores activos con sus pedidos del día
    const repartidores = await sql`
      SELECT id, name, role FROM users WHERE role = 'repartidor' ORDER BY name ASC
    `;

    // 3b. Última ubicación en vivo de cada motorizado (tabla rider_locations).
    //     Es modelo "1 fila por rider" (UPSERT), así que cada fila ya es la posición
    //     ACTUAL. El frontend decide si está fresca según captured_at ("hace N min").
    //     Tolerante a que la tabla todavía no exista en este entorno (p. ej.
    //     antes de correr la migración en producción): si la consulta falla,
    //     simplemente no hay motos en vivo y TODO el resto del mapa de despacho
    //     sigue funcionando. Así el deploy no depende del orden de la migración.
    const ubicPorRider = new Map<
      string,
      {
        lat: number;
        lng: number;
        heading: number | null;
        capturedAt: string;
        updatedAt: string;
        gpsStatus: string | null;
        simulated: boolean;
      }
    >();
    try {
      const ubicaciones = await sql`
        SELECT repartidor_id, latitude, longitude, heading, captured_at,
               updated_at, gps_status, simulated
        FROM rider_locations
      `;
      for (const u of ubicaciones) {
        ubicPorRider.set(u.repartidor_id as string, {
          lat: parseFloat(u.latitude as string),
          lng: parseFloat(u.longitude as string),
          heading: u.heading != null ? parseFloat(u.heading as string) : null,
          capturedAt: String(u.captured_at),
          updatedAt: String(u.updated_at),
          gpsStatus: (u.gps_status as string | null) ?? null,
          simulated: u.simulated === true,
        });
      }
    } catch (e) {
      console.warn("rider_locations no disponible (¿falta migración?):", e);
    }

    // Repartidores con pedidos activos HOY (Asignado/En_Camino): solo a ellos les
    // exigimos transmitir, así que solo ellos pueden quedar "oscuros".
    const idsConPedidosActivos = new Set(
      (await ridersConPedidosActivosHoy()).map((r) => r.id)
    );

    const pedidosAsignados = await sql`
      SELECT
        p.id, p.cliente, p.direccion, p.distrito, p.whatsapp,
        p.latitude, p.longitude, p.estado, p.orden_ruta,
        p.hora_entrega, p.hora_llegada_estimada, p.inicio_viaje_at,
        p.razon_fallo, p.detalle, p.notas, p.empresa, p.fecha_pedido,
        p.repartidor_id, p.distancia_km, p.duracion_estimada_min, p.numero_guia,
        EXISTS (
          SELECT 1 FROM comprobantes_guias g
          WHERE g.pedido_id = p.id AND g.estado IN ('aceptado', 'observado')
        ) AS tiene_gre
      FROM pedidos p
      WHERE p.fecha_pedido >= date_trunc('week', (NOW() AT TIME ZONE 'America/Lima')::date)
        AND p.repartidor_id IS NOT NULL
      ORDER BY
        CASE 
          WHEN p.estado IN ('Entregado', 'Fallido') THEN 1 
          ELSE 0 
        END,
        p.orden_ruta ASC NULLS LAST,
        p.created_at ASC
    `;

    const parseCoords = (p: Record<string, unknown>) => ({
      ...p,
      latitude: p.latitude ? parseFloat(p.latitude as string) : null,
      longitude: p.longitude ? parseFloat(p.longitude as string) : null,
      distancia_km: p.distancia_km ? parseFloat(p.distancia_km as string) : null,
      duracion_estimada_min: p.duracion_estimada_min ? parseInt(p.duracion_estimada_min as string) : null,
    });

    // Agrupar pedidos por repartidor (+ adjuntar su última ubicación en vivo y la
    // clasificación de "oscuro" para el mapa).
    const ahoraMs = Date.now();
    const repartidoresConPedidos = repartidores.map((r) => {
      const ubic = ubicPorRider.get(r.id as string) ?? null;
      const tienePedidosActivos = idsConPedidosActivos.has(r.id as string);

      // alerta:
      //   'deliberado' → revocó permiso o GPS simulado (alta confianza)  → rojo
      //   'sin_senal'  → con pedidos activos pero sin reportar (ambiguo)  → ámbar
      let alerta: "deliberado" | "sin_senal" | null = null;
      if (tienePedidosActivos) {
        if (
          ubic &&
          (ubic.gpsStatus === "permiso_revocado" ||
            ubic.simulated === true ||
            ubic.gpsStatus === "mock")
        ) {
          alerta = "deliberado";
        } else {
          const edadMs = ubic ? ahoraMs - new Date(ubic.updatedAt).getTime() : Infinity;
          if (!ubic || edadMs > OSCURO_STALE_MS) alerta = "sin_senal";
        }
      }

      return {
        ...r,
        ubicacion: ubic,
        tienePedidosActivos,
        alerta,
        pedidos: pedidosAsignados
          .filter((p) => p.repartidor_id === r.id)
          .map(parseCoords),
      };
    });

    return NextResponse.json({
      pendientes: pendientes.map(parseCoords),
      pendientesAnteriores: pendientesAnteriores.map(parseCoords),
      pedidosExternos: pedidosExternos.map(parseCoords),
      repartidores: repartidoresConPedidos,
      baseLocation,
      rutasBloqueadas,
    });
  } catch (error) {
    console.error("Error en despacho:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

