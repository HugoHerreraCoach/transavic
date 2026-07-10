// src/lib/parametros-negocio.ts
// Parámetros de NEGOCIO editables por el admin desde /dashboard/configuracion
// (flexibilización 10 jul 2026). Viven en settings.parametros_negocio (JSONB).
//
// REGLA: los DEFAULTS de aquí son EXACTAMENTE los valores que antes estaban
// hardcodeados en el código — si la clave no existe en la DB, todo se comporta
// igual que siempre. Los consumidores SIEMPRE leen con fallback (nunca revientan
// por un setting ausente o malformado).
import type { NeonQueryFunction } from "@neondatabase/serverless";

export interface ParametrosNegocio {
  /** Categorías del select de gastos (caja diaria y página de gastos). */
  categorias_gasto: string[];
  /** Tipos de documento del form de compras. */
  tipos_doc_compra: string[];
  /** Semáforo de margen del catálogo: verde si ≥ bueno, ámbar si ≥ regular, rojo debajo. */
  margen_bueno_pct: number;
  margen_regular_pct: number;
  /** Umbral de alerta de merma alta (%) en la calculadora de mermas. */
  merma_alta_pct: number;
  /** Rendimiento usado por Rentabilidad cuando no hay mermas registradas (%). */
  rendimiento_fallback_pct: number;
  /** Cortes de antigüedad de deuda del panel avícola (días). */
  cortes_deuda_avicola: [number, number, number];
}

/** Los valores históricos del código — NO cambiar sin migrar a los consumidores. */
export const PARAMETROS_NEGOCIO_DEFAULT: ParametrosNegocio = {
  // Exactamente los values del select histórico de caja-diaria (los gastos viejos
  // guardan estos strings — por eso el default los conserva tal cual).
  categorias_gasto: ["Almuerzo", "Limpieza", "Combustible", "Útiles", "Mantenimiento", "Sencillo", "Otros"],
  tipos_doc_compra: ["Factura", "Boleta", "Guia", "Sin Documento"],
  margen_bueno_pct: 25,
  margen_regular_pct: 15,
  merma_alta_pct: 10,
  rendimiento_fallback_pct: 80,
  cortes_deuda_avicola: [7, 15, 30],
};

/** Mezcla lo guardado con los defaults, tolerando settings viejos o incompletos. */
export function normalizarParametros(crudo: unknown): ParametrosNegocio {
  const base = { ...PARAMETROS_NEGOCIO_DEFAULT };
  if (typeof crudo !== "object" || crudo === null) return base;
  const p = crudo as Partial<Record<keyof ParametrosNegocio, unknown>>;

  const listaDeTextos = (v: unknown): string[] | null =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.trim() !== "")
      ? (v as string[]).map((x) => x.trim())
      : null;
  const numeroPositivo = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

  base.categorias_gasto = listaDeTextos(p.categorias_gasto) ?? base.categorias_gasto;
  base.tipos_doc_compra = listaDeTextos(p.tipos_doc_compra) ?? base.tipos_doc_compra;
  base.margen_bueno_pct = numeroPositivo(p.margen_bueno_pct) ?? base.margen_bueno_pct;
  base.margen_regular_pct = numeroPositivo(p.margen_regular_pct) ?? base.margen_regular_pct;
  base.merma_alta_pct = numeroPositivo(p.merma_alta_pct) ?? base.merma_alta_pct;
  base.rendimiento_fallback_pct =
    numeroPositivo(p.rendimiento_fallback_pct) ?? base.rendimiento_fallback_pct;
  if (
    Array.isArray(p.cortes_deuda_avicola) &&
    p.cortes_deuda_avicola.length === 3 &&
    p.cortes_deuda_avicola.every((n) => typeof n === "number" && n > 0)
  ) {
    base.cortes_deuda_avicola = [...(p.cortes_deuda_avicola as [number, number, number])];
  }
  return base;
}

/** Lectura SERVER-SIDE (route handlers): nunca lanza; ante cualquier fallo, defaults. */
export async function leerParametrosNegocio(
  sql: NeonQueryFunction<false, false>
): Promise<ParametrosNegocio> {
  try {
    const filas = await sql`SELECT value FROM settings WHERE key = 'parametros_negocio'`;
    return normalizarParametros(filas[0]?.value);
  } catch {
    return { ...PARAMETROS_NEGOCIO_DEFAULT };
  }
}

/** Lectura CLIENT-SIDE (componentes "use client"): nunca lanza; ante fallo, defaults. */
export async function fetchParametrosNegocio(): Promise<ParametrosNegocio> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return { ...PARAMETROS_NEGOCIO_DEFAULT };
    const data = await res.json();
    return normalizarParametros(data?.parametros_negocio);
  } catch {
    return { ...PARAMETROS_NEGOCIO_DEFAULT };
  }
}
