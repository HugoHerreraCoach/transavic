// src/app/dashboard/reportes/cuadre-consolidado-tab.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { 
  FiCalendar, 
  FiDownload, 
  FiLoader, 
  FiUsers, 
  FiBox, 
  FiCopy, 
  FiX, 
  FiEye, 
  FiAlertCircle,
  FiActivity
} from "react-icons/fi";
import { toJpeg } from "html-to-image";
import { toLocalDateString } from "@/lib/utils";
import { formatSoles } from "./ui";

interface ClienteBalance {
  cliente_id: string;
  cliente_nombre: string;
  cliente_razon_social: string | null;
  cliente_ruc_dni: string | null;
  asesor_name: string;
  kg_vendidos: number;
  monto_venta: number;
  saldo_anterior: number;
  cobrado: number;
  descuento: number;
  saldo_pendiente: number;
}

interface ProductoCuadre {
  producto_id: string;
  producto_nombre: string;
  producto_categoria: string;
  jabas_compradas: number;
  kg_comprados: number;
  kg_ejecutivas: number;
  kg_planta: number;
  kg_campo: number;
  kg_vendidos: number;
  diferencia: number;
}

interface TransaccionAuditoria {
  id: string;
  tipo: "VENTA" | "COBRO" | "NC_DESCUENTO";
  fecha: string;
  referencia: string;
  monto: number;
  kilos: number;
}

interface AuditoriaClienteResponse {
  cliente: {
    id: string;
    nombre: string;
    razon_social: string | null;
    ruc_dni: string | null;
  };
  saldo_anterior: number;
  transacciones: TransaccionAuditoria[];
}

