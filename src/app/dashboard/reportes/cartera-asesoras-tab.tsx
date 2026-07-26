// src/app/dashboard/reportes/cartera-asesoras-tab.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FiDownload, FiShare2, FiLoader, FiCalendar, FiUsers, FiCopy, FiX, FiEye, FiAlertCircle } from "react-icons/fi";
import { toJpeg } from "html-to-image";
import { SelectorPeriodo, presetRango, type Preset, formatSoles } from "./ui";

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

interface BalanceAsesorasResponse {
  desde: string;
  hasta: string;
  asesor_id: string | null;
  clientes: ClienteBalance[];
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

interface UserProp {
  id: string;
  role: string;
  name?: string | null;
}

export default function CarteraAsesorasTab({ user }: { user?: UserProp }) {
  const [preset, setPreset] = useState<Preset>("semana");
  const [desde, setDesde] = useState(() => presetRango("semana").desde);
  const [hasta, setHasta] = useState(() => presetRango("semana").hasta);
  const [asesorId, setAsesorId] = useState<string>("todos");
  
  const [asesoras, setAsesoras] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<BalanceAsesorasResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingAsesoras, setLoadingAsesoras] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState<boolean>(false);
  const [copiando, setCopiando] = useState<boolean>(false);

  // Estados para Auditoría Financiera de Cliente (Doble Clic / Modal)
  const [clienteAuditoriaId, setClienteAuditoriaId] = useState<string | null>(null);
  const [loadingAuditoria, setLoadingAuditoria] = useState<boolean>(false);
  const [auditoriaData, setAuditoriaData] = useState<AuditoriaClienteResponse | null>(null);
  const [errorAuditoria, setErrorAuditoria] = useState<string | null>(null);
  const [copiandoAuditoria, setCopiandoAuditoria] = useState<boolean>(false);

  const reportRef = useRef<HTMLDivElement>(null);

  const isAdminOrProduccion = user?.role === "admin" || user?.role === "produccion";

  // Cargar lista de asesoras si el usuario es administrador/producción
  useEffect(() => {
    if (!isAdminOrProduccion) {
      if (user?.id) {
        setAsesorId(user.id);
      }
      return;
    }

    const loadAsesoras = async () => {
      setLoadingAsesoras(true);
      try {
        const res = await fetch("/api/users?role=asesor");
        if (res.ok) {
          const json = await res.json();
          setAsesoras(json);
        }
      } catch (err) {
        console.error("Error al cargar asesoras:", err);
      } finally {
        setLoadingAsesoras(false);
      }
    };

    loadAsesoras();
  }, [isAdminOrProduccion, user]);

  // Sincronizar fechas al cambiar el preset
  const handlePresetChange = (p: Preset) => {
    setPreset(p);
    if (p !== "rango") {
      const rango = presetRango(p);
      setDesde(rango.desde);
      setHasta(rango.hasta);
    }
  };

  // Cargar balance de la API
  const loadBalance = useCallback(async () => {
    if (!desde || !hasta) return;

    setLoading(true);
    setError(null);
    try {
      const url = `/api/reportes/balance-asesoras?desde=${desde}&hasta=${hasta}&asesor_id=${asesorId}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("No se pudo cargar el balance");
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Error cargando balance:", err);
      setError("Ocurrió un error al calcular el balance financiero.");
    } finally {
      setLoading(false);
    }
  }, [desde, hasta, asesorId]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  // Exportar reporte a JPG para compartir por WhatsApp
  const handleExportar = useCallback(async () => {
    const el = reportRef.current;
    if (!el || !data) return;

    setExportando(true);
    try {
      const dataUrl = await toJpeg(el, {
        quality: 0.98,
        pixelRatio: 2.5,
        backgroundColor: "#ffffff",
        cacheBust: true,
        skipFonts: true,
      });

      const link = document.createElement("a");
      link.download = `balance-cartera-${desde}-al-${hasta}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Error al exportar balance:", err);
      alert("Hubo un error al generar la imagen del reporte. Inténtalo de nuevo.");
    } finally {
      setExportando(false);
    }
  }, [data, desde, hasta]);

