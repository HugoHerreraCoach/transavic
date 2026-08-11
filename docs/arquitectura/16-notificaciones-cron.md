# 16 — Sistema de Notificaciones e Hilos de Cron

> **Última verificación contra código:** 2026-08-11
> **Fuente de horarios:** `vercel.json`
> **Archivos clave:** `src/lib/notificaciones.ts`, `src/lib/eta-reparto.ts`, `src/lib/tiempo-relativo.ts`, `src/components/NotificationBell.tsx`, `src/app/api/cron/**/route.ts`, `vercel.json`

Este documento describe el motor de mensajería in-app para alertas operativas interconectadas y la ejecución programada de procesos en segundo plano (cron jobs).

---

## 1. Sistema de Notificaciones In-App (`NotificationBell.tsx`)

Para mantener comunicadas las 4 áreas sin necesidad de recargar la página:
- **Visualización:** El componente `NotificationBell.tsx` se renderiza en el header del layout de dashboard. Realiza consultas a `GET /api/notificaciones` mediante un **polling de 30 segundos** (que se detiene si la pestaña del navegador está oculta).
- **Tipos de Alertas:**
  - `pedido_asignado` $\rightarrow$ Alerta al repartidor que tiene una nueva orden de entrega.
  - `pedido_entregado` / `pedido_fallido` $\rightarrow$ Alerta a la asesora responsable que su venta cambió de estado.
  - `pedido_por_llegar` / `pedido_llegado` $\rightarrow$ Alerta a la asesora que el motorizado está por llegar (mensaje con los **minutos reales**, 2–5) o arribó a la dirección del cliente. Reglas del disparo en §1.1.
  - `repartidor_oscuro` $\rightarrow$ Alerta al admin de un posible apagado de GPS por parte del repartidor.
  - `factura_vencida` $\rightarrow$ Alerta a la asesora que una cobranza superó su plazo límite.
  - `factura_por_vencer` $\rightarrow$ Recordatorio anticipado de una cobranza próxima a vencer.
  - `meta_atrasada` $\rightarrow$ Alerta motivacional cuando el avance mensual va por debajo del ritmo.
  - `cliente_inactivo` $\rightarrow$ Sugiere reactivar un cliente recurrente sin compras recientes.

- **"Hace X min":** la campanita y el mapa de despacho comparten `src/lib/tiempo-relativo.ts`
  (SIEMPRE `Math.floor` — "hace 1 min" recién al minuto entero; con tests). La campanita además
  tiene un tick de 30 s solo con el panel abierto, para que el texto no quede congelado entre polls.

---

## 1.1 Alertas de arribo (`pedido_por_llegar` / `pedido_llegado`) — modelo de ETA honesto (11 ago 2026)

Las dos alertas se generan SOLO en `POST /api/repartidor/ubicacion` (cada ping GPS del motorizado);
la decisión pura vive en **`src/lib/eta-reparto.ts`** (testeada en vitest). Reglas — respetarlas al
tocar el endpoint:

1. **Calibración por-viaje:** `iniciar-viaje` deriva del Google Directions inicial un factor de ruta
   (`distanciaRuta/líneaRecta`, clamp 1.1–2.2) y una velocidad efectiva (clamp 8–45 km/h), y los
   persiste en `pedidos.eta_factor_ruta`/`eta_velocidad_kmh` (migración `migrate-eta-honesto.sql`;
   NULL = defaults 1.3 / 18 km/h). Cada ping estima `etaMin = línearecta × factor / velocidad` →
   el ETA recalculado es **continuo** con el de Google (no lo pisa con otro modelo).
2. **"Por llegar"** dispara solo con `etaMin` en **[2..5] min** y el mensaje lleva los minutos
   reales ("a unos 4 minutos"). Con < 2 min se **suprime** (solo saldrá "llegado"). Si el viaje
   entero dura ≤ 6 min, `iniciar-viaje` la suprime de fábrica (`notificado_por_llegar = TRUE`):
   "Pedido en camino" ya es el aviso de inminencia.
3. **"Llegado"** (≤ 150 m) **excluye mutuamente** a "por llegar" y consume AMBOS flags — jamás las
   dos en el mismo ping ni "por llegar" después de "llegado".
4. **Claim atómico:** el flag se marca ANTES de notificar con `UPDATE … WHERE flag = FALSE AND
   estado = 'En_Camino' RETURNING id`; solo quien retorna fila inserta la notificación (2 pings
   concurrentes → 1 sola alerta). El UPDATE que refresca `hora_llegada_estimada` NO toca flags.
