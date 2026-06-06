// src/lib/impresion.ts
//
// Helper para que el REPORTE DE PEDIDOS (VistaImpresion.tsx) salga en la ticketera
// térmica de 80mm SIN sobrante de papel en blanco al final.
//
// La ticketera es de impresión continua, pero quien arma el trabajo de impresión es
// el navegador (Chrome), y Chrome sí piensa en "páginas": si no hay regla @page, usa
// el papel por defecto del sistema (Carta/A4, ~297mm) y le manda a la impresora una
// página MÁS ALTA que el contenido → la ticketera alimenta todo ese alto, incluido el
// relleno vacío del final. La solución es medir el alto real del reporte y fijar
// @page con ese alto exacto, así Chrome manda una sola página del tamaño justo.
//
// NO usar `@page { size: 80mm auto }`: es CSS inválido y Chrome lo descarta (ver
// gotcha #23 en CLAUDE.md). La forma válida y respetada por Chrome es `80mm <N>mm`.

// 1in = 96px CSS = 25.4mm → factor para convertir px CSS a milímetros.
const PX_A_MM = 25.4 / 96;

// Colchón en mm para no recortar la última línea por redondeo / subpíxeles.
const COLCHON_MM = 4;

/**
 * Mide la altura (en mm) que tendrá el reporte impreso en formato Ticket (80mm).
 *
 * El contenedor real (`.impresion-container`) vive en el DOM como `display:none`
 * (clase `hidden`), así que no es medible directamente. Se clona su HTML en un nodo
 * fuera de pantalla con la clase `.medir-impresion` (que en globals.css le aplica el
 * mismo ancho 80mm + tipografía 9pt + grid colapsado que usa la impresión), se lee su
 * `scrollHeight` y se convierte a mm. Devuelve 0 si no hay nada que medir.
 */
function medirAlturaTicketMm(): number {
  if (typeof document === "undefined") return 0;

  const fuente = document.querySelector(".impresion-container");
  if (!fuente) return 0;

  const contenedor = document.createElement("div");
  contenedor.className = "medir-impresion";
  contenedor.setAttribute("aria-hidden", "true");
  contenedor.style.cssText =
    "position:fixed;left:-10000px;top:0;visibility:hidden;";
  contenedor.innerHTML = fuente.outerHTML;

  document.body.appendChild(contenedor);
  const alturaPx = (contenedor.firstElementChild as HTMLElement | null)?.scrollHeight ?? 0;
  document.body.removeChild(contenedor);

  return alturaPx * PX_A_MM;
}

/**
 * Fija la regla @page adecuada justo antes de imprimir, según el formato.
 *
 * - Ticket: `@page { size: 80mm <alto-exacto>mm; margin: 0 }` → una sola tira continua
 *   del tamaño del contenido, sin sobrante. Si no hay nada medible, deja el estilo
 *   vacío (se comporta como antes).
 * - A4: `@page { size: A4; margin: 1cm }` → default normal explícito (evita heredar un
 *   alto de Ticket de una impresión previa).
 *
 * El <style> se limpia automáticamente tras imprimir (evento `afterprint`) para que la
 * altura del Ticket no quede pegada para otros trabajos de impresión.
 */
export function aplicarTamanoPaginaImpresion(formato: "A4" | "Ticket"): void {
  if (typeof document === "undefined") return;

  let estilo = document.getElementById("page-size-impresion") as HTMLStyleElement | null;
  if (!estilo) {
    estilo = document.createElement("style");
    estilo.id = "page-size-impresion";
    document.head.appendChild(estilo);
  }

  if (formato === "Ticket") {
    const mm = medirAlturaTicketMm();
    estilo.textContent =
      mm > 0
        ? `@media print { @page { size: 80mm ${Math.ceil(mm) + COLCHON_MM}mm; margin: 0; } }`
        : "";
  } else {
    estilo.textContent = `@media print { @page { size: A4; margin: 1cm; } }`;
  }

  // Limpiar la regla después de imprimir para no afectar trabajos posteriores.
  window.addEventListener(
    "afterprint",
    () => {
      const e = document.getElementById("page-size-impresion");
      if (e) e.textContent = "";
    },
    { once: true }
  );
}
