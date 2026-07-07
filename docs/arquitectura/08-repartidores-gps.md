# 08 — Aplicación del Repartidor, Offline y GPS Obligatorio

> **Última verificación contra código:** 2026-06-28
> **Commit del proyecto:** `9f29f5a`
> **Archivos clave:** `src/app/dashboard/mi-ruta/mi-ruta-content.tsx`, `src/app/dashboard/mi-ruta/seguimiento-nativo.tsx`, `src/lib/offline-queue.ts`, `src/lib/repartidor-jornada.ts`, `src/lib/repartidor-oscuro.ts`, `src/app/api/cron/repartidores-oscuros/route.ts`

Este documento describe el funcionamiento de la vista del repartidor, la aplicación móvil híbrida (Capacitor), el motor offline-first y la lógica de rastreo GPS obligatorio con detección de repartidores oscuros.

---

## 1. La Vista Móvil del Repartidor (`mi-ruta-content.tsx`)

Ubicada en `/dashboard/mi-ruta`, está diseñada bajo el principio **mobile-first** para el motorizado en ruta:
- **Sticky Header:** Barra fija que resume las entregas completadas, la distancia acumulada y el botón para optimizar su secuencia de reparto desde el móvil.
- **Lista de Pedidos Activa:** Se muestra en un acordeón agrupado por estados. El pedido que se encuentra actualmente `En_Camino` se dibuja en formato "hero" expandido en la parte superior.
- **Acciones Rápidas:** Botones para llamar por teléfono al cliente, abrir la ubicación en Google Maps / Waze, marcar como Entregado o reportar un Fallido (abre un modal con 5 razones predefinidas).
- **Evidencias de Entrega:** Al marcar un pedido como Entregado, se le solicita la firma digital del cliente y el motorizado toma una foto de la orden física firmada. La foto es comprimida en el cliente antes de subirse para ahorrar ancho de banda móvil.

---

## 2. Aplicación Híbrida (Capacitor)

Dado que iOS y Android restringen drásticamente el uso de sensores de GPS en segundo plano a las aplicaciones web progresivas (PWA), la interfaz de `/mi-ruta` se envuelve en una aplicación nativa Android mediante **Capacitor** (carpeta `/android/`).

- **Funcionamiento cascarón:** La app nativa carga la URL de producción (`server.url=https://app.transavic.com` desde v1.0.2/versionCode 3; las versiones ≤1.0.1 apuntan a `transavic.vercel.app` — por eso el redirect del dominio viejo solo se activa cuando TODOS los riders actualizaron) y actúa como contenedor. `allowNavigation` permite ambos dominios como red de seguridad.
- **Rastreo en background:** Capacitor aporta un servicio en primer plano (*foreground service*) mediante el plugin `BackgroundGeolocation`. Este servicio corre en segundo plano en el sistema operativo y reporta la posición GPS cada ~12 segundos a `POST /api/repartidor/ubicacion`, incluso con el teléfono bloqueado y la pantalla apagada.

---

## 3. Cola Offline de Eventos (`offline-queue.ts`)

Para mitigar los problemas de conectividad en zonas de Lima sin cobertura móvil (sótanos de restaurantes, túneles, etc.):

- **Estructura:** Las acciones críticas (Iniciar viaje, Entregar, Fallar) no hacen llamados `fetch` directos. Pasan por `src/lib/offline-queue.ts`, el cual guarda la acción en `localStorage` (`transavic_offline_queue`).
- **Optimistic Updates:** La UI reacciona e introduce el cambio visual inmediatamente.
- **Sincronización:** Un watcher en el cliente detecta el estado de red (`window.addEventListener('online')`) y procesa la cola:
  - Envía las peticiones una por una al servidor en orden de encolado.
  - **Idempotencia:** Si una petición falla, se reintenta hasta 3 veces. Si el servidor responde que el pedido ya fue modificado por el administrador (conflicto de estados), la acción se descarta en silencio para evitar inconsistencias.

---

## 4. GPS Obligatorio y "Repartidores Oscuros"

El sistema implementa una política de GPS obligatorio (Mejora 3 - junio 2026) que impide que el motorizado trabaje sin reportar su ubicación. El botón de pausar el seguimiento fue removido.

### 4.1 Ventana Operativa y Privacidad
El GPS solo reporta si se cumplen concurrentemente dos condiciones:
1. **Pedidos activos hoy:** El motorizado tiene al menos un pedido asignado hoy en estado `Asignado` o `En_Camino` (`src/lib/repartidor-jornada.ts`).
2. **Ventana laboral:** La hora actual de Lima se encuentra dentro de la ventana operativa configurada (`src/lib/ventana-operativa.ts`, por defecto 04:30 a 22:00 Lima). Fuera de esto, el tracking se apaga automáticamente para preservar la privacidad del motorizado.

### 4.2 Detección de Evasión (Repartidor Oscuro)

El sistema distingue entre la falta de señal física (involuntaria) y la evasión deliberada del rastreo mediante tres mecanismos:

1. **Beacon Inmediato (`POST /api/repartidor/beacon`):** Si el motorizado apaga el GPS del dispositivo o revoca los permisos de ubicación a la aplicación Capacitor, la app intercepta el evento e intenta enviar un beacon al servidor registrando `gps_status = 'permiso_revocado'`. Si tiene pedidos activos en ruta, se notifica inmediatamente al administrador en Despacho (con marca roja).
2. **GPS Simulado (Mock GPS):** Si el repartidor intenta usar aplicaciones para simular ubicaciones falsas, el servidor detecta el flag `simulated = true` en el POST. El backend descarta la coordenada (para no alterar el mapa de despacho), actualiza el estado del rider a `mock` (rojo en el mapa) y retorna un status 200 envenenando la cola offline para evitar que la app móvil se trabe reintentando.
3. **Cron de inactividad (`/api/cron/repartidores-oscuros`):** Un cron job diario corre cada 10 minutos comprobando los motorizados que tienen pedidos activos asignados. Si un motorizado no reporta coordenadas en más de 10 minutos (estado `sin_senal`, pintado de ámbar), envía una notificación in-app al admin de tipo `repartidor_oscuro`, aplicando un debounce de control en `settings.gps_oscuros_alertados` para no spamear alertas.
