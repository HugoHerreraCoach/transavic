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

/**
 * Estima de manera inteligente el peso bruto en kg para un producto
 * cuando su unidad de medida no es KGM (por ejemplo, NIU).
 */
export function estimarPesoPorUnidad(nombreProducto: string, cantidad: number): number {
  const nombre = (nombreProducto || "").toLowerCase();
  const qty = Number(cantidad) || 0;

  // Caso 1: Huevos (Jaba de 180 huevos, jaba de 360, caja de 180, plancha, etc.)
  if (nombre.includes("huevo")) {
    if (nombre.includes("jaba") || nombre.includes("caja")) {
      if (nombre.includes("360")) {
        return qty * 23.0; // 23 kg aprox
      }
      return qty * 11.5; // 11.5 kg aprox por jaba de 180
    }
    if (nombre.includes("plancha")) {
      return qty * 1.8; // 1.8 kg aprox por plancha de 30
    }
    return qty * 0.06; // 60g por huevo individual
  }

  // Caso 2: Pollo Entero o Gallina Entera
  if (nombre.includes("pollo entero") || nombre.includes("pollo brasa")) {
    return qty * 2.2; // ~2.2 kg por pollo
  }
  if (nombre.includes("gallina") || nombre.includes("gallo")) {
    return qty * 1.8; // ~1.8 kg por gallina
  }

  // Caso 3: Filetes, Pechugas, Piernas, Alitas
  if (nombre.includes("filete") || nombre.includes("pechuga") || nombre.includes("pierna") || nombre.includes("alita")) {
    if (nombre.includes("caja") || nombre.includes("saco")) {
      return qty * 10.0;
    }
    if (nombre.includes("paquete") || nombre.includes("pack") || nombre.includes("bolsa")) {
      return qty * 1.0;
    }
    return qty * 0.25; // 250g por unidad de pieza
  }

  // Caso 4: Menudencia
  if (
    nombre.includes("menudencia") ||
    nombre.includes("molleja") ||
    nombre.includes("higado") ||
    nombre.includes("hígado") ||
    nombre.includes("pata")
  ) {
    return qty * 0.5; // 500g
  }

  // Caso 5: Pavos
  if (nombre.includes("pavo")) {
    return qty * 7.5; // ~7.5 kg
  }

  // Caso 6: Cerdo / Chancho
  if (nombre.includes("cerdo") || nombre.includes("chancho") || nombre.includes("lechón") || nombre.includes("lechon")) {
    if (nombre.includes("entero")) {
      return qty * 45.0;
    }
    return qty * 2.5; // 2.5 kg por pieza
  }

  // Caso 7: Res / Carne
  if (nombre.includes("res") || nombre.includes("bife") || nombre.includes("lomo") || nombre.includes("carne")) {
    return qty * 2.0; // 2 kg
  }

  // Fallback por defecto: 0.5 kg por unidad
  return qty * 0.5;
}

