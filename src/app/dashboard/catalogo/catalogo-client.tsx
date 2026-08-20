// src/app/dashboard/catalogo/catalogo-client.tsx
// Wrapper finito de la pantalla /catalogo. Antes contenía las 2 tabs
// (Productos / Precios) que partían el mismo objeto en dos vistas.
// Ahora hay una sola vista unificada que muestra todo el producto
// (nombre, código, categoría, unidad, precio compra, precio venta).
"use client";

import CatalogoUnificado from "./catalogo-unificado";

// Dos permisos DISTINTOS, a propósito:
//   isAdmin                → gestión completa: costo, margen, historial, alta y baja.
//   puedeEditarPrecioVenta → solo cambiar el precio de venta (admin, o una asesora
//                            con el permiso puntual que le da Antonio).
// Una asesora sin el permiso ve la lista en SOLO LECTURA, como siempre.
export default function CatalogoClient({
  isAdmin,
  puedeEditarPrecioVenta,
}: {
  isAdmin: boolean;
  puedeEditarPrecioVenta: boolean;
}) {
  return <CatalogoUnificado isAdmin={isAdmin} puedeEditarPrecioVenta={puedeEditarPrecioVenta} />;
}
