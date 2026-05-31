// src/lib/pedido-historial.ts
// Lógica de auditoría de ediciones de un pedido.
//
// El PATCH de /api/pedidos/[id] sirve para muchas cosas (corregir datos del
// pedido, asignar repartidor, cambiar estado, optimizar ruta…). Aquí SOLO nos
// interesan las "correcciones" de los datos del pedido — lo que un humano edita
// desde el modal "Editar Pedido" — no el ruido del ciclo de vida (estado,
// repartidor, orden de ruta, banderas legacy). Por eso auditamos un conjunto
// acotado de campos con etiquetas legibles para el admin.

/** Campos que se auditan, con su etiqueta legible para mostrar al admin. */
export const CAMPOS_AUDITABLES: Record<string, string> = {
  cliente: "Cliente",
  whatsapp: "WhatsApp",
  direccion: "Dirección",
  distrito: "Distrito",
  tipo_cliente: "Tipo de cliente",
  detalle: "Detalle del pedido",
  hora_entrega: "Horario de entrega",
  razon_social: "Razón social",
  ruc_dni: "RUC / DNI",
  notas: "Notas",
  detalle_final: "Detalle final",
  empresa: "Empresa",
  fecha_pedido: "Fecha de entrega",
};

export interface CambioCampo {
  campo: string;
  etiqueta: string;
  antes: string;
  despues: string;
}

/**
 * Normaliza un valor para comparar: null/undefined → "", y recorta espacios.
 * Así "  " vs null no cuenta como cambio, y evitamos diffs falsos por formato.
 */
function norm(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Compara los valores "antes" (lo que había en la DB) contra "después" (lo que
 * trae el PATCH) y devuelve solo los campos auditables que cambiaron de verdad.
 *
 * `despues` puede traer más campos de los auditables (el PATCH manda todo el
 * pedido); solo miramos las claves de CAMPOS_AUDITABLES que vengan presentes.
 */
export function calcularCambios(
  antes: Record<string, unknown>,
  despues: Record<string, unknown>
): CambioCampo[] {
  const cambios: CambioCampo[] = [];
  for (const [campo, etiqueta] of Object.entries(CAMPOS_AUDITABLES)) {
    if (!(campo in despues)) continue; // el PATCH no tocó este campo
    const antesV = norm(antes[campo]);
    const despuesV = norm(despues[campo]);
    if (antesV !== despuesV) {
      cambios.push({ campo, etiqueta, antes: antesV, despues: despuesV });
    }
  }
  return cambios;
}

/** ¿El payload del PATCH incluye al menos un campo auditable? (para no leer la DB de gusto) */
export function tocaCamposAuditables(despues: Record<string, unknown>): boolean {
  return Object.keys(CAMPOS_AUDITABLES).some((campo) => campo in despues);
}
