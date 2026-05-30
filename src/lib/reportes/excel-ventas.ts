// src/lib/reportes/excel-ventas.ts
// Genera el reporte de ventas como .xlsx multi-hoja (server-side).
// Misma cifra que la pantalla: facturación entregada por rango (ver datos-ventas.ts).
//
// Hojas:
//   1. Resumen         — KPIs + por empresa + por distrito
//   2. Ventas por día  — serie diaria (pedidos entregados + monto)
//   3. Top productos   — los más vendidos por monto
//   4. Ranking asesoras — facturado, pedidos, % de entrega
import * as XLSX from "xlsx";
import type { ReporteVentas } from "./datos-ventas";

const r2 = (n: number) => Math.round(n * 100) / 100;

const EMPRESA_LABELS: Record<string, string> = {
  Transavic: "Transavic",
  "Avícola de Tony": "Avícola de Tony",
};

export function generarBufferExcelVentas(
  reporte: ReporteVentas,
  etiquetaPeriodo: string
): Buffer {
  const wb = XLSX.utils.book_new();
  const generado = new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

  // ── Hoja 1: Resumen ──
  {
    const rows: (string | number)[][] = [];
    rows.push(["REPORTE DE VENTAS — TRANSAVIC / AVÍCOLA DE TONY"]);
    rows.push([`Período: ${etiquetaPeriodo}`]);
    rows.push([`Generado: ${generado}`]);
    rows.push(["Mide facturación de pedidos ENTREGADOS (peso real cuando existe)."]);
    rows.push([]);
    rows.push(["INDICADORES"]);
    rows.push(["Facturado (S/)", r2(reporte.kpis.total_facturado)]);
    rows.push(["Pedidos entregados", reporte.kpis.entregados]);
    rows.push(["Ticket promedio (S/)", r2(reporte.kpis.ticket_promedio)]);
    rows.push(["Pedidos del período", reporte.kpis.total_pedidos]);
    rows.push(["Pendientes", reporte.kpis.pendientes]);
    rows.push(["Fallidos", reporte.kpis.fallidos]);
    rows.push([
      "% de entrega",
      reporte.kpis.total_pedidos > 0
        ? `${Math.round((reporte.kpis.entregados / reporte.kpis.total_pedidos) * 100)}%`
        : "0%",
    ]);
    rows.push([]);
    rows.push(["POR EMPRESA", "Pedidos", "Facturado (S/)"]);
    reporte.porEmpresa.forEach((e) =>
      rows.push([EMPRESA_LABELS[e.empresa] ?? e.empresa, e.pedidos, r2(e.monto)])
    );
    rows.push([]);
    rows.push(["POR DISTRITO", "Pedidos", "Facturado (S/)"]);
    reporte.porDistrito.forEach((d) => rows.push([d.distrito, d.pedidos, r2(d.monto)]));

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 16 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
    XLSX.utils.book_append_sheet(wb, ws, "Resumen");
  }

  // ── Hoja 2: Ventas por día ──
  {
    const rows: (string | number)[][] = [];
    rows.push(["VENTAS POR DÍA"]);
    rows.push([`Período: ${etiquetaPeriodo}`]);
    rows.push([]);
    rows.push(["Fecha", "Pedidos entregados", "Facturado (S/)"]);
    let totPed = 0;
    let totMonto = 0;
    reporte.ventasPorDia.forEach((d) => {
      totPed += d.pedidos;
      totMonto += d.monto;
      rows.push([d.fecha, d.pedidos, r2(d.monto)]);
    });
    rows.push([]);
    rows.push(["TOTAL", totPed, r2(totMonto)]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 20 }, { wch: 16 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
    XLSX.utils.book_append_sheet(wb, ws, "Ventas por día");
  }

  // ── Hoja 3: Top productos ──
  {
    const rows: (string | number)[][] = [];
    rows.push(["TOP PRODUCTOS VENDIDOS (por monto)"]);
    rows.push([`Período: ${etiquetaPeriodo}`]);
    rows.push([]);
    rows.push(["Nº", "Producto", "Cantidad", "Unidad", "Facturado (S/)"]);
    reporte.topProductos.forEach((p, i) =>
      rows.push([i + 1, p.nombre, r2(p.cantidad), p.unidad, r2(p.monto)])
    );
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 5 }, { wch: 36 }, { wch: 12 }, { wch: 10 }, { wch: 16 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
    XLSX.utils.book_append_sheet(wb, ws, "Top productos");
  }

  // ── Hoja 4: Ranking asesoras ──
  {
    const rows: (string | number)[][] = [];
    rows.push(["RANKING DE ASESORAS (por facturación entregada)"]);
    rows.push([`Período: ${etiquetaPeriodo}`]);
    rows.push([]);
    rows.push(["Nº", "Asesora", "Facturado (S/)", "Pedidos", "Entregados", "Fallidos", "% Entrega"]);
    reporte.ranking.forEach((a, i) =>
      rows.push([
        i + 1,
        a.name.trim(),
        r2(a.facturado),
        a.total_pedidos,
        a.entregados,
        a.fallidos,
        `${a.tasa}%`,
      ])
    );
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 5 },
      { wch: 24 },
      { wch: 16 },
      { wch: 10 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
    ];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
    XLSX.utils.book_append_sheet(wb, ws, "Ranking asesoras");
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
