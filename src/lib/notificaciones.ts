// src/lib/notificaciones.ts
// Helper para crear notificaciones in-app. Usado por los endpoints que disparan eventos.
import { neon } from "@neondatabase/serverless";

export type TipoNotificacion =
  | "pedido_creado"
  | "pesos_listos"
  | "listo_para_despacho"
  | "pedido_asignado"
  | "pedido_en_camino"
  | "pedido_entregado"
  | "pedido_fallido"
  | "guia_firmada"
  | "factura_vencida"
  | "factura_por_vencer"
  | "meta_diaria_alcanzada"
  | "meta_atrasada"
  | "cliente_inactivo"
  // P2.10 — SUNAT rechaza o error de infraestructura al emitir.
  // Se notifica al admin (Antonio) y a la asesora dueña del pedido (si aplica).
  | "comprobante_rechazado"
  | "comprobante_error"
  // Sistema de autorizaciones de precio mínimo.
  | "autorizacion_solicitada"   // al admin cuando asesora pide precio por debajo del mínimo
  | "autorizacion_resuelta";    // a la asesora cuando el admin aprueba o rechaza

export interface CrearNotificacionParams {
  userId: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  link?: string;
  pedidoId?: string;
}

/**
 * Crea una notificación. NUNCA lanza error — las notificaciones son nice-to-have
 * y NO deben romper el flujo principal si fallan.
 */
export async function crearNotificacion(params: CrearNotificacionParams): Promise<void> {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`
      INSERT INTO notificaciones (user_id, tipo, titulo, mensaje, link, pedido_id)
      VALUES (
        ${params.userId},
        ${params.tipo},
        ${params.titulo},
        ${params.mensaje},
        ${params.link ?? null},
        ${params.pedidoId ?? null}
      )
    `;
  } catch (e) {
    console.error("Error al crear notificación (no crítico):", e);
  }
}

/**
 * P2.10 — Helper específico para avisar de un comprobante con problema
 * (RECHAZADA por SUNAT o ERROR de infraestructura).
 *
 * Estrategia de destinatarios:
 *   - Siempre se notifica al admin (Antonio): él decide reintentar / N. Crédito.
 *   - Si el comprobante vino de un pedido con asesora, también se le notifica
 *     a la asesora dueña (es su cliente; necesita saber para coordinarlo).
 *
 * NUNCA lanza error — silencioso si falla.
 */
export async function notificarComprobanteConProblema(params: {
  comprobanteId: string;
  serieNumero: string | null;
  tipo: string; // "01" | "03" | "07"
  estado: "RECHAZADA" | "ERROR";
  mensajeSunat: string | null;
  pedidoId: string | null;
  empresa: string; // "transavic" | "avicola"
  asesorId?: string | null;
}): Promise<void> {
  try {
    const tipoLabel: Record<string, string> = {
      "01": "Factura",
      "03": "Boleta",
      "07": "Nota de Crédito",
    };
    const tipoStr = tipoLabel[params.tipo] ?? "Comprobante";
    const serieStr = params.serieNumero ?? "(sin número)";
    const titulo =
      params.estado === "RECHAZADA"
        ? `❌ ${tipoStr} ${serieStr} rechazada por SUNAT`
        : `⚠️ Error al emitir ${tipoStr.toLowerCase()} ${serieStr}`;
    const mensaje =
      params.mensajeSunat?.trim() ||
      (params.estado === "RECHAZADA"
        ? "SUNAT rechazó el comprobante. Revisa el motivo y reintenta o emite una Nota de Crédito."
        : "Hubo un problema al enviar a SUNAT. Reintenta desde /comprobantes.");
    const link = `/dashboard/comprobantes`;
    const tipoNotif: TipoNotificacion =
      params.estado === "RECHAZADA" ? "comprobante_rechazado" : "comprobante_error";

    // 1) Notificar a todos los admins.
    await crearNotificacionParaRol("admin", {
      tipo: tipoNotif,
      titulo,
      mensaje,
      link,
      pedidoId: params.pedidoId ?? undefined,
    });

    // 2) Si el pedido tenía asesora, también le avisamos (no dupliquemos si la
    //    asesora es además admin).
    if (params.asesorId) {
      const sql = neon(process.env.DATABASE_URL!);
      const filas = (await sql`
        SELECT role FROM users WHERE id = ${params.asesorId}
      `) as Array<{ role: string }>;
      if (filas[0] && filas[0].role !== "admin") {
        await crearNotificacion({
          userId: params.asesorId,
          tipo: tipoNotif,
          titulo,
          mensaje,
          link,
          pedidoId: params.pedidoId ?? undefined,
        });
      }
    }
  } catch (e) {
    console.error("Error al notificar comprobante con problema (no crítico):", e);
  }
}

/**
 * Mantenimiento: borra notificaciones YA LEÍDAS de más de `diasRetencion` días
 * (default 30) para que la tabla `notificaciones` no crezca sin límite.
 *
 * Reglas:
 *   - Solo borra las que el usuario YA VIO (`leida = TRUE`). Las no leídas se
 *     respetan siempre, sin importar su antigüedad — son pendientes reales.
 *   - No depende de timezone: compara contra "hace N días desde ahora".
 *
 * NO crea un cron propio: lo invoca un cron diario existente
 * (`daily-digest-admin`) para no sumar otro job a Vercel. Best-effort: NUNCA
 * lanza error (es mantenimiento, no debe romper al que lo llama). Devuelve
 * cuántas filas borró, para logging.
 */
export async function limpiarNotificacionesAntiguas(
  diasRetencion = 30
): Promise<number> {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const filas = (await sql`
      DELETE FROM notificaciones
      WHERE leida = TRUE
        AND created_at < NOW() - make_interval(days => ${diasRetencion}::int)
      RETURNING id
    `) as Array<{ id: string }>;
    return filas.length;
  } catch (e) {
    console.error("Error al limpiar notificaciones antiguas (no crítico):", e);
    return 0;
  }
}

/**
 * Crea la misma notificación para varios usuarios (por ejemplo, todos los de un rol).
 */
export async function crearNotificacionParaRol(
  rol: string,
  params: Omit<CrearNotificacionParams, "userId">
): Promise<void> {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const users = (await sql`SELECT id FROM users WHERE role = ${rol}`) as Array<{
      id: string;
    }>;
    for (const u of users) {
      await crearNotificacion({ ...params, userId: u.id });
    }
  } catch (e) {
    console.error("Error al crear notificaciones por rol (no crítico):", e);
  }
}
