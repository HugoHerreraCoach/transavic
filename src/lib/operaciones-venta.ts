// src/lib/operaciones-venta.ts
// Fuente ÚNICA del color/etiqueta por OPERACIÓN de venta (decisión de Antonio, jul 2026:
// 3 sistemas separados). NO confundir con el color de EMPRESA (Transavic rojo / Avícola
// teal) — operación y empresa son dimensiones distintas y coexisten.
//
// Colores (confirmados con el usuario, 12 jul 2026):
//   🛵 Ejecutivas = AZUL, 🏪 Campo = ÁMBAR, 🏭 Planta = VIOLETA.
// Se usan como ACENTO SUTIL (chip + borde + punto), nunca como fondo completo — el
// rojo se reserva al estado activo/marca.
//
// Consumidores: chip de la lista de comprobantes, vista Ventas Generales, header de
// Ventas en Campo y los encabezados de grupo del sidebar.

export type OperacionVenta = "ejecutivas" | "campo" | "planta";

export interface EstiloOperacion {
  /** Nombre corto para mostrar. */
  label: string;
  /** Emoji marcador (coincide con los grupos del sidebar). */
  emoji: string;
  /** Chip pequeño: fondo tenue + texto + borde. */
  chipClass: string;
  /** Borde de acento (izquierdo) para tarjetas/filas destacadas. */
  borderClass: string;
  /** Punto de color (leyendas, headers de grupo). */
  dotClass: string;
  /** Color de texto sólido (títulos de sección). */
  textClass: string;
}

export const OPERACIONES: Record<OperacionVenta, EstiloOperacion> = {
  ejecutivas: {
    label: "Ejecutivas",
    emoji: "🛵",
    chipClass: "bg-blue-50 text-blue-700 border border-blue-200",
    borderClass: "border-blue-500",
    dotClass: "bg-blue-500",
    textClass: "text-blue-700",
  },
  campo: {
    label: "Campo",
    emoji: "🏪",
    chipClass: "bg-amber-50 text-amber-700 border border-amber-200",
    borderClass: "border-amber-500",
    dotClass: "bg-amber-500",
    textClass: "text-amber-700",
  },
  planta: {
    label: "Planta",
    emoji: "🏭",
    chipClass: "bg-violet-50 text-violet-700 border border-violet-200",
    borderClass: "border-violet-500",
    dotClass: "bg-violet-500",
    textClass: "text-violet-700",
  },
};

/** Etiqueta con emoji lista para mostrar (ej. "🏪 Campo"). */
export function labelOperacion(op: OperacionVenta): string {
  const e = OPERACIONES[op];
  return `${e.emoji} ${e.label}`;
}

/**
 * Deriva la operación de venta de un comprobante a partir de sus vínculos.
 * Regla (coherente con la derivación del backend en /api/comprobantes):
 *   - venta_avicola_id presente        → campo
 *   - pedido con origen 'pos_planta'   → planta
 *   - resto (pedido de asesora o suelto)→ ejecutivas
 */
export function operacionDeComprobante(input: {
  venta_avicola_id?: string | null;
  pedido_origen?: string | null;
}): OperacionVenta {
  if (input.venta_avicola_id) return "campo";
  if (input.pedido_origen === "pos_planta") return "planta";
  return "ejecutivas";
}