5. **Frescura:** un ping con `|ahora − capturedAt| > 120 s` (cola offline / reloj roto) actualiza la
   posición del mapa pero NO evalúa alertas ni ETA (`esCapturaFresca`). El UPSERT de
   `rider_locations` además rechaza retroceder `captured_at` (replay out-of-order).
6. Se evalúan **todos** los pedidos `En_Camino` del día del rider (orden `orden_ruta`), no `LIMIT 1`.

Crónica completa y verificación E2E: [historial 11 ago 2026](../historial-cambios-2026.md).

---

## 2. Los 6 Cron Jobs del Sistema

Todos los endpoints bajo `/api/cron/*` están protegidos de llamados externos. Requieren el header `Authorization: Bearer <CRON_SECRET>` enviado automáticamente por el planificador de Vercel. Si `CRON_SECRET` no coincide o está ausente, el servidor retorna un error **503/401**.

Schedules y comportamientos configurados en `vercel.json`:

| Ruta de Endpoint | Frecuencia (UTC) | Hora Lima | Tarea Ejecutada |
|---|---|---|---|
| `/api/cron/facturas-vencidas` | `0 13 * * *` | 08:00 | Compara `fecha_vencimiento` contra hoy. Cambia estado a `'Vencida'`, inserta `factura_vencida` y recuerda con `factura_por_vencer` las que vencen mañana. |
| `/api/cron/daily-digest-admin` | `30 13 * * *` | 08:30 | Envía un reporte diario consolidado al admin (facturas vencidas, comprobantes con error SUNAT y pedidos sin motorizado). **Además, realiza la purga de notificaciones leídas >30 días** para ahorrar espacio en la base de datos. |
| `/api/cron/recordatorios-asesoras` | `0 17 * * *` | 12:00 | Analiza el desempeño de cada asesora: si su meta acumulada a la fecha va por debajo del 50%, o si posee clientes con inactividad (sin compras en 14–21 días), dispara alertas de motivación. |
| `/api/cron/resumen-diario-sunat` | `0 7 * * *` | 02:00 | Agrupa de forma atómica todas las boletas de venta (03) emitidas el día de ayer y transmite el Resumen Diario (RC-) consolidado a SUNAT. |
| `/api/cron/repartidores-oscuros` | `*/10 * * * *` | Cada 10 min | Escanea motorizados con pedidos activos asignados. Si no hay reportes de posición en los últimos 10 minutos (en horario de 04:30 a 22:00), dispara alerta `repartidor_oscuro` al admin. |
| `/api/cron/reconciliar-cpe-sunat` | `*/5 * * * *` | Cada 5 min | Consulta en lotes pequeños el estado de facturas/boletas inciertas y recupera el CDR de una factura cuando SUNAT lo permite. Nunca emite ni reenvía un CPE. |

### Límite del cron de reconciliación SUNAT

`reconciliar-cpe-sunat` procesa hasta tres CPE por corrida y los consulta en
secuencia para no producir una ráfaga contra SUNAT:

- factura `01`: `getStatus` y, si corresponde, `getStatusCdr`;
- boleta `03`: Consulta Integrada de Comprobantes con fecha y monto;
- nunca llama a `sendBill`, no firma otro XML y no consume otro correlativo;
- mientras el CPE siga `por_confirmar`, continúa bloqueando una segunda emisión
  para la misma venta;
- si SUNAT confirma tarde la aceptación, ejecuta el postproceso idempotente que
  enlaza la cartera correcta una sola vez.

Por eso una intermitencia del cron o de SUNAT no autoriza a emitir manualmente
otro comprobante ni una Nota de Crédito. La matriz de actuación para asesoras está
en [estados-comprobantes-sunat.md](../soporte/estados-comprobantes-sunat.md).

## 3. Popup persistente de reprogramación

> **Estado de esta sección:** implementado en `codex/cambios-operativos-julio`,
> probado en desarrollo y aún no desplegado. Las notificaciones y crons anteriores
> continúan en producción sin depender de este cambio.

`pedido_reprogramado` se guarda en `notificaciones` dentro de la misma operación
atómica que cambia la fecha. El destinatario es el asesor del pedido, luego el asesor
actual del cliente y, si ninguno existe, los administradores.

`ArriboPopup` también presenta este tipo con calendario y acento naranja. Consulta en
15 segundos (cumple el máximo de 30), anuncia el diálogo mediante ARIA y enlaza a
`/dashboard?pedido=<uuid>`. Cerrar el popup guarda su ID en `sessionStorage`: no vuelve
a interrumpir en esa sesión, pero permanece no leído en la campana. Si la aplicación
estaba cerrada, la fila persistente aparece al regresar.
