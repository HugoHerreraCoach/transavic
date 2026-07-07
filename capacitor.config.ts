import type { CapacitorConfig } from "@capacitor/cli";

// ── Configuración del cascarón nativo "Transavic Reparto" ──
// La app NO empaqueta la web: es un "thin shell" que CARGA la web (Next.js) desde
// `server.url`. Así los cambios web salen al instante sin reconstruir el APK; solo
// se reconstruye para cambios NATIVOS (permisos, ícono, plugins).
//
// ⚙️ A qué servidor apunta:
//   • Prueba LOCAL (hazla primero, NO sube nada a producción): corré el dev server
//     del Mac y `adb reverse tcp:3000 tcp:3000` con el teléfono por USB → el teléfono
//     ve http://localhost:3000 = tu rama dev-hugo (que ya tiene el backend del GPS).
//     Es el DEFAULT de abajo.
//   • Producción (build final, recién cuando todo funcione):
//       CAP_SERVER_URL=https://app.transavic.com npx cap sync android
//     (o `npm run app:build:prod`, que ya hornea ese dominio)
const SERVER_URL = process.env.CAP_SERVER_URL || "http://localhost:3000";
const esHttp = SERVER_URL.startsWith("http://");

const config: CapacitorConfig = {
  appId: "pe.transavic.reparto",
  appName: "Transavic Reparto",
  webDir: "public-shell",
  server: {
    url: SERVER_URL,
    // cleartext solo se necesita al apuntar a http (localhost/LAN de prueba).
    cleartext: esHttp,
    androidScheme: esHttp ? "http" : "https",
    // Red de seguridad de la migración de dominio (jul 2026): el WebView puede
    // navegar entre AMBOS dominios sin expulsar al rider a Chrome (un salto de
    // host fuera de esta lista abriría el navegador del sistema y mataría el GPS).
    allowNavigation: ["transavic.vercel.app", "app.transavic.com"],
  },
  android: {
    // El bridge "legacy" evita que Android estrangule el WebView en segundo plano:
    // es clave para que el reporte de GPS siga con la pantalla apagada.
    useLegacyBridge: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#dc2626", // rojo de marca Transavic
      showSpinner: false,
      androidSpinnerStyle: "small",
    },
  },
};

export default config;
