// src/app/dashboard/catalogo/catalogo-client.tsx
// Wrapper finito de la pantalla /catalogo. Antes contenía las 2 tabs
// (Productos / Precios) que partían el mismo objeto en dos vistas.
// Ahora hay una sola vista unificada que muestra todo el producto
// (nombre, código, categoría, unidad, precio compra, precio venta).
"use client";

import CatalogoUnificado from "./catalogo-unificado";

export default function CatalogoClient() {
  return <CatalogoUnificado />;
}
