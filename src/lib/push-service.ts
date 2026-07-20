import { adminMessaging } from './FirebaseAdmin';
import { neon } from '@neondatabase/serverless';

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  renotify?: boolean;
  silent?: boolean;
}

/**
 * Envía una notificación push FCM a todos los dispositivos registrados de un usuario
 */
export async function sendPushNotification(
  userId: string,
  payload: PushPayload
): Promise<boolean> {
  if (!adminMessaging) {
    console.warn("⚠️ FCM Admin no está inicializado. Saltando envío.");
    return false;
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // 1. Obtener los tokens de FCM del usuario
    const rows = await sql`
      SELECT token FROM user_fcm_tokens
      WHERE usuario_id = ${userId};
    `;

    if (!rows || rows.length === 0) {
      console.log(`[FCM] Sin tokens registrados para el usuario ${userId}`);
      return false;
    }

    const tokens = rows.map((r: any) => r.token);
    
    // 2. Formatear el mensaje multicast
    const message = {
      data: {
        title: payload.title,
        body: payload.body,
        url: payload.url || '',
        tag: payload.tag || 'general-alert',
        renotify: payload.renotify ? 'true' : 'false',
        silent: payload.silent ? 'true' : 'false',
      },
      // Envío de notificaciones visibles a nivel de SO (importante para background en iOS/Android)
      notification: {
        title: payload.title,
        body: payload.body,
      },
      tokens: tokens,
    };

    // 3. Enviar a todos los dispositivos
    const response = await adminMessaging.sendEachForMulticast(message);
    console.log(`[FCM] Enviado a ${tokens.length} dispositivos para usuario ${userId}. Éxitos: ${response.successCount}, Fallos: ${response.failureCount}`);

    // 4. Limpieza automática de tokens obsoletos
    if (response.failureCount > 0) {
      const tokensToRemove: string[] = [];
      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success && resp.error) {
          const code = resp.error.code;
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            tokensToRemove.push(tokens[idx]);
          }
        }
      });

      if (tokensToRemove.length > 0) {
        console.log(`[FCM] Limpiando ${tokensToRemove.length} tokens obsoletos para el usuario ${userId}`);
        for (const token of tokensToRemove) {
          await sql`
            DELETE FROM user_fcm_tokens
            WHERE token = ${token};
          `;
        }
      }
    }

    return true;
  } catch (error) {
    console.error("❌ [FCM] Error al enviar notificación push:", error);
    return false;
  }
}
