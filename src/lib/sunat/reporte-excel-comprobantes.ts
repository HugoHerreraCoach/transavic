// src/lib/sunat/reporte-excel-comprobantes.ts
// Generador de reporte Excel multi-hoja para el contador (server-side).
//
// Portado del modelo de conexipema-eventos (generar-reporte-excel.ts), adaptado
// a Transavic: estados en minúscula, 2 empresas emisoras, y montos que vienen
// de la columna `comprobantes` (monto_subtotal / monto_igv / monto_total).
//
// El workbook tiene hasta 5 hojas:
//   1. Resumen           — por tipo · por estado · desglose diario
//   2. Registro de Ventas — lista cronológica unificada (lo más útil al contador)
//   3. Boletas           — detalle (si hay)
//   4. Facturas          — detalle (si hay)
//   5. Notas de Crédito  — detalle (si hay)
//
// Reglas contables (igual que conexipema):
//   - Las Notas de Crédito (07) RESTAN del total.
//   - Los estados inválidos (rechazado, error, anulado) NO suman — no son
//     documentos fiscales válidos.
import * as XLSX from "xlsx";

// ── Tipos ───────────────────────────────────────────────────

/** Fila tal como sale de la query del endpoint. */
export interface FilaComprobante {
  serie: string;
  numero: number | string;
  serie_numero: string;
  tipo: string; // "01" | "03" | "07"
  empresa: string; // "transavic" | "avicola"
  cliente_doc_tipo: string | null;
  cliente_doc_num: string | null;
  cliente_razon_social: string | null;
  monto_subtotal: string | number;
  monto_igv: string | number;
  monto_total: string | number;
  estado: string; // lowercase: aceptado | observado | pendiente | rechazado | error | anulado
  mensaje_sunat: string | null;
  created_at: string | Date;
  forma_pago: string | null;
  fecha_vencimiento: string | Date | null;
}

export interface PeriodoReporte {
  desde: string; // "YYYY-MM-DD" o "todo"
  hasta: string; // "YYYY-MM-DD" o "todo"
  etiqueta: string; // legible: "Mayo 2026", "01/05/2026 al 28/05/2026", "Todos los comprobantes"
}

// ── Constantes ──────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  "01": "Factura",
  "03": "Boleta",
  "07": "Nota de Crédito",
  "08": "Nota de Débito",
};

const ESTADO_LABELS: Record<string, string> = {
  aceptado: "Aceptado",
  observado: "Aceptado c/ Obs.",
  pendiente: "Pendiente",
  rechazado: "Rechazado",
  error: "Error",
  anulado: "Anulado",
};

const EMPRESA_LABELS: Record<string, string> = {
  transavic: "Transavic",
  avicola: "Avícola de Tony",
};

// Estados que NO son documentos fiscales válidos → fuera de las sumas.
const ESTADOS_INVALIDOS = ["rechazado", "error", "anulado"];

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
};

/** Fecha de emisión en formato DD/MM/YYYY (zona Lima). */
function fechaEmision(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v) : v;
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Clave de día (YYYY-MM-DD en zona Lima) para agrupar el desglose diario. */
function diaClave(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v) : v;
  // en-CA da YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// ── Encabezados de las hojas de detalle ─────────────────────

const DETAIL_HEADERS = [
  "Nº",
  "Fecha de Emisión",
  "Tipo",
  "Serie",
  "Número",
  "Tipo Doc.",
  "RUC / DNI",
  "Cliente / Razón Social",
  "Empresa",
  "Base Imponible",
  "IGV (18%)",
  "Total",
  "Forma de Pago",
  "Estado SUNAT",
];

const DETAIL_WIDTHS = [
  { wch: 5 }, { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 12 },
  { wch: 10 }, { wch: 14 }, { wch: 36 }, { wch: 16 }, { wch: 16 },
  { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
];

// ── Hoja de detalle (Boletas / Facturas / NC) ───────────────

function buildDetailSheet(items: FilaComprobante[], titulo: string): XLSX.WorkSheet {
  const rows: (string | number)[][] = [];
  rows.push([titulo]);
  rows.push([]);
  rows.push(DETAIL_HEADERS);

  let sumBase = 0;
  let sumIgv = 0;
  let sumTotal = 0;

  items.forEach((it, idx) => {
    const valido = !ESTADOS_INVALIDOS.includes(it.estado);
    if (valido) {
      sumBase += num(it.monto_subtotal);
      sumIgv += num(it.monto_igv);
      sumTotal += num(it.monto_total);
    }
    rows.push([
      idx + 1,
      fechaEmision(it.created_at),
      TIPO_LABELS[it.tipo] ?? it.tipo,
      it.serie ?? "",
      String(it.numero ?? ""),
      it.cliente_doc_tipo ?? "",
      it.cliente_doc_num ?? "",
      it.cliente_razon_social ?? "",
      EMPRESA_LABELS[it.empresa] ?? it.empresa,
      r2(num(it.monto_subtotal)),
      r2(num(it.monto_igv)),
      r2(num(it.monto_total)),
      it.forma_pago ?? "Contado",
      ESTADO_LABELS[it.estado] ?? it.estado,
    ]);
  });

  rows.push([]);
  rows.push([
    "", "", "", "", "", "", "", "", "TOTALES",
    r2(sumBase), r2(sumIgv), r2(sumTotal), "", "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = DETAIL_WIDTHS;
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: DETAIL_HEADERS.length - 1 } }];
  return ws;
}

