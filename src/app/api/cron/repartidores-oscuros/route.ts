// src/app/api/cron/repartidores-oscuros/route.ts
// Red de seguridad para detectar motorizados que dejaron de transmitir su ubicación
// teniendo pedidos ACTIVOS hoy. Cubre los apagados que NO alcanzan a mandar beacon
// (app forzada a cerrar, batería muerta, ahorro de batería de marca, sin cobertura).
//
// Clasifica cada rider con pedidos activos:
//   - 'permiso_revocado' / 'mock'  → DELIBERADO (alta confianza)  → rojo en el mapa
//   - sin fila o sin reportar > N min → "sin señal" (ambiguo)     → ámbar en el mapa
// y avisa al admin con debounce por rider (ver lib/repartidor-oscuro.ts).
//
// Fuera del horario operativo NO corre (privacidad: no perseguir de noche por un
// pedido que quedó sin cerrar). Programado cada 5 min en vercel.json.
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { ridersConPedidosActivosHoy } from "@/lib/repartidor-jornada";
import { dentroDeVentanaOperativa } from "@/lib/ventana-operativa";
import { notificarRepartidorOscuro } from "@/lib/repartidor-oscuro";

export const dynamic = "force-dynamic";

const OSCURO_STALE_MIN = 10; // minutos sin reportar ⇒ "sin señal" (ambiguo)

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

  // Fuera del horario operativo: no alertamos (el cliente tampoco rastrea).
  if (!dentroDeVentanaOperativa()) {
    return NextResponse.json({ ok: true, skipped: "fuera de ventana operativa" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const riders = await ridersConPedidosActivosHoy();
    if (riders.length === 0) {
      return NextResponse.json({ ok: true, riders: 0, notificados: 0 });
    }

    // Estado de GPS de TODOS los motorizados (rider_locations es 1 fila por rider,
    // tabla chica). Los que NO aparezcan acá nunca reportaron hoy → "sin señal".
    const filas = (await sql`
      SELECT repartidor_id, gps_status, simulated, updated_at,
             EXTRACT(EPOCH FROM (now() - updated_at)) AS edad_seg
      FROM rider_locations
    `) as Array<{
      repartidor_id: string;
      gps_status: string | null;
      simulated: boolean | null;
      updated_at: string | null;
      edad_seg: string | null;
    }>;
    const estadoPorId = new Map(filas.map((f) => [f.repartidor_id, f]));

    let notificados = 0;
    for (const r of riders) {
      const f = estadoPorId.get(r.id);
      const edadSeg = f?.edad_seg != null ? parseFloat(f.edad_seg) : null;

      let motivo: "permiso_revocado" | "mock" | "sin_senal" | null = null;
      if (f?.gps_status === "permiso_revocado") {
        motivo = "permiso_revocado";
      } else if (f?.simulated === true || f?.gps_status === "mock") {
        motivo = "mock";
      } else if (!f || f.updated_at == null || (edadSeg != null && edadSeg > OSCURO_STALE_MIN * 60)) {
        motivo = "sin_senal";
      }

      if (!motivo) continue;

      const detalle =
        motivo === "sin_senal" && edadSeg != null
          ? `hace ${Math.round(edadSeg / 60)} min`
          : undefined;

      const aviso = await notificarRepartidorOscuro({
        riderId: r.id,
        name: r.name,
        motivo,
        detalle,
      });
      if (aviso) notificados++;
    }

    return NextResponse.json({ ok: true, riders: riders.length, notificados });
  } catch (error) {
    console.error("Error en cron repartidores-oscuros:", error);
    return NextResponse.json({ error: "Error generando alertas de GPS" }, { status: 500 });
  }
}
