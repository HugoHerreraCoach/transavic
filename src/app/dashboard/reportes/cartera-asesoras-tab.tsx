// src/app/dashboard/reportes/cartera-asesoras-tab.tsx
"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { FiLoader, FiCalendar, FiUsers, FiCopy, FiX, FiEye, FiAlertCircle, FiFileText } from "react-icons/fi";
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
  const [exportandoPDF, setExportandoPDF] = useState<boolean>(false);
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

  // 1. Calcular el Resumen Agrupado por Asesora
  const resumenAsesoras = useMemo(() => {
    if (!data) return [];
    const resumenMap: Record<
      string,
      {
        nombre: string;
        kg: number;
        venta: number;
        saldoAnterior: number;
        cobrado: number;
        descuento: number;
        pendiente: number;
      }
    > = {};

    data.clientes.forEach((c) => {
      const name = c.asesor_name || "Sin ejecutiva";
      if (!resumenMap[name]) {
        resumenMap[name] = {
          nombre: name,
          kg: 0,
          venta: 0,
          saldoAnterior: 0,
          cobrado: 0,
          descuento: 0,
          pendiente: 0,
        };
      }
      resumenMap[name].kg += c.kg_vendidos || 0;
      resumenMap[name].venta += c.monto_venta || 0;
      resumenMap[name].saldoAnterior += c.saldo_anterior || 0;
      resumenMap[name].cobrado += c.cobrado || 0;
      resumenMap[name].descuento += c.descuento || 0;
      resumenMap[name].pendiente += c.saldo_pendiente || 0;
    });

    return Object.values(resumenMap).sort((a, b) => b.venta - a.venta);
  }, [data]);



  // Formateadores de fecha cortos
  const formatFechaCorto = (fechaStr: string) => {
    if (!fechaStr) return "";
    const [y, m, d] = fechaStr.split("-");
    return `${d}/${m}/${y}`;
  };

  // Exportar a PDF vectorial con jsPDF
  const handleExportarPDF = async () => {
    if (!data) return;
    setExportandoPDF(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      // Cabecera Corporativa
      doc.setFillColor(220, 38, 38); // Rojo
      doc.rect(0, 0, 210, 12, "F");

      doc.setTextColor(220, 38, 38);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("TRANSAVIC & AVÍCOLA DE TONY", 105, 24, { align: "center" });

      doc.setTextColor(31, 41, 55);
      doc.setFontSize(16);
      doc.text("Conciliación de Cartera Financiera", 105, 32, { align: "center" });

      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(`Ejecutiva: ${getAsesoraNameHeader()}`, 105, 37, { align: "center" });
      doc.text(`Periodo: Del ${formatFechaCorto(desde)} al ${formatFechaCorto(hasta)}`, 105, 42, { align: "center" });

      // Línea divisoria
      doc.setDrawColor(229, 231, 235);
      doc.setLineWidth(0.5);
      doc.line(15, 46, 195, 46);

      let y = 54;

      // Resumen por Ejecutiva si aplica
      if (asesorId === "todos" && resumenAsesoras.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(55, 65, 81);
        doc.setFontSize(10);
        doc.text("RESUMEN DE CARTERA POR EJECUTIVA", 15, y);
        y += 4;

        // Cabecera mini tabla
        doc.setFillColor(243, 244, 246);
        doc.rect(15, y, 180, 7, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(107, 114, 128);
        doc.text("Ejecutiva", 18, y + 5);
        doc.text("Kilos", 70, y + 5, { align: "right" });
        doc.text("Venta (S/)", 98, y + 5, { align: "right" });
        doc.text("A Cuenta (S/)", 132, y + 5, { align: "right" });
        doc.text("NC (S/)", 160, y + 5, { align: "right" });
        doc.text("Pendiente (S/)", 192, y + 5, { align: "right" });

        y += 7;

        // Filas mini tabla
        resumenAsesoras.forEach((a) => {
          doc.setDrawColor(243, 244, 246);
          doc.line(15, y + 7, 195, y + 7);

          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.5);
          doc.setTextColor(31, 41, 55);
          doc.text(a.nombre, 18, y + 5);

          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.text(a.kg > 0 ? `${a.kg.toFixed(2)} kg` : "—", 70, y + 5, { align: "right" });
          doc.text(a.venta > 0 ? a.venta.toFixed(2) : "—", 98, y + 5, { align: "right" });
          doc.setTextColor(16, 185, 129); // Emerald
          doc.text(a.cobrado > 0 ? `-${a.cobrado.toFixed(2)}` : "—", 132, y + 5, { align: "right" });
          doc.setTextColor(59, 130, 246); // Blue
          doc.text(a.descuento > 0 ? `-${a.descuento.toFixed(2)}` : "—", 160, y + 5, { align: "right" });
          doc.setTextColor(220, 38, 38); // Red
          doc.setFont("helvetica", "bold");
          doc.text(a.pendiente > 0 ? a.pendiente.toFixed(2) : "0.00", 192, y + 5, { align: "right" });

          y += 7;
        });

        y += 10;
      }

      // Detalle de Clientes
      doc.setFont("helvetica", "bold");
      doc.setTextColor(55, 65, 81);
      doc.setFontSize(10);
      doc.text("DETALLE POR CLIENTE", 15, y);
      y += 4;

      // Cabecera tabla clientes
      doc.setFillColor(243, 244, 246);
      doc.rect(15, y, 180, 8, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(107, 114, 128);
      doc.text("Cliente", 18, y + 5.5);
      doc.text("Kilos", 65, y + 5.5, { align: "right" });
      doc.text("Venta (S/)", 90, y + 5.5, { align: "right" });
      doc.text("Sald. Ant.", 115, y + 5.5, { align: "right" });
      doc.text("A Cuenta", 140, y + 5.5, { align: "right" });
      doc.text("NC Desct.", 165, y + 5.5, { align: "right" });
      doc.text("Pendiente", 192, y + 5.5, { align: "right" });

      y += 8;

      // Filas clientes
      data.clientes.forEach((c) => {
        if (y > 260) {
          doc.addPage();
          y = 20;
          doc.setFillColor(243, 244, 246);
          doc.rect(15, y, 180, 8, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(107, 114, 128);
          doc.text("Cliente", 18, y + 5.5);
          doc.text("Kilos", 65, y + 5.5, { align: "right" });
          doc.text("Venta (S/)", 90, y + 5.5, { align: "right" });
          doc.text("Sald. Ant.", 115, y + 5.5, { align: "right" });
          doc.text("A Cuenta", 140, y + 5.5, { align: "right" });
          doc.text("NC Desct.", 165, y + 5.5, { align: "right" });
          doc.text("Pendiente", 192, y + 5.5, { align: "right" });
          y += 8;
        }

        doc.setDrawColor(243, 244, 246);
        doc.line(15, y + 8, 195, y + 8);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(31, 41, 55);
        const nombreCliente = c.cliente_nombre.length > 25
          ? c.cliente_nombre.substring(0, 22) + "..."
          : c.cliente_nombre;
        doc.text(nombreCliente, 18, y + 4.5);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(75, 85, 99);
        doc.text(c.kg_vendidos > 0 ? c.kg_vendidos.toFixed(2) : "—", 65, y + 4.5, { align: "right" });
        doc.text(c.monto_venta > 0 ? c.monto_venta.toFixed(2) : "—", 90, y + 4.5, { align: "right" });
        doc.text(c.saldo_anterior > 0 ? c.saldo_anterior.toFixed(2) : "—", 115, y + 4.5, { align: "right" });
        doc.setTextColor(16, 185, 129);
        doc.text(c.cobrado > 0 ? `-${c.cobrado.toFixed(2)}` : "—", 140, y + 4.5, { align: "right" });
        doc.setTextColor(59, 130, 246);
        doc.text(c.descuento > 0 ? `-${c.descuento.toFixed(2)}` : "—", 165, y + 4.5, { align: "right" });
        doc.setTextColor(220, 38, 38);
        doc.setFont("helvetica", "bold");
        doc.text(c.saldo_pendiente > 0 ? c.saldo_pendiente.toFixed(2) : "0.00", 192, y + 4.5, { align: "right" });

        y += 8.5;
      });

      // Fila de Totales
      if (y > 260) {
        doc.addPage();
        y = 20;
      }
      doc.setFillColor(243, 244, 246);
      doc.rect(15, y, 180, 10, "F");
      doc.setDrawColor(209, 213, 219);
      doc.rect(15, y, 180, 10, "D");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(55, 65, 81);
      doc.text("TOTAL CONSOLIDADO", 18, y + 6.5);
      
      doc.text(totalKg > 0 ? `${totalKg.toFixed(2)} kg` : "—", 65, y + 6.5, { align: "right" });
      doc.text(totalVenta.toFixed(2), 90, y + 6.5, { align: "right" });
      doc.text(totalSaldoAnt > 0 ? totalSaldoAnt.toFixed(2) : "—", 115, y + 6.5, { align: "right" });
      doc.setTextColor(16, 185, 129);
      doc.text(totalCobrado > 0 ? `-${totalCobrado.toFixed(2)}` : "—", 140, y + 6.5, { align: "right" });
      doc.setTextColor(59, 130, 246);
      doc.text(totalDescuento > 0 ? `-${totalDescuento.toFixed(2)}` : "—", 165, y + 6.5, { align: "right" });
      doc.setTextColor(220, 38, 38);
      doc.setFontSize(9.5);
      doc.text(totalPendiente.toFixed(2), 192, y + 6.5, { align: "right" });

      // Footer
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(156, 163, 175);
      doc.text("TRANSAVIC ERP · CONCILIACIÓN DE COBRANZAS", 105, 276, { align: "center" });
      
      const dateStr = `Generado el ${new Date().toLocaleDateString("es-PE")} a las ${new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}`;
      doc.text(dateStr, 105, 281, { align: "center" });

      doc.save(`conciliacion-cartera-${desde}-al-${hasta}.pdf`);
    } catch (err) {
      console.error("Error al exportar PDF:", err);
      alert("Ocurrió un error al generar el PDF.");
    } finally {
      setExportandoPDF(false);
    }
  };

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
    
    if (asesorId === "todos" && resumenAsesoras.length > 0) {
      texto += `*Resumen por Asesora:*\n`;
      resumenAsesoras.forEach((a) => {
        texto += `• *${a.nombre}*: Venta: S/ ${a.venta.toFixed(2)} | Cobro: S/ ${a.cobrado.toFixed(2)} | Pendiente: *S/ ${a.pendiente.toFixed(2)}*\n`;
      });
      texto += `\n`;
    }

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
  }, [data, desde, hasta, totalKg, totalVenta, totalSaldoAnt, totalCobrado, totalDescuento, totalPendiente, getAsesoraNameHeader, asesorId, resumenAsesoras]);

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
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <button
              onClick={handleExportarPDF}
              disabled={exportandoPDF}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {exportandoPDF ? <FiLoader className="animate-spin" /> : <FiFileText />}
              <span>Descargar PDF</span>
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
            <div className="flex flex-col gap-6">
              {/* 2. Cuadro Resumen por Asesora en pantalla (sólo si es Admin o Producción y se consultan "Todos") */}
              {asesorId === "todos" && resumenAsesoras.length > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 shadow-xs bg-white">
                  <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b border-gray-100 pb-2">
                    <FiUsers className="text-red-500 text-sm" />
                    Resumen Consolidado por Ejecutiva
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 text-gray-400 font-bold">
                          <th className="py-2 pr-2">Ejecutiva</th>
                          <th className="py-2 text-right">Kilos</th>
                          <th className="py-2 text-right">Venta (S/)</th>
                          <th className="py-2 text-right">Sald. Ant.</th>
                          <th className="py-2 text-right">A Cuenta</th>
                          <th className="py-2 text-right">Desct.</th>
                          <th className="py-2 text-right">Pendiente</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
                        {resumenAsesoras.map((a, idx) => (
                          <tr key={idx} className="hover:bg-gray-100/45 transition-colors">
                            <td className="py-2.5 pr-2 font-bold text-gray-900">{a.nombre}</td>
                            <td className="py-2.5 text-right tabular-nums text-gray-600">
                              {a.kg > 0 ? `${a.kg.toFixed(2)} kg` : "—"}
                            </td>
                            <td className="py-2.5 text-right tabular-nums font-semibold text-gray-900">
                              {a.venta > 0 ? formatSoles(a.venta) : "—"}
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-gray-600">
                              {a.saldoAnterior > 0 ? formatSoles(a.saldoAnterior) : "—"}
                            </td>
                            <td className="py-2.5 text-right tabular-nums font-bold text-emerald-600">
                              {a.cobrado > 0 ? `-${formatSoles(a.cobrado)}` : "—"}
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-blue-600">
                              {a.descuento > 0 ? `-${formatSoles(a.descuento)}` : "—"}
                            </td>
                            <td className={`py-2.5 text-right tabular-nums font-black ${
                              a.pendiente > 0 ? "text-red-600" : "text-gray-500"
                            }`}>
                              {a.pendiente > 0 ? formatSoles(a.pendiente) : "S/ 0.00"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="border border-gray-200 rounded-2xl overflow-x-auto shadow-xs bg-white w-full">
                {/* Contenedor que será fotografiado por html-to-image */}
                <div
                  ref={reportRef}
                  className="bg-white p-6 flex flex-col gap-6 select-none"
                  style={{ width: "960px", minWidth: "960px" }}
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
                            <div className="text-[10px] text-gray-400 mt-0.5 max-w-[200px] truncate flex items-center gap-2">
                              {c.cliente_razon_social && (
                                <span>{c.cliente_razon_social}</span>
                              )}
                              {c.cliente_ruc_dni && (
                                <span className="font-mono">({c.cliente_ruc_dni})</span>
                              )}
                              {asesorId === "todos" && (
                                <span className="px-1 py-0.2 bg-gray-100 text-gray-600 text-[8px] rounded uppercase font-bold">
                                  {c.asesor_name}
                                </span>
                              )}
                            </div>
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
                      Transavic & Avícola de Tony · Módulo de Control de Cobranzas
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
