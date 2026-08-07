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
  /** Umbral de alerta de merma alta (%) en el cuadre de pollo. */
  merma_alta_pct: number;
  /**
   * Merma ESPERADA del beneficio, en kg por ave (Cuadre de Pollo).
   * Es el número que Marianela aplica al total de aves en su Excel — verificado
   * en las 32 hojas de marzo 2026, todas dan 0.32 exacto.
   */
  merma_estandar_ave_kg: number;
  /** Rendimiento usado por Rentabilidad cuando no hay mermas registradas (%). */
  rendimiento_fallback_pct: number;
  /** Cortes de antigüedad de deuda del panel avícola (días). */
  cortes_deuda_avicola: [number, number, number];
}

/** Los valores históricos del código — NO cambiar sin migrar a los consumidores. */
export const PARAMETROS_NEGOCIO_DEFAULT: ParametrosNegocio = {
  // Exactamente los values del select histórico de caja-diaria (los gastos viejos
  // guardan estos strings — por eso el default los conserva tal cual).
  // "Delivery" se sumó el 6 ago 2026 a pedido de Marianela; el resto las crea
  // ella misma desde el propio formulario (ver `agregarALista`).
  categorias_gasto: [
    "Almuerzo",
    "Limpieza",
    "Combustible",
    "Delivery",
    "Útiles",
    "Mantenimiento",
    "Sencillo",
    "Otros",
  ],
  tipos_doc_compra: ["Factura", "Boleta", "Guia", "Sin Documento"],
  margen_bueno_pct: 25,
  margen_regular_pct: 15,
  merma_alta_pct: 10,
  merma_estandar_ave_kg: 0.32,
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
  base.merma_estandar_ave_kg =
    numeroPositivo(p.merma_estandar_ave_kg) ?? base.merma_estandar_ave_kg;
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

/* ────────────────────────────────────────────────────────────────────────────
 * Agregar UNA opción a una lista
 *
 * Por qué existe (6 ago 2026): las categorías de gasto solo se podían tocar en
 * /dashboard/configuracion, que es admin-only y está en otra pantalla — así que
 * cuando a la administradora le faltaba una ("Delivery"), la vía real era
 * abandonar lo que estaba haciendo. Ahora se crea desde el propio formulario.
 *
 * El helper es PURO para poder probarlo; el read-modify-write vive en
 * POST /api/parametros-negocio/lista (en el SERVIDOR, nunca mandando el objeto
 * entero desde el cliente: `POST /api/settings` reescribe la clave completa y
 * pisaría los umbrales que otro admin esté editando).
 * ──────────────────────────────────────────────────────────────────────────── */

/** Las claves de ParametrosNegocio que son listas de texto ampliables. */
export const LISTAS_AMPLIABLES = ["categorias_gasto", "tipos_doc_compra"] as const;
export type ListaAmpliable = (typeof LISTAS_AMPLIABLES)[number];

/** Topes para que la lista no se vuelva un basurero imposible de usar. */
export const MAX_OPCIONES_LISTA = 40;
export const MAX_LARGO_OPCION = 30;

/** Clave de comparación: sin tildes y sin mayúsculas ("Delívery" == "delivery"). */
function claveDeComparacion(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marcas diacriticas
    .toLowerCase();
}

export type ResultadoAgregar =
  | { ok: true; lista: string[]; canonico: string; yaExistia: boolean }
  | { ok: false; error: string };

/**
 * Devuelve la lista con `valor` agregado al final, o el valor que YA existía.
 *
 * Que ya exista NO es un error: quien lo escribió quiere usar esa opción, así
 * que se le devuelve la que hay (con su forma original) y la UI la selecciona.
 */
export function agregarALista(lista: string[], valor: string): ResultadoAgregar {
  const limpio = String(valor ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!limpio) return { ok: false, error: "Escribe un nombre." };
  if (limpio.length > MAX_LARGO_OPCION) {
    return { ok: false, error: `Máximo ${MAX_LARGO_OPCION} caracteres.` };
  }

  // Primera letra en mayúscula para que no convivan "delivery" y "Delivery".
  const canonico = limpio.charAt(0).toUpperCase() + limpio.slice(1);

  const clave = claveDeComparacion(canonico);
  const existente = lista.find((x) => claveDeComparacion(x) === clave);
  if (existente) return { ok: true, lista, canonico: existente, yaExistia: true };

  if (lista.length >= MAX_OPCIONES_LISTA) {
    return { ok: false, error: `Ya hay ${MAX_OPCIONES_LISTA} opciones. Quita alguna en Configuración.` };
  }

  return { ok: true, lista: [...lista, canonico], canonico, yaExistia: false };
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