  // Compartir nativamente
  const handleCompartir = useCallback(async () => {
    const el = reportRef.current;
    if (!el || !data) return;

    setExportando(true);
    try {
      const dataUrl = await toJpeg(el, {
        quality: 0.98,
        pixelRatio: 2.5,
        backgroundColor: "#ffffff",
        cacheBust: true,
        skipFonts: true,
      });

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], `balance-cartera-${desde}-al-${hasta}.jpg`, {
        type: "image/jpeg",
      });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Balance Cartera - ${desde} al ${hasta}`,
          text: `Resumen de cobranzas y deudas Transavic.`,
        });
      } else {
        const link = document.createElement("a");
        link.download = `balance-cartera-${desde}-al-${hasta}.jpg`;
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      console.error("Error al compartir balance:", err);
    } finally {
      setExportando(false);
    }
  }, [data, desde, hasta]);

  // Aritmética de Totales Consolidados
  const totalKg = data?.clientes.reduce((acc, c) => acc + c.kg_vendidos, 0) ?? 0;
  const totalVenta = data?.clientes.reduce((acc, c) => acc + c.monto_venta, 0) ?? 0;
  const totalSaldoAnt = data?.clientes.reduce((acc, c) => acc + c.saldo_anterior, 0) ?? 0;
  const totalCobrado = data?.clientes.reduce((acc, c) => acc + c.cobrado, 0) ?? 0;
  const totalDescuento = data?.clientes.reduce((acc, c) => acc + c.descuento, 0) ?? 0;
  const totalPendiente = data?.clientes.reduce((acc, c) => acc + c.saldo_pendiente, 0) ?? 0;

  // Formatear fechas legibles
  const formatFechaLabel = (fStr: string) => {
    if (!fStr) return "";
    const [y, m, d] = fStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-PE", {
      day: "2-digit",
      month: "short",
    });
  };

  // Obtener nombre de la asesora seleccionada para el encabezado del reporte
  const getAsesoraNameHeader = useCallback(() => {
    if (asesorId === "todos") return "Todas las Ejecutivas";
    const asesora = asesoras.find((a) => a.id === asesorId);
    return asesora ? asesora.name : user?.name || "Ejecutiva";
  }, [asesorId, asesoras, user]);

  const cargarAuditoriaCliente = useCallback(async (clienteId: string) => {
    setClienteAuditoriaId(clienteId);
    setLoadingAuditoria(true);
    setErrorAuditoria(null);
    setAuditoriaData(null);
    try {
      const url = `/api/reportes/balance-asesoras/cliente?cliente_id=${clienteId}&desde=${desde}&hasta=${hasta}`;
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
  }, [desde, hasta]);

  const handleCopiarTextoAuditoria = useCallback(async () => {
    if (!auditoriaData) return;
    setCopiandoAuditoria(true);
    try {
      const { cliente, saldo_anterior, transacciones } = auditoriaData;
      let texto = `*DETALLE DE CUENTA - TRANSAVIC* 📋\n`;
      texto += `👤 *Cliente:* ${cliente.nombre}\n`;
      if (cliente.ruc_dni) texto += `📄 *Doc:* ${cliente.ruc_dni}\n`;
      texto += `📅 *Periodo:* ${desde} al ${hasta}\n\n`;
      texto += `💵 *Saldo Anterior:* S/ ${saldo_anterior.toFixed(2)}\n\n`;
      texto += `*Movimientos del Periodo:*\n`;
      texto += `----------------------------\n`;
      
      let saldoAcumulado = saldo_anterior;
      transacciones.forEach((t: TransaccionAuditoria) => {
        const fechaFormateada = formatFechaLabel(t.fecha);
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
  }, [auditoriaData, desde, hasta]);

  const handleCopiarTexto = useCallback(async () => {
    if (!data) return;
    setCopiando(true);
    
    let texto = `*CONCILIACIÓN CARTERA FINANCIERA* 💰\n`;
    texto += `👤 *Ejecutiva:* ${getAsesoraNameHeader()}\n`;
    texto += `📅 *Periodo:* ${desde} al ${hasta}\n\n`;
    texto += `*Resumen de Clientes:*\n`;
    texto += `----------------------\n`;
    
    data.clientes.forEach((c) => {
      texto += `• *${c.cliente_nombre}*: Venta: S/ ${c.monto_venta.toFixed(2)} | Cobro: S/ ${c.cobrado.toFixed(2)} | Pendiente: *S/ ${c.saldo_pendiente.toFixed(2)}*\n`;
    });
    
    texto += `\n🔥 *TOTAL CONSOLIDADO:*\n`;
    texto += `• Kilos Vendidos: ${totalKg.toFixed(2)} kg\n`;
    texto += `• Monto Venta: S/ ${totalVenta.toFixed(2)}\n`;
    texto += `• Saldo Anterior: S/ ${totalSaldoAnt.toFixed(2)}\n`;
    texto += `• A Cuenta (Cobros): -S/ ${totalCobrado.toFixed(2)}\n`;
    texto += `• Descuentos (NC): -S/ ${totalDescuento.toFixed(2)}\n`;
    texto += `• *SALDO PENDIENTE FINAL:* *S/ ${totalPendiente.toFixed(2)}*`;

    try {
      await navigator.clipboard.writeText(texto);
      alert("Resumen de texto copiado al portapapeles. Listo para pegar en WhatsApp.");
    } catch (err) {
      console.error("Error al copiar texto:", err);
    } finally {
      setCopiando(false);
    }
  }, [data, desde, hasta, totalKg, totalVenta, totalSaldoAnt, totalCobrado, totalDescuento, totalPendiente, getAsesoraNameHeader]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Controles de Filtros */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 shadow-xs flex flex-col md:flex-row md:items-end justify-between gap-5">
        <div className="flex flex-col gap-4 flex-1">
          {/* Selector de Fechas */}
          <div>
            <label className="text-[10px] uppercase font-bold tracking-wider text-gray-400 block mb-1">
              Rango de Periodo
            </label>
            <SelectorPeriodo
              preset={preset}
              desde={desde}
              hasta={hasta}
              onPreset={handlePresetChange}
              onDesde={setDesde}
              onHasta={setHasta}
            />
          </div>

          {/* Selector de Asesora (solo si es Admin o Producción) */}
          {isAdminOrProduccion && (
            <div className="max-w-xs">
              <label className="text-[10px] uppercase font-bold tracking-wider text-gray-400 block mb-1">
                Ejecutiva de Ventas
              </label>
              <div className="relative">
                <select
                  value={asesorId}
                  onChange={(e) => setAsesorId(e.target.value)}
                  disabled={loadingAsesoras}
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-red-200 outline-none appearance-none cursor-pointer"
                >
                  <option value="todos">Todas las asesoras (Consolidado)</option>
                  {asesoras.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <FiUsers className="absolute left-2.5 top-3 text-gray-400 text-sm pointer-events-none" />
              </div>
            </div>
          )}
        </div>

        {/* Botones de Descarga */}
        {data && data.clientes.length > 0 && (
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
              onClick={handleCompartir}
              disabled={exportando}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {exportando ? <FiLoader className="animate-spin" /> : <FiShare2 />}
              <span>Compartir por WhatsApp</span>
            </button>
            <button
              onClick={handleCopiarTexto}
              disabled={copiando}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {copiando ? <FiLoader className="animate-spin" /> : <FiCopy />}
              <span>Copiar Resumen</span>
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <FiLoader className="h-8 w-8 text-red-600 animate-spin mb-2" />
          <span className="text-sm text-gray-500">Calculando balance financiero...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 p-4 rounded-xl text-sm text-center">
          {error}
        </div>
      )}

      {/* Resultados de la Consulta */}
      {!loading && !error && data && (
        <>
          {data.clientes.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500 text-sm shadow-xs">
              No se registraron ventas ni cobranzas en el periodo seleccionado para la asesora indicada.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-xs bg-white">
              {/* Contenedor que será fotografiado por html-to-image */}
              <div
                ref={reportRef}
                className="bg-white p-6 flex flex-col gap-6 select-none overflow-x-auto"
                style={{ width: "100%", minWidth: "800px" }}
              >
                {/* Cabecera del Reporte */}
                <div className="flex justify-between items-end border-b border-gray-100 pb-4">
                  <div>
                    <h2 className="text-xs font-bold text-red-600 tracking-widest uppercase mb-1">
                      TRANSAVIC ERP
                    </h2>
                    <h1 className="text-lg font-black text-gray-900 tracking-tight">
                      Conciliación de Cartera Financiera
                    </h1>
                    <p className="text-[11px] font-semibold text-gray-500 mt-1">
                      Ejecutiva: <span className="text-gray-800 font-bold">{getAsesoraNameHeader()}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      <FiCalendar /> {formatFechaLabel(desde)} – {formatFechaLabel(hasta)}
                    </span>
                  </div>
                </div>

                {/* Tabla de Balances */}
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 w-1/4">
                        Cliente
                      </th>
                      <th className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Kilos
                      </th>
                      <th className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Guía (Venta)
                      </th>
                      <th className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Sald. Ant.
                      </th>
                      <th className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        A Cuenta (Cobros)
                      </th>
                      <th className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Desct.
                      </th>
                      <th className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Pendiente
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                    {data.clientes.map((c, i) => (
                      <tr
                        key={i}
                        onDoubleClick={() => cargarAuditoriaCliente(c.cliente_id)}
                        className="hover:bg-gray-50/50 transition-colors cursor-pointer select-none"
                        title="Doble clic para auditar cuenta corriente"
                      >
                        <td className="py-3 pr-2">
                          <div className="flex items-center gap-1.5 group/cell">
                            <div className="font-bold text-gray-900">{c.cliente_nombre}</div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                cargarAuditoriaCliente(c.cliente_id);
                              }}
                              className="opacity-0 group-hover/cell:opacity-100 focus:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-red-600 rounded bg-gray-100 hover:bg-red-50 cursor-pointer"
                              title="Ver extracto de cuenta"
                            >
                              <FiEye className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {c.cliente_razon_social && (
                            <div className="text-[10px] text-gray-400 mt-0.5 max-w-[200px] truncate">
                              {c.cliente_razon_social} {c.cliente_ruc_dni ? `(${c.cliente_ruc_dni})` : ""}
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-right font-medium tabular-nums text-gray-600">
                          {c.kg_vendidos > 0 ? `${c.kg_vendidos.toFixed(2)} kg` : "—"}
                        </td>
                        <td className="py-3 text-right font-bold tabular-nums text-gray-900">
                          {c.monto_venta > 0 ? formatSoles(c.monto_venta) : "—"}
                        </td>
                        <td className="py-3 text-right font-medium tabular-nums text-gray-600">
                          {c.saldo_anterior > 0 ? formatSoles(c.saldo_anterior) : "—"}
                        </td>
                        <td className="py-3 text-right font-bold tabular-nums text-emerald-600 bg-emerald-50/30">
                          {c.cobrado > 0 ? `-${formatSoles(c.cobrado)}` : "—"}
                        </td>
                        <td className="py-3 text-right font-medium tabular-nums text-blue-600">
                          {c.descuento > 0 ? `-${formatSoles(c.descuento)}` : "—"}
                        </td>
                        <td className={`py-3 text-right font-black tabular-nums ${
                          c.saldo_pendiente > 0 ? "text-red-600 bg-red-50/20" : "text-gray-500"
                        }`}>
                          {c.saldo_pendiente > 0 ? formatSoles(c.saldo_pendiente) : "S/ 0.00"}
                        </td>
                      </tr>
                    ))}

                    {/* Fila de Totales */}
                    <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                      <td className="py-3.5 pl-2 text-xs uppercase font-bold text-gray-600">
                        TOTAL CONSOLIDADO
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-gray-700">
                        {totalKg > 0 ? `${totalKg.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-gray-900">
                        {formatSoles(totalVenta)}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-gray-700">
                        {totalSaldoAnt > 0 ? formatSoles(totalSaldoAnt) : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-emerald-700 bg-emerald-50/60">
                        {totalCobrado > 0 ? `-${formatSoles(totalCobrado)}` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-blue-700">
                        {totalDescuento > 0 ? `-${formatSoles(totalDescuento)}` : "—"}
                      </td>
                      <td className={`py-3.5 text-right tabular-nums text-sm font-black ${
                        totalPendiente > 0 ? "text-red-700 bg-red-50/40" : "text-gray-600"
                      }`}>
                        {formatSoles(totalPendiente)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Pie de Página */}
                <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                  <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">
                    Transavic & El Tony · Módulo de Control de Cobranzas
                  </span>
                  <span className="text-[9px] text-gray-400">
                    Generado el {new Date().toLocaleDateString("es-PE")} a las{" "}
                    {new Date().toLocaleTimeString("es-PE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal de Auditoría Financiera de Cliente */}
      {clienteAuditoriaId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
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

            {/* Contenido con scroll */}
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
                  {/* Resumen Financiero del Periodo */}
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

                  {/* Tabla de Movimientos */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
                      Historial Cronológico de Movimientos
                    </h4>
                    {auditoriaData.transacciones.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-xl">
                        No se registran movimientos (ventas, cobros o notas de crédito) dentro de este periodo.
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

            {/* Pie del Modal */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-between gap-3">
              <button
                onClick={handleCopiarTextoAuditoria}
                disabled={copiandoAuditoria || !auditoriaData}
                className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
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
