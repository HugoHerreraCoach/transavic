# App Repartidor (Capacitor + GPS) — Guía de prueba, build y publicación

> **Para Hugo.** Esto explica cómo PROBAR la app en un teléfono real **sin subir nada a
> producción**, cómo reconstruir el APK, y cómo pasarla a producción + Play cuando ya
> funcione. La regla acordada con Antonio sigue vigente: **nada se sube hasta comprobar
> que la app funciona bien en la calle.**

---

## 1. Qué se construyó (resumen)

Una app Android **"cascarón" (Capacitor)** que CARGA la web de Transavic (no la
re-empaqueta). Solo el repartidor la usa. Aporta lo que el navegador móvil no puede:
**GPS en segundo plano** (con la pantalla apagada) mediante un *foreground service*.

| Pieza | Dónde | Qué hace |
|---|---|---|
| Tabla `rider_locations` | `scripts/migrate-rider-locations.sql` | Guarda la ÚLTIMA posición de cada motorizado (1 fila por rider, UPSERT) |
| Endpoint de reporte | `src/app/api/repartidor/ubicacion/route.ts` | POST con la posición (solo rol `repartidor`, scoping por sesión) |
| Mapa de despacho | `src/app/dashboard/despacho/mapa-despacho.tsx` | Marker "moto" en vivo (color por rider, flecha de rumbo, "hace N min") + toggle "Motos en vivo" |
| Reporte web | `src/app/dashboard/mi-ruta/mi-ruta-content.tsx` | En navegador, manda GPS cada ~12s (foreground) |
| Seguimiento nativo | `src/app/dashboard/mi-ruta/seguimiento-nativo.tsx` | En la app, GPS en segundo plano (plugin) + aviso de permiso + tips de batería |
| Cascarón | `capacitor.config.ts`, `android/` | El proyecto Android |

**Importante:** como la app solo CARGA la web, los cambios de la web salen al instante
(con un nuevo deploy) **sin reconstruir el APK**. Solo se reconstruye el APK para cambios
NATIVOS (permisos, ícono, plugins, o cambiar a qué servidor apunta).

---

## 2. Probar en un teléfono real SIN subir nada (recomendado primero)

La idea: el teléfono carga el **dev server de tu Mac** (rama `dev-hugo`), que ya tiene
todo el backend del GPS. Nada toca producción.

### Requisitos
- El APK ya está construido: **`android/app/build/outputs/apk/debug/app-debug.apk`**.
- Teléfono Android con **Depuración USB** activada (Ajustes → Opciones de desarrollador).
- Cable USB.

### Pasos
1. **Dev server corriendo** en el Mac:
   ```bash
   npm run dev          # queda en http://localhost:3000 (usa .env.local → dev-hugo)
   ```
2. **Conecta el teléfono por USB** y enlaza su `localhost` al del Mac:
   ```bash
   ~/Library/Android/sdk/platform-tools/adb reverse tcp:3000 tcp:3000
   ```
   (Esto hace que `http://localhost:3000` DENTRO del teléfono apunte al dev server del Mac.
   El APK por defecto apunta justo a `http://localhost:3000`.)
3. **Instala el APK** en el teléfono:
   ```bash
   ~/Library/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```
   (o copia el `.apk` al teléfono y ábrelo; permite "instalar apps de orígenes desconocidos").
4. **Abre "Transavic Reparto"** en el teléfono → debería cargar el login de la web.
   Inicia sesión con un usuario **repartidor**.
5. En **Mi Ruta** aparece arriba el aviso **"Compartir tu ubicación"** → toca
   **"Activar ubicación"** → Android pide el permiso → "Mientras se usa la app".
6. Verás la franja verde **"Compartiendo tu ubicación"** + una **notificación fija**.

### Qué verificar (checklist)
- [ ] En otra pantalla (la PC del admin, logueado como admin) abre **Despacho** → el mapa
      muestra la **moto en vivo** del repartidor, y dice "hace pocos segundos".
- [ ] Mueve el teléfono unos metros → la posición se actualiza (cada ~12s / cada 20 m).
- [ ] **PRUEBA CLAVE — pantalla apagada:** bloquea el teléfono y deja la notificación
      activa. Camina/maneja unos minutos. La moto en el mapa **debe seguir moviéndose**.
      (Aunque esté con cable, esto ya prueba que el *foreground service* sobrevive al
      apagado de pantalla, que es lo más difícil.)
- [ ] Toca **"Pausar"** → deja de enviar; **"Reanudar"** → vuelve.

> **Probar por WiFi en vez de USB** (sin cable, para una prueba de calle corta cerca de
> casa): en `capacitor.config.ts` el server ya es configurable. Averigua la IP LAN del Mac
> (`ipconfig getifaddr en0` o `en1`), agrégala como `<domain>` en
> `android/app/src/main/res/xml/network_security_config.xml`, reconstruye con
> `CAP_SERVER_URL=http://ESA_IP:3000 npm run app:build`, y arranca el dev con
> `next dev -H 0.0.0.0`. (El `adb reverse` es más simple para la primera prueba.)

---

## 3. Reconstruir el APK

Solo hace falta para cambios **nativos** (permisos, ícono, plugins) o para cambiar el
servidor. Para cambios de la WEB no se reconstruye (se redeploya la web).

```bash
npm run app:build         # cap sync + assembleDebug (apunta a localhost por defecto)
# El APK queda en android/app/build/outputs/apk/debug/app-debug.apk
```

