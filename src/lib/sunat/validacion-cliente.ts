// src/lib/sunat/validacion-cliente.ts
// ─────────────────────────────────────────────────────────────────────────────
// Validación del documento del receptor (cliente) para comprobantes.
//
// Existe porque se detectaron boletas emitidas con datos basura: un DNI de 8
// ceros ("00000000") y nombres de cliente sin documento (tipo "0" + "keila roja").
// SUNAT en boletas < S/700 no exige identificar al cliente, así que esos pasaron.
// Estas funciones son la fuente de verdad para rechazar documentos de relleno y
// para distinguir "cliente identificado" de "consumidor final genérico".
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DNI válido para SUNAT: exactamente 8 dígitos y NO de relleno.
 * No se puede validar el dígito verificador (SUNAT no lo exige en boleta), pero
 * sí rechazamos los rellenos obvios: todo ceros ("00000000") o todos el mismo
 * dígito ("11111111"), que son los que usaban para "saltarse" el campo.
 */
export function esDniValido(doc: string | null | undefined): boolean {
  const d = (doc ?? "").trim();
  if (!/^\d{8}$/.test(d)) return false;
  if (/^(\d)\1{7}$/.test(d)) return false; // 8 dígitos iguales (00000000, 11111111…)
  return true;
}

/**
 * RUC válido: 11 dígitos, prefijo de tipo de contribuyente (10/15/16/17/20) Y
 * dígito verificador correcto (módulo 11). Rechaza un RUC mal tecleado (que pasa
 * el formato pero no el check) → evita facturar a un RUC equivocado.
 */
export function esRucValido(doc: string | null | undefined): boolean {
  const d = (doc ?? "").trim();
  if (!/^(10|15|16|17|20)\d{9}$/.test(d)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += parseInt(d[i], 10) * pesos[i];
  let resto = 11 - (suma % 11);
  if (resto === 10) resto = 0;
  if (resto === 11) resto = 1;
  return resto === parseInt(d[10], 10);
}

/** El receptor está identificado con un documento válido (DNI o RUC). */
export function esReceptorIdentificado(doc: string | null | undefined): boolean {
  return esDniValido(doc) || esRucValido(doc);
}

/**
 * ¿La razón social es un nombre específico de cliente (no vacío ni el genérico
 * "CLIENTES VARIOS")? Si lo es, la boleta debe identificar al cliente con doc.
 */
export function tieneNombreEspecifico(razon: string | null | undefined): boolean {
  const r = (razon ?? "").trim().toUpperCase();
  return r !== "" && r !== "CLIENTES VARIOS";
}
