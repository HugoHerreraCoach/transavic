// src/app/dashboard/reportes/salida-carnes-tab.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FiDownload, FiShare2, FiLoader, FiCalendar, FiBox, FiCopy } from "react-icons/fi";
import { toJpeg } from "html-to-image";
import { toLocalDateString } from "@/lib/utils";

interface SalidaCarnesData {
  fecha: string;
  ejecutivas: number;
  planta: number;
  campo: number;
  total: number;
}

export default function SalidaCarnesTab() {
  const [fecha, setFecha] = useState<string>("");
  const [data, setData] = useState<SalidaCarnesData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState<boolean>(false);
  const [copiando, setCopiando] = useState<boolean>(false);

  const reportRef = useRef<HTMLDivElement>(null);

  // Inicializar fecha de hoy (Lima) al montar
  useEffect(() => {
    const hoy = toLocalDateString(new Date());
    setFecha(hoy);
  }, []);

  // Cargar datos al cambiar la fecha
  useEffect(() => {
    if (!fecha) return;

    const fetchSalidas = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/reportes/salida-carnes?fecha=${fecha}`);
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
  }, [fecha]);

  // Exportar a JPG para compartir por WhatsApp
  const handleExportar = useCallback(async () => {
    const el = reportRef.current;
    if (!el || !data) return;

    setExportando(true);
    try {
      // Esperar a que las imágenes y fuentes carguen en el DOM
      await Promise.all(
        Array.from(el.querySelectorAll("img")).map((img) =>
          img.decode().catch(() => undefined)
        )
      );

      const dataUrl = await toJpeg(el, {
        quality: 0.98,
        pixelRatio: 3.0, // Alta definición para pantallas Retina/Móvil
        backgroundColor: "#ffffff",
        cacheBust: true,
        skipFonts: true,
      });

      // Crear enlace temporal para descargar la imagen
      const link = document.createElement("a");
      link.download = `salida-carnes-${data.fecha}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Error al exportar reporte:", err);
      alert("Hubo un error al generar la imagen del reporte. Inténtalo de nuevo.");
    } finally {
      setExportando(false);
    }
  }, [data]);

  // Compartir nativamente (Web Share API si está disponible en móvil/Chrome)
  const handleCompartir = useCallback(async () => {
    const el = reportRef.current;
    if (!el || !data) return;

    setExportando(true);
    try {
      const dataUrl = await toJpeg(el, {
        quality: 0.98,
        pixelRatio: 3.0,
        backgroundColor: "#ffffff",
        cacheBust: true,
        skipFonts: true,
      });

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const file = new File([blob], `salida-carnes-${data.fecha}.jpg`, {
        type: "image/jpeg",
      });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Salida de Productos - ${data.fecha}`,
          text: `Consolidado diario de salida de productos de Transavic.`,
        });
      } else {
        // Fallback: descargar
        const link = document.createElement("a");
        link.download = `salida-carnes-${data.fecha}.jpg`;
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      console.error("Error al compartir reporte:", err);
    } finally {
      setExportando(false);
    }
  }, [data]);

  // Formatear fecha para el encabezado del reporte
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

  const pct = useCallback((val: number) => {
    if (!data || data.total === 0) return 0;
    return Math.round((val / data.total) * 100);
  }, [data]);

  const handleCopiarTexto = useCallback(async () => {
    if (!data) return;
    setCopiando(true);
    const text = `*DESPACHO DIARIO TRANSAVIC* 🐔\n📅 *Fecha:* ${formatFechaEncabezado(data.fecha)}\n\n• *Ventas Ejecutivas:* ${data.ejecutivas.toFixed(2)} kg (${pct(data.ejecutivas)}%)\n• *Venta en Campo:* ${data.campo.toFixed(2)} kg (${pct(data.campo)}%)\n• *Ventas de Planta:* ${data.planta.toFixed(2)} kg (${pct(data.planta)}%)\n\n🔥 *TOTAL DESPACHADO:* *${data.total.toFixed(2)} kg*`;
    try {
      await navigator.clipboard.writeText(text);
      alert("Resumen de texto copiado al portapapeles. Listo para pegar en WhatsApp.");
    } catch (err) {
      console.error("Error al copiar texto:", err);
    } finally {
      setCopiando(false);
    }
  }, [data, pct]);

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-0">
      {/* Controles de Vista */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
        <div className="flex items-center gap-2">
          <FiCalendar className="text-gray-400" />
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-red-200 outline-none"
          />
        </div>

        {data && (
          <div className="flex gap-2">
            <button
              onClick={handleExportar}
              disabled={exportando}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {exportando ? <FiLoader className="animate-spin" /> : <FiDownload />}
              <span>Descargar</span>
            </button>
            <button
              onClick={handleCompartir}
              disabled={exportando}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {exportando ? <FiLoader className="animate-spin" /> : <FiShare2 />}
              <span>Compartir</span>
            </button>
            <button
              onClick={handleCopiarTexto}
              disabled={copiando}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {copiando ? <FiLoader className="animate-spin" /> : <FiCopy />}
              <span>Copiar Resumen</span>
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <FiLoader className="h-8 w-8 text-red-600 animate-spin mb-2" />
          <span className="text-sm text-gray-500">Cargando reporte de salidas...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 p-4 rounded-lg text-sm text-center">
          {error}
        </div>
      )}

      {/* Reporte Consolidado (Diseñado para fotografiar y compartir) */}
      {!loading && !error && data && (
        <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm bg-white">
          <div
            ref={reportRef}
            className="w-full bg-white p-6 flex flex-col gap-6 select-none"
            style={{ width: "100%", maxWidth: "480px", margin: "0 auto" }}
          >
            {/* Cabecera del Reporte */}
            <div className="text-center border-b border-gray-100 pb-4">
              <h2 className="text-xs font-bold text-red-600 tracking-widest uppercase mb-1">
                TRANSAVIC & EL TONY
              </h2>
              <h1 className="text-lg font-black text-gray-900 tracking-tight">
                Consolidado de Salida de Productos
              </h1>
              <p className="text-[11px] font-medium text-gray-500 mt-1 capitalize">
                {formatFechaEncabezado(data.fecha)}
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
                    🏪
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
