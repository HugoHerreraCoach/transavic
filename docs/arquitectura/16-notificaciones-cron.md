# 16 — Sistema de Notificaciones e Hilos de Cron

> **Última verificación contra código:** 2026-07-12
> **Fuente de horarios:** `vercel.json`
> **Archivos clave:** `src/lib/notificaciones.ts`, `src/components/NotificationBell.tsx`, `src/app/api/cron/**/route.ts`, `vercel.json`

Este documento describe el motor de mensajería in-app para alertas operativas interconectadas y la ejecución programada de procesos en segundo plano (cron jobs).

---

## 1. Sistema de Notificaciones In-App (`NotificationBell.tsx`)

Para mantener comunicadas las 4 áreas sin necesidad de recargar la página:
- **Visualización:** El componente `NotificationBell.tsx` se renderiza en el header del layout de dashboard. Realiza consultas a `GET /api/notificaciones` mediante un **polling de 30 segundos** (que se detiene si la pestaña del navegador está oculta).
- **Tipos de Alertas:**
  - `pedido_asignado` $\rightarrow$ Alerta al repartidor que tiene una nueva orden de entrega.
  - `pedido_entregado` / `pedido_fallido` $\rightarrow$ Alerta a la asesora responsable que su venta cambió de estado.
  - `pedido_por_llegar` / `pedido_llegado` $\rightarrow$ Alerta a la asesora que el motorizado está a 5 min o arribó a la dirección del cliente.
  - `repartidor_oscuro` $\rightarrow$ Alerta al admin de un posible apagado de GPS por parte del repartidor.
  - `factura_vencida` $\rightarrow$ Alerta a la asesora que una cobranza superó su plazo límite.
  - `factura_por_vencer` $\rightarrow$ Recordatorio anticipado de una cobranza próxima a vencer.
  - `meta_atrasada` $\rightarrow$ Alerta motivacional cuando el avance mensual va por debajo del ritmo.
  - `cliente_inactivo` $\rightarrow$ Sugiere reactivar un cliente recurrente sin compras recientes.

---

## 2. Los 5 Cron Jobs del Sistema

Todos los endpoints bajo `/api/cron/*` están protegidos de llamados externos. Requieren el header `Authorization: Bearer <CRON_SECRET>` enviado automáticamente por el planificador de Vercel. Si `CRON_SECRET` no coincide o está ausente, el servidor retorna un error **503/401**.

Schedules y comportamientos configurados en `vercel.json`:

| Ruta de Endpoint | Frecuencia (UTC) | Hora Lima | Tarea Ejecutada |
|---|---|---|---|
| `/api/cron/facturas-vencidas` | `0 13 * * *` | 08:00 | Compara `fecha_vencimiento` contra hoy. Cambia estado a `'Vencida'`, inserta `factura_vencida` y recuerda con `factura_por_vencer` las que vencen mañana. |
| `/api/cron/daily-digest-admin` | `30 13 * * *` | 08:30 | Envía un reporte diario consolidado al admin (facturas vencidas, comprobantes con error SUNAT y pedidos sin motorizado). **Además, realiza la purga de notificaciones leídas >30 días** para ahorrar espacio en la base de datos. |
| `/api/cron/recordatorios-asesoras` | `0 17 * * *` | 12:00 | Analiza el desempeño de cada asesora: si su meta acumulada a la fecha va por debajo del 50%, o si posee clientes con inactividad (sin compras en 14–21 días), dispara alertas de motivación. |
| `/api/cron/resumen-diario-sunat` | `0 7 * * *` | 02:00 | Agrupa de forma atómica todas las boletas de venta (03) emitidas el día de ayer y transmite el Resumen Diario (RC-) consolidado a SUNAT. |
| `/api/cron/repartidores-oscuros` | `*/10 * * * *` | Cada 10 min | Escanea motorizados con pedidos activos asignados. Si no hay reportes de posición en los últimos 10 minutos (en horario de 04:30 a 22:00), dispara alerta `repartidor_oscuro` al admin. |
