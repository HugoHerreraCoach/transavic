// src/lib/compras-lineas.ts
// Fuente ÚNICA de la regla "línea de compra SIN peso" (compartida por el form
// `compras-client.tsx` y el backend `api/compras/route.ts` — antes estaba
// duplicada como `esCategoriaServicio` y se podía desincronizar).
//
// Una línea SIN peso se digita como cantidad × precio (no jabas/tara), suma a la
// deuda del proveedor y NO toca inventario / kardex / precio_compra. Cubre:
//   - Servicios (ej. "Pelada de pollo", "SERVICIO DE ENVIO")
//   - Insumos (ej. arcos, mandil — pedido de Nelita, 11 jul 2026)
//   - El genérico "producto adicional" (catch-all de ítems varios)
// La detección es por categoría (texto libre en el catálogo).
export const esLineaSinPeso = (categoria?: string | null): boolean =>
  /servicio|insumo|adicional/i.test(categoria ?? "");
