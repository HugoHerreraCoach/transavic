// src/lib/plataforma.ts
// Detecta si el código corre dentro de la app nativa (Capacitor) o en un navegador web.
// Usa el global que Capacitor inyecta en el WebView, así NO necesita importar el paquete
// (queda SSR-safe y, en web, simplemente devuelve false). Lo usan:
//   • el reporte web de /mi-ruta (para desactivarse en nativo, donde reporta el plugin)
//   • el módulo de seguimiento nativo (para no mostrar nada en web)
export function esPlataformaNativa(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}
