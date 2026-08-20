// src/lib/permisos-precios.ts
// Quién puede editar el catálogo de productos y QUÉ campos puede tocar.
//
// Regla de negocio (20 ago 2026, pedido de Antonio para Yali):
//   - admin                              → todo el producto, como siempre.
//   - asesor + puede_editar_precio_venta → SOLO `precio_venta`. Ni el costo,
//     ni activar/desactivar, ni renombrar.
//   - cualquier otro                     → nada.
//
// ⚠️ El PATCH de /api/productos/[id] acepta ocho campos en el mismo body
// (precio_venta, precio_compra, nombre, codigo, categoria, unidad, activo…).
// Sin esta función, ampliar el guard del rol le daría a la asesora el COSTO y la
// baja de productos. Por eso el permiso es POR CAMPO, no por endpoint.
//
// PURO (sin `neon`, sin React): corre en vitest (gotcha #13).

/** Único campo que puede cambiar quien tiene el permiso puntual. */
export const CAMPO_PRECIO_VENTA = "precio_venta";

export type SesionCatalogo = {
  role?: string | null;
  puede_editar_precio_venta?: boolean | null;
};

export type PermisoCatalogo =
  | { ok: true; alcance: "total" | "solo_precio_venta" }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Decide si esta sesión puede aplicar este PATCH sobre un producto.
 *
 * @param sesion  `session.user`, o null/undefined si no hay sesión.
 * @param campos  `Object.keys(body)` del PATCH — los campos que se pretenden tocar.
 *
 * Fail-closed: ante un campo desconocido, o un rol que no esperamos, niega.
 */
export function evaluarEdicionCatalogo(
  sesion: SesionCatalogo | null | undefined,
  campos: string[]
): PermisoCatalogo {
  if (!sesion?.role) {
    return { ok: false, status: 401, error: "No autorizado." };
  }

  if (sesion.role === "admin") {
    return { ok: true, alcance: "total" };
  }

  // Fuera del admin, el único permiso puntual que existe hoy es el de la asesora
  // que ajusta el precio de venta. Se exigen las DOS cosas: si el rol cambió y la
  // bandera quedó encendida en la fila (dato viejo), no alcanza.
  if (sesion.role !== "asesor" || sesion.puede_editar_precio_venta !== true) {
    return {
      ok: false,
      status: 403,
      error: "No tienes permiso para editar el catálogo.",
    };
  }

  const prohibidos = campos.filter((campo) => campo !== CAMPO_PRECIO_VENTA);
  if (prohibidos.length > 0) {
    return {
      ok: false,
      status: 403,
      error: `Solo puedes cambiar el precio de venta. No puedes modificar: ${prohibidos.join(", ")}.`,
    };
  }

  return { ok: true, alcance: "solo_precio_venta" };
}