// ── Hoja "Registro de Ventas" (unificada, cronológica) ──────

function buildRegistroVentasSheet(
  items: FilaComprobante[],
  periodo: PeriodoReporte
): XLSX.WorkSheet {
  const rows: (string | number)[][] = [];
  rows.push(["REGISTRO DE VENTAS — TRANSAVIC / AVÍCOLA DE TONY"]);
  rows.push([`Período: ${periodo.etiqueta}`]);
  rows.push([
    `Generado: ${new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date())}`,
  ]);
  rows.push([]);
  rows.push(DETAIL_HEADERS);

  const ordenados = [...items].sort((a, b) => {
    const fa = diaClave(a.created_at);
    const fb = diaClave(b.created_at);
    if (fa !== fb) return fa.localeCompare(fb);
    return a.serie_numero.localeCompare(b.serie_numero);
  });

  let sumBase = 0;
  let sumIgv = 0;
  let sumTotal = 0;

  ordenados.forEach((it, idx) => {
    const isNC = it.tipo === "07";
    const valido = !ESTADOS_INVALIDOS.includes(it.estado);
    const sign = isNC ? -1 : 1;
    if (valido) {
      sumBase += num(it.monto_subtotal) * sign;
      sumIgv += num(it.monto_igv) * sign;
      sumTotal += num(it.monto_total) * sign;
    }
    rows.push([
      idx + 1,
      fechaEmision(it.created_at),
      TIPO_LABELS[it.tipo] ?? it.tipo,
      it.serie ?? "",
      String(it.numero ?? ""),
      it.cliente_doc_tipo ?? "",
      it.cliente_doc_num ?? "",
      it.cliente_razon_social ?? "",
      EMPRESA_LABELS[it.empresa] ?? it.empresa,
      isNC ? -r2(num(it.monto_subtotal)) : r2(num(it.monto_subtotal)),
      isNC ? -r2(num(it.monto_igv)) : r2(num(it.monto_igv)),
      isNC ? -r2(num(it.monto_total)) : r2(num(it.monto_total)),
      it.forma_pago ?? "Contado",
      ESTADO_LABELS[it.estado] ?? it.estado,
    ]);
  });

  rows.push([]);
  rows.push([
    "", "", "", "", "", "", "", "", "TOTALES NETOS",
    r2(sumBase), r2(sumIgv), r2(sumTotal), "", "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = DETAIL_WIDTHS;
  const colCount = DETAIL_HEADERS.length - 1;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: colCount } },
  ];
  return ws;
}

// ── Hoja "Resumen" ──────────────────────────────────────────

