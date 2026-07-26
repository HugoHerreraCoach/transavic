// src/app/dashboard/reportes/salida-carnes-tab.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FiLoader, FiBox, FiCopy, FiFileText } from "react-icons/fi";
import { toLocalDateString } from "@/lib/utils";

interface SalidaCarnesData {
  fecha_inicio: string;
  fecha_fin: string;
  ejecutivas: number;
  planta: number;
  campo: number;
  total: number;
}

export default function SalidaCarnesTab() {
  const [tipoPeriodo, setTipoPeriodo] = useState<"hoy" | "ayer" | "7dias" | "personalizado">("hoy");
  const [fechaInicio, setFechaInicio] = useState<string>("");
  const [fechaFin, setFechaFin] = useState<string>("");
  const [data, setData] = useState<SalidaCarnesData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [exportandoPDF, setExportandoPDF] = useState<boolean>(false);
  const [copiando, setCopiando] = useState<boolean>(false);

  const reportRef = useRef<HTMLDivElement>(null);

  // Inicializar fecha de hoy (Lima)
  const hoyStr = useRef(toLocalDateString(new Date()));

  useEffect(() => {
    const hoy = hoyStr.current;
    if (tipoPeriodo === "hoy") {
      setFechaInicio(hoy);
      setFechaFin(hoy);
    } else if (tipoPeriodo === "ayer") {
      const date = new Date(hoy + "T12:00:00");
      date.setDate(date.getDate() - 1);
      const ayer = toLocalDateString(date);
      setFechaInicio(ayer);
      setFechaFin(ayer);
    } else if (tipoPeriodo === "7dias") {
      const date = new Date(hoy + "T12:00:00");
      date.setDate(date.getDate() - 6);
      const hace7dias = toLocalDateString(date);
      setFechaInicio(hace7dias);
      setFechaFin(hoy);
    }
  }, [tipoPeriodo]);

  // Cargar datos al cambiar el rango de fechas
  useEffect(() => {
    if (!fechaInicio || !fechaFin) return;

    const fetchSalidas = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/reportes/salida-carnes?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`
        );
        if (!res.ok) {
          throw new Error("No se pudo cargar el reporte");
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Error cargando salidas:", err);
        setError("Error al cargar los datos de salida de productos.");
      } finally {
        setLoading(false);
      }
    };

    fetchSalidas();
  }, [fechaInicio, fechaFin]);

  // Exportar a PDF vectorial usando jsPDF
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
      doc.setFillColor(220, 38, 38); // Rojo corporativo Transavic
      doc.rect(0, 0, 210, 12, "F");

      doc.setTextColor(220, 38, 38);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("TRANSAVIC & LA AVÍCOLA DE TONY", 105, 24, { align: "center" });

      doc.setTextColor(31, 41, 55);
      doc.setFontSize(16);
      doc.text("Consolidado de Salida de Productos", 105, 32, { align: "center" });

      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const periodoTexto =
        fechaInicio === fechaFin
          ? formatFechaEncabezado(fechaInicio)
          : `Periodo: Del ${formatFechaCorto(fechaInicio)} al ${formatFechaCorto(fechaFin)}`;
      doc.text(periodoTexto, 105, 38, { align: "center" });

      // Línea divisoria
      doc.setDrawColor(229, 231, 235);
      doc.setLineWidth(0.5);
      doc.line(15, 43, 195, 43);

      let y = 52;
      const items = [
        { 
          canal: "Ventas Ejecutivas", 
          desc: "Delivery Asesoras", 
          valor: data.ejecutivas, 
          bg: [239, 246, 255],      // bg-blue-50
          border: [191, 219, 254],  // border-blue-200
          iconBg: [219, 234, 254],  // bg-blue-100
          iconText: "VE"
        },
        { 
          canal: "Ventas en Campo", 
          desc: "Motorizados y Ruta", 
          valor: data.campo, 
          bg: [254, 252, 232],      // bg-amber-50
          border: [254, 240, 138],  // border-amber-200
          iconBg: [254, 243, 199],  // bg-amber-100
          iconText: "VC"
        },
        { 
          canal: "Ventas de Planta", 
          desc: "Venta Rápida (POS Planta)", 
          valor: data.planta, 
          bg: [245, 243, 255],      // bg-violet-50
          border: [221, 214, 254],  // border-violet-200
          iconBg: [237, 233, 254],  // bg-violet-100
          iconText: "VP"
        },
      ];

      // Render de canales en tarjetas redondeadas tipo web
      items.forEach((item) => {
        // Fondo y bordes de la tarjeta redondeada
        doc.setFillColor(item.bg[0], item.bg[1], item.bg[2]);
        doc.setDrawColor(item.border[0], item.border[1], item.border[2]);
        doc.setLineWidth(0.4);
        doc.roundedRect(20, y, 170, 22, 3, 3, "FD");

        // Círculo para el icono/iniciales
        doc.setFillColor(item.iconBg[0], item.iconBg[1], item.iconBg[2]);
        doc.ellipse(32, y + 11, 6, 6, "F");
        
        if (item.iconText === "VE") {
          // Moto Lineal / Scooter (Delivery Asesoras)
          doc.setDrawColor(37, 99, 235); // azul-600
          doc.setLineWidth(0.35);
          doc.ellipse(28.5, y + 13.5, 1.1, 1.1, "D"); // Rueda trasera
          doc.ellipse(35.5, y + 13.5, 1.1, 1.1, "D"); // Rueda delantera
          doc.line(28.5, y + 13.5, 32, y + 13.5); // plataforma pies
          doc.line(32, y + 13.5, 35, y + 9.5); // columna timón
          doc.line(35, y + 9.5, 33, y + 9.5); // manubrio
          doc.line(28.5, y + 13.5, 29.5, y + 11); // asiento
          doc.line(29.5, y + 11, 31.5, y + 11);
          doc.setFillColor(37, 99, 235);
          doc.rect(27, y + 9.5, 2.5, 2.5, "F"); // mochila/caja pequeña
        } else if (item.iconText === "VC") {
          // Trimoto / Moto Furgón de Carga de 3 Ruedas (Motorizados y Ruta a Mercados)
          doc.setDrawColor(217, 119, 6); // amber-600
          doc.setLineWidth(0.35);
          // Furgón trasero de carga
          doc.rect(27, y + 9.5, 6, 4, "D");
          // Rueda trasera
          doc.ellipse(30, y + 14, 0.9, 0.9, "D");
          // Horquilla frontal de la trimoto
          doc.line(33, y + 12, 36, y + 12);
          doc.line(36, y + 12, 35, y + 9.5); // manubrio
          doc.line(35, y + 9.5, 33.5, y + 9.5);
          // Rueda delantera
          doc.ellipse(36, y + 14, 0.9, 0.9, "D");
          doc.line(36, y + 12, 36, y + 13.1);
        } else if (item.iconText === "VP") {
          // Fábrica/Planta
          doc.setDrawColor(124, 58, 237); // violet-600
          doc.setLineWidth(0.35);
          doc.rect(28, y + 12.5, 8, 3, "D");
          // Techos sierra
          doc.line(28, y + 12.5, 28, y + 9.5);
          doc.line(28, y + 9.5, 30.6, y + 12.5);
          doc.line(30.6, y + 12.5, 30.6, y + 9.5);
          doc.line(30.6, y + 9.5, 33.3, y + 12.5);
          doc.line(33.3, y + 12.5, 33.3, y + 9.5);
          doc.line(33.3, y + 9.5, 36, y + 12.5);
        }

        // Título del Canal
        doc.setFont("helvetica", "bold");
        doc.setTextColor(31, 41, 55);
        doc.setFontSize(10.5);
        doc.text(item.canal, 42, y + 9);

        // Descripción
        doc.setFont("helvetica", "normal");
        doc.setTextColor(107, 114, 128);
        doc.setFontSize(8.5);
        doc.text(item.desc, 42, y + 14);

        // Kilos despachados (Derecha)
        doc.setFont("helvetica", "bold");
        doc.setTextColor(17, 24, 39);
        doc.setFontSize(12);
        doc.text(`${item.valor.toFixed(2)} kg`, 180, y + 10, { align: "right" });

        // Porcentaje (Derecha inferior)
        doc.setFont("helvetica", "bold");
        doc.setTextColor(75, 85, 99);
        doc.setFontSize(8.5);
        doc.text(`${pct(item.valor)}% DEL TOTAL`, 180, y + 15, { align: "right" });

        y += 26;
      });

      // Total Despachado (Tarjeta redondeada destacada)
      y += 2;
      doc.setFillColor(249, 250, 251); // bg-gray-50
      doc.setDrawColor(229, 231, 235); // border-gray-200
      doc.setLineWidth(0.5);
      doc.roundedRect(20, y, 170, 18, 3, 3, "FD");

      // Círculo rojo del icono total
      doc.setFillColor(254, 226, 226); // bg-red-100
      doc.ellipse(32, y + 9, 6, 6, "F");

      // Caja isométrica 3D vectorizada en rojo
      doc.setDrawColor(220, 38, 38);
      doc.setLineWidth(0.35);
      // Tapa superior
      doc.line(32, y + 6.2, 34.5, y + 7.5);
      doc.line(34.5, y + 7.5, 32, y + 8.8);
      doc.line(32, y + 8.8, 29.5, y + 7.5);
      doc.line(29.5, y + 7.5, 32, y + 6.2);
      // Paredes verticales
      doc.line(29.5, y + 7.5, 29.5, y + 10.5);
      doc.line(32, y + 8.8, 32, y + 11.8);
      doc.line(34.5, y + 7.5, 34.5, y + 10.5);
      // Bordes base
      doc.line(29.5, y + 10.5, 32, y + 11.8);
      doc.line(32, y + 11.8, 34.5, y + 10.5);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(75, 85, 99);
      doc.setFontSize(9.5);
      doc.text("TOTAL DESPACHADO", 42, y + 11.5);

      doc.setFont("helvetica", "black");
      doc.setTextColor(17, 24, 39);
      doc.setFontSize(14);
      doc.text(`${data.total.toFixed(2)} kg`, 180, y + 12.5, { align: "right" });

      // Firma / Footer
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(156, 163, 175);
      doc.text("TRANSAVIC ERP · CONTROL DIARIO DE PRODUCCIÓN", 105, 276, { align: "center" });

      const dateStr = `Generado el ${new Date().toLocaleDateString("es-PE")} a las ${new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}`;
      doc.text(dateStr, 105, 281, { align: "center" });

      doc.save(`salida-productos-${fechaInicio}-a-${fechaFin}.pdf`);
    } catch (err) {
      console.error("Error al generar PDF de salida:", err);
      alert("Error al generar el PDF.");
    } finally {
      setExportandoPDF(false);
    }
  };

  // Formateadores de fecha
  const formatFechaEncabezado = (fechaStr: string) => {
    if (!fechaStr) return "";
    const [y, m, d] = fechaStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("es-PE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const formatFechaCorto = (fechaStr: string) => {
    if (!fechaStr) return "";
    const [y, m, d] = fechaStr.split("-");
    return `${d}/${m}/${y}`;
  };

  const pct = useCallback(
    (val: number) => {
      if (!data || data.total === 0) return 0;
      return Math.round((val / data.total) * 100);
    },
    [data]
  );

  const handleCopiarTexto = useCallback(async () => {
    if (!data) return;
    setCopiando(true);
    const periodoTexto =
      fechaInicio === fechaFin
        ? formatFechaEncabezado(fechaInicio)
        : `Del ${formatFechaCorto(fechaInicio)} al ${formatFechaCorto(fechaFin)}`;

    const text = `*DESPACHO DIARIO TRANSAVIC* 🐔\n📅 *Periodo:* ${periodoTexto}\n\n• *Ventas Ejecutivas:* ${data.ejecutivas.toFixed(2)} kg (${pct(data.ejecutivas)}%)\n• *Venta en Campo:* ${data.campo.toFixed(2)} kg (${pct(data.campo)}%)\n• *Ventas de Planta:* ${data.planta.toFixed(2)} kg (${pct(data.planta)}%)\n\n🔥 *TOTAL DESPACHADO:* *${data.total.toFixed(2)} kg*`;
    try {
      await navigator.clipboard.writeText(text);
      alert("Resumen de texto copiado al portapapeles. Listo para pegar en WhatsApp.");
    } catch (err) {
      console.error("Error al copiar texto:", err);
    } finally {
      setCopiando(false);
    }
  }, [data, pct, fechaInicio, fechaFin]);

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-0">
      {/* Controles de Vista */}
      <div className="flex flex-col gap-4 mb-6 bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          {(["hoy", "ayer", "7dias", "personalizado"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setTipoPeriodo(mode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider border transition-all cursor-pointer ${
                tipoPeriodo === mode
                  ? "bg-red-600 text-white border-red-600 shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              {mode === "hoy" && "Hoy"}
              {mode === "ayer" && "Ayer"}
              {mode === "7dias" && "Últimos 7 días"}
              {mode === "personalizado" && "Personalizado"}
            </button>
          ))}
        </div>

        {tipoPeriodo === "personalizado" && (
          <div className="flex flex-col sm:flex-row items-center gap-3 border-t border-gray-100 pt-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs text-gray-500 font-semibold w-12 sm:w-auto">Desde:</span>
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                className="flex-1 sm:flex-none px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-red-200"
              />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs text-gray-500 font-semibold w-12 sm:w-auto">Hasta:</span>
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                className="flex-1 sm:flex-none px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-red-200"
              />
            </div>
          </div>
        )}

        {data && (
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <button
              onClick={handleExportarPDF}
              disabled={exportandoPDF}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50 cursor-pointer"
            >
              {exportandoPDF ? <FiLoader className="animate-spin" /> : <FiFileText size={14} />}
              <span>Descargar PDF</span>
            </button>
            <button
              onClick={handleCopiarTexto}
              disabled={copiando}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50 cursor-pointer"
            >
              {copiando ? <FiLoader className="animate-spin" /> : <FiCopy size={14} />}
              <span>Copiar Resumen</span>
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <FiLoader className="h-8 w-8 text-red-600 animate-spin mb-2" />
          <span className="text-sm text-gray-500 font-semibold">Cargando reporte de salidas...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 p-4 rounded-lg text-sm text-center">
          {error}
        </div>
      )}

      {/* Reporte Consolidado (Diseñado para fotografiar y compartir) */}
      {!loading && !error && data && (
        <div className="border border-gray-200 rounded-2xl overflow-x-auto shadow-sm bg-white w-full">
          <div
            ref={reportRef}
            className="bg-white p-6 flex flex-col gap-6 select-none"
            style={{ width: "480px", minWidth: "480px", margin: "0 auto" }}
          >
            {/* Cabecera del Reporte */}
            <div className="text-center border-b border-gray-100 pb-4">
              <h2 className="text-xs font-bold text-red-600 tracking-widest uppercase mb-1">
                TRANSAVIC & LA AVÍCOLA DE TONY
              </h2>
              <h1 className="text-lg font-black text-gray-900 tracking-tight">
                Consolidado de Salida de Productos
              </h1>
              <p className="text-[11px] font-bold text-gray-500 mt-1 capitalize">
                {fechaInicio === fechaFin
                  ? formatFechaEncabezado(fechaInicio)
                  : `Del ${formatFechaCorto(fechaInicio)} al ${formatFechaCorto(fechaFin)}`}
              </p>
            </div>

            {/* Listado de Canales */}
            <div className="flex flex-col gap-3">
              {/* Canal 1: Asesoras */}
              <div className="flex items-center justify-between p-3 bg-blue-50/50 border border-blue-100 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm">
                    🛵
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-800">
                      Ventas Ejecutivas
                    </h3>
                    <p className="text-[10px] text-gray-500">Delivery Asesoras</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-gray-800 tabular-nums">
                    {data.ejecutivas.toFixed(2)} kg
                  </div>
                  <div className="text-[9px] font-bold text-blue-600 uppercase tracking-wider">
                    {pct(data.ejecutivas)}% del total
                  </div>
                </div>
              </div>

              {/* Canal 2: Campo */}
              <div className="flex items-center justify-between p-3 bg-amber-50/50 border border-amber-100 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-sm">
                    🛺
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-800">
                      Ventas en Campo
                    </h3>
                    <p className="text-[10px] text-gray-500">Motorizados y Ruta</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-gray-800 tabular-nums">
                    {data.campo.toFixed(2)} kg
                  </div>
                  <div className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">
                    {pct(data.campo)}% del total
                  </div>
                </div>
              </div>

              {/* Canal 3: Planta */}
              <div className="flex items-center justify-between p-3 bg-violet-50/50 border border-violet-100 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center text-sm">
                    🏭
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-800">
                      Ventas de Planta
                    </h3>
                    <p className="text-[10px] text-gray-500">Venta Rápida (POS)</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-gray-800 tabular-nums">
                    {data.planta.toFixed(2)} kg
                  </div>
                  <div className="text-[9px] font-bold text-violet-600 uppercase tracking-wider">
                    {pct(data.planta)}% del total
                  </div>
                </div>
              </div>
            </div>

            {/* Gran Total */}
            <div className="border-t border-dashed border-gray-200 pt-4 mt-2">
              <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div className="flex items-center gap-2">
                  <FiBox className="text-red-500" />
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Total Despachado
                  </span>
                </div>
                <span className="text-lg font-black text-gray-900 tabular-nums">
                  {data.total.toFixed(2)} kg
                </span>
              </div>
            </div>

            {/* Pie de página del ticket */}
            <div className="text-center pt-2 border-t border-gray-100">
              <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">
                Transavic ERP · Control Diario de Producción
              </p>
              <p className="text-[8px] text-gray-400 mt-0.5">
                Generado el {new Date().toLocaleDateString("es-PE")} a las{" "}
                {new Date().toLocaleTimeString("es-PE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
