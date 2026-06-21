// src/lib/repartidor-oscuro.ts
// Aviso al admin de que un repartidor CON pedidos activos dejó de transmitir su
// ubicación. Lo usan el endpoint /beacon (aviso inmediato al revocar el permiso) y
// el cron repartidores-oscuros (red de seguridad). El debounce vive en `settings`
// (key 'gps_oscuros_alertados') porque un rider sin fila en rider_locations igual
// tiene que controlarse contra spam.
import { neon } from "@neondatabase/serverless";
import { crearNotificacionParaRol } from "@/lib/notificaciones";
import { fechaHoyLima } from "@/lib/sunat/fechas";

const SETTINGS_KEY = "gps_oscuros_alertados";
const REAVISO_MS = 30 * 60 * 1000; // no re-notificar el mismo rider más seguido que esto

type MotivoOscuro = "permiso_revocado" | "mock" | "sin_senal";
type DebounceConfig = { fecha: string; riders: Record<string, string> }; // riderId -> ISO último aviso

const MOTIVO_TEXTO: Record<MotivoOscuro, string> = {
  permiso_revocado: "revocó el permiso de ubicación",
  mock: "está enviando una ubicación falsa (GPS simulado)",
  sin_senal: "dejó de transmitir su ubicación",
};

/**
 * Notifica al admin con debounce por repartidor (máx 1 aviso cada REAVISO_MS; se
 * resetea al cambiar de día). Devuelve true si efectivamente notificó.
 * Best-effort: NUNCA lanza (las alertas no deben romper a quien las dispara).
 */
export async function notificarRepartidorOscuro(params: {
  riderId: string;
  name: string;
  motivo: MotivoOscuro;
  detalle?: string; // ej. "hace 12 min"
}): Promise<boolean> {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const hoy = fechaHoyLima();
    const ahora = Date.now();

    // 1) Cargar el estado de debounce del día.
    const rows = await sql`SELECT value FROM settings WHERE key = ${SETTINGS_KEY}`;
    let cfg: DebounceConfig = { fecha: hoy, riders: {} };
    if (rows.length > 0) {
      const val = rows[0].value as Partial<DebounceConfig>;
      if (val.fecha === hoy && val.riders && typeof val.riders === "object") {
        cfg = { fecha: hoy, riders: { ...val.riders } };
      }
    }

    // 2) ¿Ya avisamos por este rider hace poco?
    const ultimoISO = cfg.riders[params.riderId];
    if (ultimoISO) {
      const ultimo = new Date(ultimoISO).getTime();
      if (!Number.isNaN(ultimo) && ahora - ultimo < REAVISO_MS) {
        return false;
      }
    }

    // 3) Notificar a los admins.
    const motivoTxt = MOTIVO_TEXTO[params.motivo];
    const detalle = params.detalle ? ` (${params.detalle})` : "";
    await crearNotificacionParaRol("admin", {
      tipo: "repartidor_oscuro",
      titulo: "📡 Motorizado sin señal",
      mensaje: `${params.name || "Un motorizado"} ${motivoTxt}${detalle} y tiene entregas pendientes. Revísalo en Despacho.`,
      link: "/dashboard/despacho",
    });

    // 4) Persistir el debounce.
    cfg.riders[params.riderId] = new Date(ahora).toISOString();
    await sql`
      INSERT INTO settings (key, value)
      VALUES (${SETTINGS_KEY}, ${JSON.stringify(cfg)})
      ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(cfg)}
    `;
    return true;
  } catch (e) {
    console.error("Error al notificar repartidor oscuro (no crítico):", e);
    return false;
  }
}
