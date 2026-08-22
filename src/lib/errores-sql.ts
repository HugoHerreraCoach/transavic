// src/lib/errores-sql.ts
// Traduce errores de Postgres a mensajes que una persona entienda.
//
// Por qué existe: al intentar anular una compra, a la usuaria le apareció en
// pantalla el texto crudo del motor, en inglés:
//   update or delete on table "cuentas_por_pagar" violates foreign key
//   constraint "pagos_proveedores_aplicaciones_deuda_fk" ...
// Eso no le dice qué hacer, la asusta, y de paso filtra nombres de tablas y
// restricciones. Ningún `error.message` de Postgres debe viajar al cliente.
//
// PURO (sin `neon`, sin React): corre en vitest (gotcha #13).

/** Códigos de Postgres que sabemos explicar. */
const VIOLACION_LLAVE_FORANEA = "23503";
const VIOLACION_UNICIDAD = "23505";
const VIOLACION_CHECK = "23514";

/** Mensajes por restricción concreta, cuando podemos ser específicos. */
const POR_RESTRICCION: Record<string, string> = {
  pagos_proveedores_aplicaciones_deuda_fk:
    "Esta compra todavía tiene pagos que la referencian. Revierte primero los abonos en la Ficha del Proveedor; si el problema sigue, avisa a administración.",
  pagos_proveedores_deuda_prioritaria_fk:
    "Un pago del proveedor todavía apunta a esta deuda. Revierte primero ese abono en la Ficha del Proveedor; si el problema sigue, avisa a administración.",
  pagos_proveedores_aplicaciones_pago_fk:
    "Este pago ya tiene documentos aplicados y no se puede quitar de esa forma. Anúlalo desde la Ficha del Proveedor.",
  cuentas_por_pagar_compra_uk: "Esta compra ya tiene una deuda registrada.",
  cuentas_por_pagar_montos_chk:
    "Los montos de la deuda no cuadran: lo pagado no puede superar el total. Avisa a administración.",
};

/** Mensaje genérico por tipo de error, cuando no reconocemos la restricción. */
const POR_CODIGO: Record<string, string> = {
  [VIOLACION_LLAVE_FORANEA]:
    "No se puede completar la operación porque hay otros registros que dependen de este. Revisa si tiene pagos o movimientos asociados.",
  [VIOLACION_UNICIDAD]: "Ese registro ya existe.",
  [VIOLACION_CHECK]: "Alguno de los datos quedó fuera de lo permitido. Revísalos e inténtalo de nuevo.",
};

const GENERICO = "No se pudo completar la operación. Vuelve a intentarlo; si sigue igual, avisa a administración.";

type ErrorPg = { code?: unknown; constraint?: unknown; message?: unknown };

/**
 * Devuelve un mensaje en español apto para mostrar al usuario.
 *
 * @param error       lo que atrapó el `catch`.
 * @param porDefecto  mensaje de respaldo para el caso que no reconocemos.
 */
export function mensajeErrorSql(error: unknown, porDefecto: string = GENERICO): string {
  const e = (error ?? {}) as ErrorPg;
  const codigo = typeof e.code === "string" ? e.code : "";

  const restriccion =
    typeof e.constraint === "string" && e.constraint
      ? e.constraint
      : // El driver HTTP de Neon no siempre expone `constraint`: lo sacamos del texto.
        nombreRestriccionEnTexto(typeof e.message === "string" ? e.message : "");

  if (restriccion && POR_RESTRICCION[restriccion]) return POR_RESTRICCION[restriccion];
  if (codigo && POR_CODIGO[codigo]) return POR_CODIGO[codigo];
  return porDefecto;
}

/** Extrae el nombre de la restricción del mensaje: `... constraint "xxx" ...`. */
function nombreRestriccionEnTexto(mensaje: string): string {
  const m = /constraint\s+"([^"]+)"/i.exec(mensaje);
  return m ? m[1] : "";
}

/** ¿Es una violación de llave foránea? Útil para decidir el status (409 vs 500). */
export function esViolacionLlaveForanea(error: unknown): boolean {
  const e = (error ?? {}) as ErrorPg;
  if (e.code === VIOLACION_LLAVE_FORANEA) return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return /violates foreign key constraint/i.test(msg);
}