export default function CuadreConsolidadoTab() {
  const [fecha, setFecha] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState<boolean>(false);
  const [copiando, setCopiando] = useState<boolean>(false);

  // Datos financieros y físicos
  const [clientes, setClientes] = useState<ClienteBalance[]>([]);
  const [productos, setProductos] = useState<ProductoCuadre[]>([]);

  // Estados del Modal de Auditoría
  const [clienteAuditoriaId, setClienteAuditoriaId] = useState<string | null>(null);
  const [loadingAuditoria, setLoadingAuditoria] = useState<boolean>(false);
  const [auditoriaData, setAuditoriaData] = useState<AuditoriaClienteResponse | null>(null);
  const [errorAuditoria, setErrorAuditoria] = useState<string | null>(null);
  const [copiandoAuditoria, setCopiandoAuditoria] = useState<boolean>(false);

  const reportRef = useRef<HTMLDivElement>(null);

  // Inicializar fecha de hoy (Lima)
  useEffect(() => {
    const hoy = toLocalDateString(new Date());
    setFecha(hoy);
  }, []);

  // Cargar datos consolidados
  useEffect(() => {
    if (!fecha) return;

    const fetchConsolidado = async () => {
      setLoading(true);
      setError(null);
      try {
        const [resFin, resFis] = await Promise.all([
          fetch(`/api/reportes/balance-asesoras?desde=${fecha}&hasta=${fecha}&asesor_id=todos`),
          fetch(`/api/reportes/cuadre-fisico?fecha=${fecha}`)
        ]);

        if (!resFin.ok || !resFis.ok) {
          throw new Error("Error en las consultas de balance o stock");
        }

        const dataFin = await resFin.json();
        const dataFis = await resFis.json();

        setClientes(dataFin.clientes || []);
        setProductos(dataFis.productos || []);
      } catch (err) {
        console.error("Error al cargar consolidado:", err);
        setError("Error al cargar el consolidado del día. Revisa la conexión.");
      } finally {
        setLoading(false);
      }
    };

    fetchConsolidado();
  }, [fecha]);

  // Aritmética de Totales Financieros
  const totalKg = clientes.reduce((acc, c) => acc + c.kg_vendidos, 0);
  const totalVenta = clientes.reduce((acc, c) => acc + c.monto_venta, 0);
  const totalSaldoAnt = clientes.reduce((acc, c) => acc + c.saldo_anterior, 0);
  const totalCobrado = clientes.reduce((acc, c) => acc + c.cobrado, 0);
  const totalDescuento = clientes.reduce((acc, c) => acc + c.descuento, 0);
  const totalPendiente = clientes.reduce((acc, c) => acc + c.saldo_pendiente, 0);

  // Aritmética de Totales Físicos
  const totalJabasCompra = productos.reduce((acc, p) => acc + p.jabas_compradas, 0);
  const totalCompraKilos = productos.reduce((acc, p) => acc + p.kg_comprados, 0);
  const totalVendidoKilos = productos.reduce((acc, p) => acc + p.kg_vendidos, 0);
  const totalDiferenciaKilos = productos.reduce((acc, p) => acc + p.diferencia, 0);

  // Formatear fechas
  const formatFechaLabel = (fStr: string) => {
    if (!fStr) return "";
    const [y, m, d] = fStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-PE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  };

  const formatFechaCorta = (fStr: string) => {
    if (!fStr) return "";
    const [y, m, d] = fStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-PE", {
      day: "2-digit",
      month: "short"
    });
  };

  // Cargar Auditoría Financiera de un Cliente
  const cargarAuditoriaCliente = useCallback(async (clienteId: string) => {
    setClienteAuditoriaId(clienteId);
    setLoadingAuditoria(true);
    setErrorAuditoria(null);
    setAuditoriaData(null);
    try {
      const url = `/api/reportes/balance-asesoras/cliente?cliente_id=${clienteId}&desde=${fecha}&hasta=${fecha}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("No se pudo cargar la auditoría");
      const json = await res.json();
      setAuditoriaData(json);
    } catch (err) {
      console.error("Error al cargar auditoria:", err);
      setErrorAuditoria("Error al cargar los movimientos del cliente.");
    } finally {
      setLoadingAuditoria(false);
    }
  }, [fecha]);

  // Copiar extracto de auditoría del cliente a WhatsApp
  const handleCopiarTextoAuditoria = useCallback(async () => {
    if (!auditoriaData) return;
    setCopiandoAuditoria(true);
    try {
      const { cliente, saldo_anterior, transacciones } = auditoriaData;
      let texto = `*DETALLE DE CUENTA - TRANSAVIC* 📋\n`;
      texto += `👤 *Cliente:* ${cliente.nombre}\n`;
      if (cliente.ruc_dni) texto += `📄 *Doc:* ${cliente.ruc_dni}\n`;
      texto += `📅 *Fecha:* ${formatFechaCorta(fecha)}\n\n`;
      texto += `💵 *Saldo Anterior:* S/ ${saldo_anterior.toFixed(2)}\n\n`;
      texto += `*Movimientos del Día:*\n`;
      texto += `----------------------------\n`;

      let saldoAcumulado = saldo_anterior;
      transacciones.forEach((t: TransaccionAuditoria) => {
        const fechaFormateada = formatFechaCorta(t.fecha);
        if (t.tipo === "VENTA") {
          saldoAcumulado += t.monto;
          texto += `• [${fechaFormateada}] *VENTA* (${t.referencia}): +S/ ${t.monto.toFixed(2)} (${t.kilos.toFixed(2)} kg) | Saldo: S/ ${saldoAcumulado.toFixed(2)}\n`;
        } else if (t.tipo === "COBRO") {
          saldoAcumulado -= t.monto;
          texto += `• [${fechaFormateada}] *PAGO* (${t.referencia}): -S/ ${t.monto.toFixed(2)} | Saldo: S/ ${saldoAcumulado.toFixed(2)}\n`;
        } else if (t.tipo === "NC_DESCUENTO") {
          saldoAcumulado -= t.monto;
          texto += `• [${fechaFormateada}] *N. CRÉDITO* (${t.referencia}): -S/ ${t.monto.toFixed(2)} | Saldo: S/ ${saldoAcumulado.toFixed(2)}\n`;
        }
      });
      texto += `\n🔥 *SALDO PENDIENTE FINAL:* *S/ ${saldoAcumulado.toFixed(2)}*`;

      await navigator.clipboard.writeText(texto);
      alert("Extracto de cuenta copiado al portapapeles. Listo para pegar en WhatsApp.");
    } catch (err) {
      console.error(err);
    } finally {
      setCopiandoAuditoria(false);
    }
  }, [auditoriaData, fecha]);

  // Copiar Resumen Consolidado Completo para WhatsApp
  const handleCopiarTexto = useCallback(async () => {
    if (!clientes.length && !productos.length) return;
    setCopiando(true);

    let texto = `*CUADRE DIARIO CONSOLIDADO TRANSAVIC* 🐔💰\n`;
    texto += `📅 *Fecha:* ${formatFechaLabel(fecha)}\n\n`;

    texto += `*1. BALANCE DE CARTERA (CLIENTES)*\n`;
    texto += `-----------------------------------\n`;
    clientes.forEach((c) => {
      texto += `• *${c.cliente_nombre}*: Vent: S/ ${c.monto_venta.toFixed(2)} | Cobr: S/ ${c.cobrado.toFixed(2)} | Pend: *S/ ${c.saldo_pendiente.toFixed(2)}*\n`;
    });
    texto += `🔥 *Total Pendiente Carteras:* *S/ ${totalPendiente.toFixed(2)}*\n\n`;

    texto += `*2. CONCILIACIÓN FÍSICA Y MERMAS*\n`;
    texto += `-----------------------------------\n`;
    productos.forEach((p) => {
      texto += `• *${p.producto_nombre}*: Carga: ${p.kg_comprados.toFixed(2)} kg (${p.jabas_compradas} jab.) | Vent: ${p.kg_vendidos.toFixed(2)} kg | Dif: *${p.diferencia.toFixed(2)} kg*\n`;
    });
    texto += `🔥 *Merma Física Total:* *${totalDiferenciaKilos.toFixed(2)} kg*`;

    try {
      await navigator.clipboard.writeText(texto);
      alert("Resumen consolidado copiado al portapapeles. Listo para WhatsApp.");
    } catch (err) {
      console.error("Error al copiar consolidado:", err);
    } finally {
      setCopiando(false);
    }
  }, [clientes, productos, fecha, totalPendiente, totalDiferenciaKilos]);

  // Exportar Imagen
  const handleExportar = useCallback(async () => {
    const el = reportRef.current;
    if (!el) return;
    setExportando(true);
    try {
      const dataUrl = await toJpeg(el, {
        quality: 0.98,
        pixelRatio: 2.5,
        backgroundColor: "#ffffff",
        cacheBust: true,
        skipFonts: true
      });
      const link = document.createElement("a");
      link.download = `cuadre-consolidado-${fecha}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Error al exportar:", err);
    } finally {
      setExportando(false);
    }
  }, [fecha]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Controles de Vista */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 shadow-xs flex flex-col md:flex-row md:items-end justify-between gap-5">
        <div className="flex items-center gap-2">
          <FiCalendar className="text-gray-400" />
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-red-200 outline-none cursor-pointer"
          />
        </div>

        {(!loading && !error) && (clientes.length > 0 || productos.length > 0) && (
          <div className="flex gap-2 w-full md:w-auto">
            <button
              onClick={handleExportar}
              disabled={exportando}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {exportando ? <FiLoader className="animate-spin" /> : <FiDownload />}
              <span>Exportar</span>
            </button>
            <button
              onClick={handleCopiarTexto}
              disabled={copiando}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {copiando ? <FiLoader className="animate-spin" /> : <FiCopy />}
              <span>Copiar Cuadre General</span>
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <FiLoader className="h-8 w-8 text-red-600 animate-spin mb-2" />
          <span className="text-sm text-gray-500 font-medium">Conciliando cuadre general diario...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 p-4 rounded-xl text-sm text-center">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {clientes.length === 0 && productos.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500 text-sm shadow-xs">
              No se registraron transacciones financieras ni ingresos físicos de pollo para la fecha seleccionada.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-2xl overflow-x-auto shadow-xs bg-white w-full">
              {/* Contenedor fotografiado por html-to-image */}
              <div 
                ref={reportRef} 
                className="bg-white p-6 flex flex-col gap-6 select-none"
                style={{ width: "1200px", minWidth: "1200px" }}
              >
                {/* Cabecera del Reporte */}
                <div className="flex justify-between items-end border-b border-gray-100 pb-4">
                  <div>
                    <h2 className="text-xs font-bold text-red-600 tracking-widest uppercase mb-1">
                      TRANSAVIC & EL TONY
                    </h2>
                    <h1 className="text-lg font-black text-gray-900 tracking-tight">
                      Cuadre Diario Consolidado (Financiero y de Stock)
                    </h1>
                    <p className="text-[11px] font-semibold text-gray-500 mt-1 capitalize">
                      {formatFechaLabel(fecha)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      <FiActivity /> Control General Integrado
                    </span>
                  </div>
                </div>

                {/* Dashboard de doble columna */}
                <div className="grid grid-cols-12 gap-6 items-start">
                  
                  {/* SECCIÓN CARTERAS (Columna Izquierda 70%) */}
                  <div className="col-span-7 flex flex-col gap-3">
                    <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                      <FiUsers className="text-gray-400" />
                      <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider">
                        1. Cartera Financiera por Cliente
                      </h3>
                    </div>
                    <div className="border border-gray-100 rounded-xl overflow-hidden shadow-xs">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100 font-bold text-gray-500">
                            <th className="py-2 px-2.5">Cliente</th>
                            <th className="py-2 px-2.5 text-right">Kilos</th>
                            <th className="py-2 px-2.5 text-right">Guía (Vent)</th>
                            <th className="py-2 px-2.5 text-right">Sald. Ant.</th>
                            <th className="py-2 px-2.5 text-right">A Cuenta</th>
                            <th className="py-2 px-2.5 text-right">Desct.</th>
                            <th className="py-2 px-2.5 text-right">Pendiente</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-gray-800">
                          {clientes.map((c, i) => (
                            <tr
                              key={i}
                              onDoubleClick={() => cargarAuditoriaCliente(c.cliente_id)}
                              className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                              title="Doble clic para ver el extracto de cuenta"
                            >
                              <td className="py-2.5 px-2.5">
                                <div className="flex items-center gap-1 group/cell">
                                  <span className="font-bold text-gray-900 truncate max-w-[130px]">
                                    {c.cliente_nombre}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cargarAuditoriaCliente(c.cliente_id);
                                    }}
                                    className="opacity-0 group-hover/cell:opacity-100 focus:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-red-600 rounded bg-gray-100 cursor-pointer"
                                    title="Ver auditoría"
                                  >
                                    <FiEye className="h-3 w-3" />
                                  </button>
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-medium tabular-nums text-gray-600">
                                {c.kg_vendidos > 0 ? `${c.kg_vendidos.toFixed(2)} kg` : "—"}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-bold tabular-nums text-gray-900">
                                {c.monto_venta > 0 ? formatSoles(c.monto_venta) : "—"}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-medium tabular-nums text-gray-600">
                                {c.saldo_anterior > 0 ? formatSoles(c.saldo_anterior) : "—"}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-bold tabular-nums text-emerald-600 bg-emerald-50/20">
                                {c.cobrado > 0 ? `-${formatSoles(c.cobrado)}` : "—"}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-medium tabular-nums text-blue-600">
                                {c.descuento > 0 ? `-${formatSoles(c.descuento)}` : "—"}
                              </td>
                              <td className={`py-2.5 px-2.5 text-right font-black tabular-nums ${
                                c.saldo_pendiente > 0 ? "text-red-600 bg-red-50/15" : "text-gray-500"
                              }`}>
                                {c.saldo_pendiente > 0 ? formatSoles(c.saldo_pendiente) : "S/ 0.00"}
                              </td>
                            </tr>
                          ))}
                          {/* Totales Fila */}
                          <tr className="bg-gray-50/50 font-bold border-t border-gray-100 text-gray-700">
                            <td className="py-2.5 px-2.5 uppercase text-[10px]">TOTALES</td>
                            <td className="py-2.5 px-2.5 text-right tabular-nums">
                              {totalKg > 0 ? `${totalKg.toFixed(2)} kg` : "—"}
                            </td>
                            <td className="py-2.5 px-2.5 text-right tabular-nums">
                              {formatSoles(totalVenta)}
                            </td>
                            <td className="py-2.5 px-2.5 text-right tabular-nums">
                              {totalSaldoAnt > 0 ? formatSoles(totalSaldoAnt) : "—"}
                            </td>
                            <td className="py-2.5 px-2.5 text-right tabular-nums text-emerald-700 bg-emerald-50/30">
                              {totalCobrado > 0 ? `-${formatSoles(totalCobrado)}` : "—"}
                            </td>
                            <td className="py-2.5 px-2.5 text-right tabular-nums text-blue-700">
                              {totalDescuento > 0 ? `-${formatSoles(totalDescuento)}` : "—"}
                            </td>
                            <td className={`py-2.5 px-2.5 text-right tabular-nums font-black ${
                              totalPendiente > 0 ? "text-red-700 bg-red-50/30" : "text-gray-600"
                            }`}>
                              {formatSoles(totalPendiente)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* SECCIÓN MERMAS (Columna Derecha 30%) */}
                  <div className="col-span-5 flex flex-col gap-3">
                    <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                      <FiBox className="text-gray-400" />
                      <h3 className="text-xs font-black text-gray-800 uppercase tracking-wider">
                        2. Cuadre Físico y Mermas (Kilos y Jabas)
                      </h3>
                    </div>
                    <div className="border border-gray-100 rounded-xl overflow-hidden shadow-xs">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100 font-bold text-gray-500">
                            <th className="py-2 px-2.5">Producto</th>
                            <th className="py-2 px-2.5 text-right bg-amber-50/10">Jab.</th>
                            <th className="py-2 px-2.5 text-right bg-amber-50/20">Kilos Carga</th>
                            <th className="py-2 px-2.5 text-right">Kilos Vent.</th>
                            <th className="py-2 px-2.5 text-right">Merma (Dif)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-gray-800">
                          {productos.map((p, i) => (
                            <tr key={i} className="hover:bg-gray-50/40">
                              <td className="py-2.5 px-2.5 font-semibold text-gray-900 truncate max-w-[150px]">
                                {p.producto_nombre}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-medium tabular-nums text-gray-500 bg-amber-50/5">
                                {p.jabas_compradas > 0 ? `${p.jabas_compradas} jab.` : "—"}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-bold tabular-nums text-gray-900 bg-amber-50/10">
                                {p.kg_comprados > 0 ? `${p.kg_comprados.toFixed(2)} kg` : "—"}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-medium tabular-nums text-gray-800">
                                {p.kg_vendidos > 0 ? `${p.kg_vendidos.toFixed(2)} kg` : "—"}
                              </td>
                              <td className={`py-2.5 px-2.5 text-right font-black tabular-nums ${
                                p.diferencia < 0 
                                  ? "text-red-600 bg-red-50/25" 
                                  : p.diferencia > 0 
                                  ? "text-blue-600 bg-blue-50/10" 
                                  : "text-gray-500"
                              }`}>
                                {p.diferencia !== 0 ? `${p.diferencia.toFixed(2)} kg` : "0.00 kg"}
                              </td>
                            </tr>
                          ))}
                          {/* Totales Fila */}
                          <tr className="bg-gray-50/50 font-bold border-t border-gray-100 text-gray-700">
                            <td className="py-2.5 px-2.5 uppercase text-[10px]">TOTALES</td>
                            <td className="py-2.5 px-2.5 text-right tabular-nums text-gray-600 bg-amber-50/10">
                              {totalJabasCompra > 0 ? `${totalJabasCompra} jab.` : "—"}
                            </td>
                            <td className="py-2.5 px-2.5 text-right tabular-nums text-gray-900 bg-amber-50/20">
                              {totalCompraKilos > 0 ? `${totalCompraKilos.toFixed(2)} kg` : "—"}
                            </td>
                            <td className="py-2.5 px-2.5 text-right tabular-nums">
                              {totalVendidoKilos > 0 ? `${totalVendidoKilos.toFixed(2)} kg` : "—"}
                            </td>
                            <td className={`py-2.5 px-2.5 text-right tabular-nums font-black ${
                              totalDiferenciaKilos < 0 ? "text-red-700 bg-red-50/30" : "text-blue-700 bg-blue-50/10"
                            }`}>
                              {totalDiferenciaKilos.toFixed(2)} kg
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>

                {/* Pie de Página */}
                <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                  <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">
                    Transavic & El Tony · Módulo Integrador del Día
                  </span>
                  <span className="text-[9px] text-gray-400 font-semibold">
                    Generado el {new Date().toLocaleDateString("es-PE")} a las{" "}
                    {new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

              </div>
            </div>
          )}
        </>
      )}

      {/* Modal de Auditoría Financiera de Cliente */}
      {clienteAuditoriaId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            {/* Cabecera */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 bg-gray-50/50">
              <div>
                <h3 className="text-sm font-bold text-red-600 tracking-wider uppercase">
                  Auditoría de Cuenta Corriente
                </h3>
                <h2 className="text-base font-black text-gray-900 mt-0.5">
                  {auditoriaData?.cliente?.nombre || "Cargando cliente..."}
                </h2>
                {auditoriaData?.cliente?.ruc_dni && (
                  <p className="text-[10px] text-gray-400 font-semibold mt-0.5">
                    Doc: {auditoriaData.cliente.ruc_dni} {auditoriaData.cliente.razon_social ? ` - ${auditoriaData.cliente.razon_social}` : ""}
                  </p>
                )}
              </div>
              <button
                onClick={() => setClienteAuditoriaId(null)}
                className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-900 rounded-lg transition-colors cursor-pointer"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
              {loadingAuditoria && (
                <div className="flex flex-col items-center justify-center py-16">
                  <FiLoader className="h-8 w-8 text-red-600 animate-spin mb-2" />
                  <span className="text-sm text-gray-500 font-medium">Cargando extracto de movimientos...</span>
                </div>
              )}

              {errorAuditoria && (
                <div className="bg-red-50 text-red-700 border border-red-200 p-4 rounded-xl text-sm flex items-center gap-2">
                  <FiAlertCircle className="h-5 w-5 flex-shrink-0" />
                  <span>{errorAuditoria}</span>
                </div>
              )}

              {!loadingAuditoria && !errorAuditoria && auditoriaData && (
                <>
                  {/* Resumen */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50/55 p-4 rounded-xl border border-gray-100">
                    <div>
                      <span className="text-[9px] uppercase font-bold tracking-wider text-gray-400 block mb-0.5">
                        Saldo Inicial (Prev.)
                      </span>
                      <span className="text-sm font-bold text-gray-800 tabular-nums">
                        {formatSoles(auditoriaData.saldo_anterior)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-bold tracking-wider text-gray-400 block mb-0.5">
                        Venta (Guías)
                      </span>
                      <span className="text-sm font-bold text-blue-600 tabular-nums">
                        +{formatSoles(auditoriaData.transacciones.reduce((acc: number, t: TransaccionAuditoria) => t.tipo === "VENTA" ? acc + t.monto : acc, 0))}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-bold tracking-wider text-gray-400 block mb-0.5">
                        Cobrado (A Cuenta)
                      </span>
                      <span className="text-sm font-bold text-emerald-600 tabular-nums">
                        -{formatSoles(auditoriaData.transacciones.reduce((acc: number, t: TransaccionAuditoria) => t.tipo === "COBRO" ? acc + t.monto : acc, 0))}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-bold tracking-wider text-gray-400 block mb-0.5">
                        Saldo Final
                      </span>
                      <span className="text-sm font-black text-red-600 tabular-nums">
                        {formatSoles(
                          auditoriaData.saldo_anterior +
                          auditoriaData.transacciones.reduce((acc: number, t: TransaccionAuditoria) => t.tipo === "VENTA" ? acc + t.monto : acc, 0) -
                          auditoriaData.transacciones.reduce((acc: number, t: TransaccionAuditoria) => t.tipo === "COBRO" ? acc + t.monto : acc, 0) -
                          auditoriaData.transacciones.reduce((acc: number, t: TransaccionAuditoria) => t.tipo === "NC_DESCUENTO" ? acc + t.monto : acc, 0)
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Tabla */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
                      Historial Cronológico de Movimientos
                    </h4>
                    {auditoriaData.transacciones.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-xl">
                        No se registran movimientos dentro de esta fecha.
                      </p>
                    ) : (
                      <div className="border border-gray-100 rounded-xl overflow-hidden shadow-xs bg-white">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-100 font-bold text-gray-500">
                              <th className="py-2.5 px-3">Fecha</th>
                              <th className="py-2.5 px-3">Operación</th>
                              <th className="py-2.5 px-3">Comprobante</th>
                              <th className="py-2.5 px-3 text-right">Kilos</th>
                              <th className="py-2.5 px-3 text-right">Importe</th>
                              <th className="py-2.5 px-3 text-right">Saldo Aux.</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-gray-800">
                            {(() => {
                              let saldoAcumulado = auditoriaData.saldo_anterior;
                              return auditoriaData.transacciones.map((t: TransaccionAuditoria, idx: number) => {
                                if (t.tipo === "VENTA") saldoAcumulado += t.monto;
                                else saldoAcumulado -= t.monto;

                                return (
                                  <tr key={idx} className="hover:bg-gray-50/40">
                                    <td className="py-2.5 px-3 font-medium text-gray-600">
                                      {t.fecha}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      {t.tipo === "VENTA" && (
                                        <span className="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-blue-700 uppercase">
                                          Venta
                                        </span>
                                      )}
                                      {t.tipo === "COBRO" && (
                                        <span className="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 uppercase">
                                          Cobro
                                        </span>
                                      )}
                                      {t.tipo === "NC_DESCUENTO" && (
                                        <span className="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-purple-50 text-purple-700 uppercase">
                                          N. Crédito
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 font-semibold text-gray-900">
                                      {t.referencia}
                                    </td>
                                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-gray-500">
                                      {t.kilos > 0 ? `${t.kilos.toFixed(2)} kg` : "—"}
                                    </td>
                                    <td className={`py-2.5 px-3 text-right tabular-nums font-bold ${
                                      t.tipo === "VENTA" ? "text-gray-900" : "text-emerald-600"
                                    }`}>
                                      {t.tipo === "VENTA" ? `+${formatSoles(t.monto)}` : `-${formatSoles(t.monto)}`}
                                    </td>
                                    <td className="py-2.5 px-3 text-right tabular-nums font-bold text-gray-700 bg-gray-50/20">
                                      {formatSoles(saldoAcumulado)}
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Pie */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
              <button
                onClick={handleCopiarTextoAuditoria}
                disabled={copiandoAuditoria || !auditoriaData}
                className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                {copiandoAuditoria ? <FiLoader className="animate-spin" /> : <FiCopy />}
                <span>Copiar Extracto</span>
              </button>
              <button
                onClick={() => setClienteAuditoriaId(null)}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