Abrir el proyecto en Android Studio (por si quieres ícono, firma, etc.):
```bash
npm run app:open
```

---

## 4. Ajustes del teléfono (clave en Perú: Xiaomi/Samsung/Huawei matan apps)

El #1 motivo por el que el GPS "se corta" es el ahorro de batería agresivo de la marca.
La app ya muestra estos tips dentro de "Mi Ruta" (sección "¿Se corta la ubicación?"):
1. **Ahorro de batería de la app → "Sin restricciones"**.
2. **Permitir "iniciar automáticamente" / autostart** (Xiaomi, Oppo, Vivo, Huawei).
3. **No cerrar la app** deslizándola desde "Recientes" durante la jornada.

Para cada motorizado conviene dejar esto configurado una vez (puedes guiarlos por WhatsApp).

---

## 5. Pasar a PRODUCCIÓN (recién cuando la prueba salga bien)

Cuando confirmes que la app rastrea bien (incluida la prueba de pantalla apagada), recién
ahí se sube. Orden:

1. **Subir el backend a producción** (es aditivo y seguro: tabla nueva + endpoint nuevo +
   un campo extra en `/api/despacho`):
   - Aplicar las migraciones a producción por psql (gotcha #13), en orden (URL de PRODUCCIÓN):
     ```bash
     psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-rider-locations.sql           # crea la tabla
     psql "$DATABASE_URL_UNPOOLED" -f scripts/migrate-rider-locations-accuracy.sql  # accuracy → NUMERIC(10,2)
     ```
   - Mergear el código a `main` → Vercel deploya solo.
2. **Construir el artefacto de producción** (apuntando a la web real):
   ```bash
   npm run app:build:prod   # hornea CAP_SERVER_URL=https://transavic.vercel.app + genera el AAB (bundleRelease)
   ```
   (Con https NO se usa cleartext; la red queda segura.)
   ⚠️ OJO: `npm run app:build` —**sin** `:prod`— genera un APK **debug**, solo para la prueba
   local; **NO** sirve para Play.
3. **Firmar para release** (Play exige APK/AAB firmado — el `bundleRelease` del paso 2 sale
   **SIN firmar** hasta que configures esto): generar un *keystore* una sola vez y configurar
   `signingConfig` en `android/app/build.gradle`, con las credenciales en
   `android/keystore.properties` (**ya está en `.gitignore`** — nunca comitear la llave), **o**
   usar **Play App Signing** (recomendado: Google guarda la llave). Una vez configurada la firma,
   el AAB a subir sale de `npm run app:build:prod` (o `./gradlew bundleRelease`).
4. **Google Play → Internal testing (prueba interna)**:
   - Es el canal ideal para 6 motorizados: subes el AAB, generas **un link de invitación**,
     lo mandas por WhatsApp, ellos lo abren e instalan desde Play (se auto-actualiza).
   - La prueba interna **no requiere** los 12 testers / 14 días de la prueba cerrada.
   - **Permiso de ubicación:** la app rastrea con *foreground service* y **NO** usa
     `ACCESS_BACKGROUND_LOCATION`, así que **evitas la declaración especial de "ubicación
     en segundo plano"** de Play. Sí debes completar en la ficha la **sección de Datos de
     ubicación** del *Data safety* y mantener el **aviso destacado** (ya está en la app).
   - **Plan B (sin Play):** distribuir el `app-debug.apk` (o uno release firmado) por link
     directo; los motorizados activan "instalar apps desconocidas". Más simple pero sin
     auto-actualización.

---

## 6. Notas técnicas (para el próximo agente)

- **Capacitor 7** (core/cli/android 7.6.5) + `@capacitor-community/background-geolocation`
  1.2.26. El plugin aporta el `<service>` y los permisos de ubicación/FGS/notificación vía
  *manifest merge* (no se redeclaran). Ver `android/app/src/main/AndroidManifest.xml`.
- **server.url configurable** por `CAP_SERVER_URL` (default `http://localhost:3000`). El
  cleartext se permite SOLO para localhost vía `network_security_config.xml`.
- **`android.useLegacyBridge: true`** (en `capacitor.config.ts`): evita que Android
  estrangule el WebView en segundo plano.
- **CapacitorHttp** (HTTP nativo) para reportar el GPS: el `fetch` del WebView se estrangula
  en background; el HTTP nativo no. La sesión va por cookie (capa nativa).
- **compileSdk 36 + `android.suppressUnsupportedCompileSdk=36`** (en `android/gradle.properties`):
  en esta máquina hay `android-36` pero no `android-35` (lo que pediría Cap 7). Si instalas
  `android-35` por el SDK Manager, puedes volver `compileSdkVersion = 35` en
  `android/variables.gradle` y quitar el flag.
- **Reporte web vs nativo:** en navegador reporta `useGeolocation` (mi-ruta-content); en la
  app reporta el plugin (seguimiento-nativo). `esPlataformaNativa()` (en `src/lib/plataforma.ts`)
  evita que se dupliquen.
- **✅ YA EN PRODUCCIÓN (4 jun 2026).** El proyecto `android/` y las dependencias de Capacitor
  se commitearon a `main` (PRs #18–#22); la tabla `rider_locations` se migró a producción; la app
  se validó en teléfono real y se publicó en Google Play (Prueba Interna). Esta guía sigue siendo
  útil para **probar en local** (con `adb reverse`, sin tocar prod) y para **reconstruir el AAB**
  (`npm run app:build:prod`) en cada release — recordá subir el `versionCode` en `android/app/build.gradle`.
