// src/lib/gastos/fecha-gasto.ts
//
// Reglas de la FECHA de un gasto. PURO: sin DB, sin red — se prueba suelto
// (`fecha-gasto.test.ts`) y lo comparten el servidor y la pantalla.
//
// Por qué existe: hasta el 6 ago 2026 la pantalla mandaba
// `new Date().toISOString().split("T")[0]`, o sea SIEMPRE hoy y además en UTC
// (después de las 19:00 de Lima guardaba la fecha de MAÑANA). Como no se podía
// elegir la fecha, la administradora terminó escribiéndola dentro de la
// descripción ("Gasto: Otros - PETER CON 13-07").
//
// La regla de negocio es simple y distinta a la de SUNAT: **hacia atrás sin
// límite** (cargar los gastos de julio en agosto es legítimo y es justamente el
// caso real), **hacia adelante nunca** (un gasto que todavía no ocurrió no es un
// gasto). El "hoy" SIEMPRE se resuelve en el servidor con
// `(NOW() AT TIME ZONE 'America/Lima')::date`, nunca con `new Date()`.

export const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ¿Es una fecha ISO real? Rechaza formatos raros Y fechas que no existen en el
 * calendario (`2026-02-31`), que el regex por sí solo deja pasar.
 */
export function esFechaISO(valor: unknown): valor is string {
  if (typeof valor !== "string" || !FECHA_REGEX.test(valor)) return false;
  const [a, m, d] = valor.split("-").map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  return (
    fecha.getUTCFullYear() === a &&
    fecha.getUTCMonth() === m - 1 &&
    fecha.getUTCDate() === d
  );
}

export type ResultadoFecha = { ok: true } | { ok: false; motivo: string };

/**
 * Valida la fecha de un gasto contra el "hoy" de Lima que le pasa el servidor.
 * La comparación es de strings: en ISO el orden lexicográfico es el cronológico,
 * y así se evitan los bugs de zona horaria de `Date`.
 */
export function validarFechaGasto(fecha: unknown, hoyLima: string): ResultadoFecha {
  if (!esFechaISO(fecha)) {
    return { ok: false, motivo: "La fecha del gasto no es válida (se espera AAAA-MM-DD)." };
  }
  if (fecha > hoyLima) {
    return {
      ok: false,
      motivo: `No se puede registrar un gasto con fecha futura (hoy es ${fechaBonita(hoyLima)}).`,
    };
  }
  return { ok: true };
}

/** "2026-07-13" → "13/07/2026". Sin pasar por Date: evita el corrimiento UTC. */
export function fechaBonita(fecha: string): string {
  if (!FECHA_REGEX.test(fecha)) return fecha;
  const [a, m, d] = fecha.split("-");
  return `${d}/${m}/${a}`;
}

const MESES_CORTOS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** "2026-07-13" → "13 jul". Para el chip de la fecha cuando no es hoy. */
export function fechaChip(fecha: string): string {
  if (!FECHA_REGEX.test(fecha)) return fecha;
  const [, m, d] = fecha.split("-");
  return `${Number(d)} ${MESES_CORTOS[Number(m) - 1] ?? m}`;
}

/**
 * Hoy en Lima, en formato ISO, para el DEFAULT y el `max` del input en el
 * navegador. El servidor NO confía en este valor: lo revalida con su propio
 * reloj (el de la máquina del usuario puede estar mal o en otra zona).
 */
export function hoyLimaCliente(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
