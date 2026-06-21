// src/app/api/repartidor/beacon/route.ts
// La app del repartidor avisa que SE APAGÓ el GPS por una causa DELIBERADA y
// detectable (revocó el permiso de ubicación, o el GPS quedó apagado a nivel del
// SO). A diferencia de /ubicacion, este endpoint NO trae coordenadas: solo registra
// el estado del GPS y, si corresponde, dispara un aviso inmediato al admin.
//
// Es la señal FUERTE de apagado deliberado. La ausencia de reportes a secas es
// ambigua (túnel, cobertura) y la cubre el cron repartidores-oscuros como "sin señal".
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { tienePedidosActivosHoy } from "@/lib/repartidor-jornada";
import { dentroDeVentanaOperativa } from "@/lib/ventana-operativa";
import { notificarRepartidorOscuro } from "@/lib/repartidor-oscuro";

export const dynamic = "force-dynamic";

const Schema = z.object({
  evento: z.enum(["permiso_revocado", "gps_off"]),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (session.user.role !== "repartidor") {
    return NextResponse.json(
      { error: "Solo los motorizados reportan estado de GPS." },
      { status: 403 }
    );
  }

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { evento } = parsed.data;
  // 'permiso_revocado' es la señal más fuerte; 'gps_off' (ubicación del SO apagada)
  // lo guardamos como "sin_senal" porque no podemos distinguirlo con certeza de la
  // falta de cobertura una vez muerto el watcher.
  const gpsStatus = evento === "permiso_revocado" ? "permiso_revocado" : "sin_senal";

  try {
    const sql = neon(process.env.DATABASE_URL!);
    // Solo el estado; NO toca la última posición. No-op si el rider aún no tiene
    // fila (nunca reportó) — ese caso lo detecta el cron por ausencia de reportes.
    await sql`
      UPDATE rider_locations
      SET gps_status = ${gpsStatus},
          gps_status_changed_at = CASE WHEN gps_status IS DISTINCT FROM ${gpsStatus} THEN now() ELSE gps_status_changed_at END
      WHERE repartidor_id = ${session.user.id}
    `;

    // Aviso INMEDIATO al admin si revocó el permiso teniendo pedidos activos y
    // estamos en horario operativo (con debounce). El cron es la red de seguridad
    // para los apagados que no alcanzan a mandar beacon (app forzada a cerrar, etc.).
    if (evento === "permiso_revocado" && dentroDeVentanaOperativa()) {
      if (await tienePedidosActivosHoy(session.user.id)) {
        await notificarRepartidorOscuro({
          riderId: session.user.id,
          name: session.user.name ?? "",
          motivo: "permiso_revocado",
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error en beacon de GPS del motorizado:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
