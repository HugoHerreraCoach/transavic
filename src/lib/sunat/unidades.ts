// src/lib/sunat/unidades.ts
// Mapeo ÚNICO y robusto de unidad → código SUNAT (catálogo 03 de unidades de medida).
//
// Lo usan TODOS los caminos de emisión para que la unidad salga igual en el XML
// (y por ende en el PDF, que lee del XML — gotcha #18):
//   - /api/comprobantes/emitir          (factura/boleta DESDE un pedido)
//   - /api/comprobantes/emitir-manual   (factura/boleta standalone)
//   - /api/pedidos/[id]/entregar        (auto-emisión al entregar, si está activa)
//   - emitir-client.tsx unidadSunatDesde (autocompletado del form al elegir del catálogo)
//
// 🐛 Bug que esto corrige (jun 2026): el form manda la unidad YA como código SUNAT
// ("KGM"/"NIU"), pero `/emitir` la mapeaba con `it.unidad === "kg" ? "KGM" : "NIU"`.
// Como "KGM" !== "kg", degradaba TODO a NIU → las facturas desde pedido salían en
// "UNIDAD" aunque el pedido decía kg. Este helper es IDEMPOTENTE: acepta tanto la
// unidad "cruda" del catálogo/pedido ("kg", "uni", "Kg", "kilogramo", "uni/kg"…)
// COMO el código SUNAT ya resuelto ("KGM"/"NIU"), y nunca degrada un KGM a NIU.
//
// Transavic solo usa dos unidades: KILOGRAMO (KGM) y UNIDAD (NIU). Las ambiguas del
// catálogo ("uni/kg", "kg/uni") caen a NIU por defecto; la asesora elige la unidad
// real por ítem en el form y esa elección ahora se respeta de punta a punta.

export function aUnitCodeSunat(u: string | null | undefined): "KGM" | "NIU" {
  const s = (u || "").trim().toLowerCase();
  if (s === "kgm") return "KGM"; // ya es código SUNAT
  if (
    s === "kg" ||
    s === "kgs" ||
    s === "kilo" ||
    s === "kilos" ||
    s === "kilogramo" ||
    s === "kilogramos"
  ) {
    return "KGM";
  }
  // "niu", "uni", "unidad", "uni/kg", "kg/uni" (ambiguos), "plancha", "paquete…", vacío → UNIDAD
  return "NIU";
}

/** Etiqueta legible de un código de unidad SUNAT (para mostrar al usuario). */
export function etiquetaUnidad(code: "KGM" | "NIU" | string): string {
  return code === "KGM" ? "Kilogramo" : "Unidad";
}