function buildResumenSheet(
  items: FilaComprobante[],
  periodo: PeriodoReporte
): XLSX.WorkSheet {
  const validos = items.filter((i) => !ESTADOS_INVALIDOS.includes(i.estado));

  const sumPorTipo = (t: string) => {
    const arr = validos.filter((i) => i.tipo === t);
    return {
      count: arr.length,
      base: arr.reduce((s, i) => s + num(i.monto_subtotal), 0),
      igv: arr.reduce((s, i) => s + num(i.monto_igv), 0),
      total: arr.reduce((s, i) => s + num(i.monto_total), 0),
    };
  };

  const sFac = sumPorTipo("01");
  const sBol = sumPorTipo("03");
  const sNC = sumPorTipo("07");

  // NC restan del total neto.
  const totalCount = sFac.count + sBol.count + sNC.count;
  const totalBase = sFac.base + sBol.base - sNC.base;
  const totalIgv = sFac.igv + sBol.igv - sNC.igv;
  const totalImporte = sFac.total + sBol.total - sNC.total;

  const rows: (string | number)[][] = [];
  rows.push(["RESUMEN DE COMPROBANTES ELECTRÓNICOS"]);
  rows.push(["Transavic / Avícola de Tony"]);
  rows.push([`Período: ${periodo.etiqueta}`]);
  rows.push([
    `Generado: ${new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date())}`,
  ]);
  rows.push([]);

  // Sección 1 — por tipo
  rows.push(["RESUMEN POR TIPO DE COMPROBANTE"]);
  rows.push(["Tipo", "Cantidad", "Base Imponible (S/)", "IGV 18% (S/)", "Importe Total (S/)"]);
  rows.push(["Facturas", sFac.count, r2(sFac.base), r2(sFac.igv), r2(sFac.total)]);
  rows.push(["Boletas", sBol.count, r2(sBol.base), r2(sBol.igv), r2(sBol.total)]);
  rows.push(["Notas de Crédito", sNC.count, -r2(sNC.base), -r2(sNC.igv), -r2(sNC.total)]);
  rows.push([]);
  rows.push(["TOTAL NETO", totalCount, r2(totalBase), r2(totalIgv), r2(totalImporte)]);
  rows.push([]);

  // Sección 2 — por estado (incluye inválidos, solo informativo)
  const estadoCounts: Record<string, { count: number; total: number }> = {};
  for (const it of items) {
    if (!estadoCounts[it.estado]) estadoCounts[it.estado] = { count: 0, total: 0 };
    estadoCounts[it.estado].count++;
    if (!ESTADOS_INVALIDOS.includes(it.estado)) {
      estadoCounts[it.estado].total += num(it.monto_total);
    }
  }
  rows.push(["RESUMEN POR ESTADO SUNAT"]);
  rows.push(["Estado", "Cantidad", "", "", "Importe Total (S/)"]);
  for (const [estado, info] of Object.entries(estadoCounts)) {
    rows.push([ESTADO_LABELS[estado] ?? estado, info.count, "", "", r2(info.total)]);
  }
  rows.push([]);

  // Sección 3 — desglose diario (solo válidos; NC restan)
  const dailyMap: Record<
    string,
    { facturas: number; boletas: number; nc: number; base: number; igv: number; total: number }
  > = {};
  for (const it of validos) {
    const k = diaClave(it.created_at);
    if (!dailyMap[k]) dailyMap[k] = { facturas: 0, boletas: 0, nc: 0, base: 0, igv: 0, total: 0 };
    const sign = it.tipo === "07" ? -1 : 1;
    if (it.tipo === "01") dailyMap[k].facturas++;
    else if (it.tipo === "03") dailyMap[k].boletas++;
    else if (it.tipo === "07") dailyMap[k].nc++;
    dailyMap[k].base += num(it.monto_subtotal) * sign;
    dailyMap[k].igv += num(it.monto_igv) * sign;
    dailyMap[k].total += num(it.monto_total) * sign;
  }
  const dias = Object.keys(dailyMap).sort();
  rows.push(["DESGLOSE DIARIO"]);
  rows.push(["Fecha", "Facturas", "Boletas", "N. Crédito", "Base (S/)", "IGV (S/)", "Total Neto (S/)"]);
  for (const dia of dias) {
    const d = dailyMap[dia];
    rows.push([
      dia,
      d.facturas || "",
      d.boletas || "",
      d.nc || "",
      r2(d.base),
      r2(d.igv),
      r2(d.total),
    ]);
  }
  rows.push([]);
  rows.push(["TOTAL", "", "", "", r2(totalBase), r2(totalIgv), r2(totalImporte)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 18 },
  ];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 6 } },
  ];
  return ws;
}

// ── Función principal ───────────────────────────────────────

/**
 * Construye el workbook completo y lo devuelve como Buffer (.xlsx).
 * Pensado para usarse en un Route Handler que lo sirve como attachment.
 */
export function generarBufferReporteComprobantes(
  items: FilaComprobante[],
  periodo: PeriodoReporte
): Buffer {
  const wb = XLSX.utils.book_new();

  // 1. Resumen (siempre)
  XLSX.utils.book_append_sheet(wb, buildResumenSheet(items, periodo), "Resumen");

  // 2. Registro de Ventas (si hay algo)
  if (items.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      buildRegistroVentasSheet(items, periodo),
      "Registro de Ventas"
    );
  }

  // 3-5. Detalle por tipo (solo si hay de ese tipo)
  const facturas = items.filter((i) => i.tipo === "01");
  const boletas = items.filter((i) => i.tipo === "03");
  const notasCredito = items.filter((i) => i.tipo === "07");

  if (facturas.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      buildDetailSheet(facturas, `FACTURAS — ${periodo.etiqueta}`),
      "Facturas"
    );
  }
  if (boletas.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      buildDetailSheet(boletas, `BOLETAS — ${periodo.etiqueta}`),
      "Boletas"
    );
  }
  if (notasCredito.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      buildDetailSheet(notasCredito, `NOTAS DE CRÉDITO — ${periodo.etiqueta}`),
      "Notas de Crédito"
    );
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
