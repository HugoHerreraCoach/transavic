// src/app/dashboard/reportes/cuadre-mermas-tab.tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FiDownload, FiShare2, FiLoader, FiCalendar, FiBox, FiCopy } from "react-icons/fi";
import { toJpeg } from "html-to-image";
import { toLocalDateString } from "@/lib/utils";

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

interface CuadreFisicoResponse {
  fecha: string;
  productos: ProductoCuadre[];
}

export default function CuadreMermasTab() {
  const [fecha, setFecha] = useState<string>("");
  const [data, setData] = useState<CuadreFisicoResponse | null>(null);
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

    const fetchCuadre = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/reportes/cuadre-fisico?fecha=${fecha}`);
        if (!res.ok) {
          throw new Error("No se pudo cargar el cuadre físico");
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error("Error cargando cuadre físico:", err);
        setError("Error al calcular el cuadre de mermas físicas.");
      } finally {
        setLoading(false);
      }
    };

    fetchCuadre();
  }, [fecha]);

  // Exportar a JPG para compartir por WhatsApp
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
      link.download = `cuadre-mermas-${data.fecha}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Error al exportar cuadre:", err);
      alert("Hubo un error al generar la imagen del reporte. Inténtalo de nuevo.");
    } finally {
      setExportando(false);
    }
  }, [data]);

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
      const file = new File([blob], `cuadre-mermas-${data.fecha}.jpg`, {
        type: "image/jpeg",
      });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Cuadre de Mermas - ${data.fecha}`,
          text: `Resumen de conciliación física Transavic.`,
        });
      } else {
        const link = document.createElement("a");
        link.download = `cuadre-mermas-${data.fecha}.jpg`;
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      console.error("Error al compartir cuadre:", err);
    } finally {
      setExportando(false);
    }
  }, [data]);

  // Aritmética de Totales
  const totalJabasCompra = data?.productos.reduce((acc, p) => acc + p.jabas_compradas, 0) ?? 0;
  const totalCompra = data?.productos.reduce((acc, p) => acc + p.kg_comprados, 0) ?? 0;
  const totalEjecutivas = data?.productos.reduce((acc, p) => acc + p.kg_ejecutivas, 0) ?? 0;
  const totalPlanta = data?.productos.reduce((acc, p) => acc + p.kg_planta, 0) ?? 0;
  const totalCampo = data?.productos.reduce((acc, p) => acc + p.kg_campo, 0) ?? 0;
  const totalVenta = data?.productos.reduce((acc, p) => acc + p.kg_vendidos, 0) ?? 0;
  const totalDiferencia = data?.productos.reduce((acc, p) => acc + p.diferencia, 0) ?? 0;

  // Formatear fecha para el encabezado
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

  const handleCopiarTexto = useCallback(async () => {
    if (!data) return;
    setCopiando(true);

    let texto = `*CUADRE FÍSICO DE STOCK Y MERMAS* 📦\n`;
    texto += `📅 *Fecha:* ${formatFechaEncabezado(data.fecha)}\n\n`;
    texto += `*Detalle por Producto:*\n`;
    texto += `-----------------------\n`;

    data.productos.forEach((p) => {
      texto += `• *${p.producto_nombre}*: Compra: ${p.kg_comprados.toFixed(2)} kg (${p.jabas_compradas} jabas) | Venta: ${p.kg_vendidos.toFixed(2)} kg | Dif: *${p.diferencia.toFixed(2)} kg*\n`;
    });

    texto += `\n🔥 *TOTAL CONSOLIDADO:*\n`;
    texto += `• Kilos Compra: ${totalCompra.toFixed(2)} kg (${totalJabasCompra} jabas)\n`;
    texto += `• Kilos Venta: ${totalVenta.toFixed(2)} kg\n`;
    texto += `• *MERMA / DIFERENCIA:* *${totalDiferencia.toFixed(2)} kg*`;

    try {
      await navigator.clipboard.writeText(texto);
      alert("Resumen de texto copiado al portapapeles. Listo para pegar en WhatsApp.");
    } catch (err) {
      console.error("Error al copiar texto:", err);
    } finally {
      setCopiando(false);
    }
  }, [data, totalCompra, totalJabasCompra, totalVenta, totalDiferencia]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Controles de Vista */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 shadow-xs flex flex-col md:flex-row md:items-end justify-between gap-5">
        <div className="flex items-center gap-2">
          <FiCalendar className="text-gray-400" />
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-red-200 outline-none"
          />
        </div>

        {data && data.productos.length > 0 && (
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
          <span className="text-sm text-gray-500">Calculando cuadre de stock y mermas...</span>
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
          {data.productos.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500 text-sm shadow-xs">
              No se registraron movimientos de compra ni venta de carnes para la fecha seleccionada.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-xs bg-white">
              {/* Contenedor que será fotografiado por html-to-image */}
              <div
                ref={reportRef}
                className="bg-white p-6 flex flex-col gap-6 select-none overflow-x-auto"
                style={{ width: "100%", minWidth: "900px" }}
              >
                {/* Cabecera del Reporte */}
                <div className="flex justify-between items-end border-b border-gray-100 pb-4">
                  <div>
                    <h2 className="text-xs font-bold text-red-600 tracking-widest uppercase mb-1">
                      TRANSAVIC & EL TONY
                    </h2>
                    <h1 className="text-lg font-black text-gray-900 tracking-tight">
                      Cuadración Física e Inventario Diario
                    </h1>
                    <p className="text-[11px] font-semibold text-gray-500 mt-1 capitalize">
                      {formatFechaEncabezado(data.fecha)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      <FiBox /> Control de Mermas Físicas
                    </span>
                  </div>
                </div>

                {/* Tabla de Balances */}
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 w-1/4">
                        Producto / Categoría
                      </th>
                      <th colSpan={2} className="py-1 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-center bg-amber-50/10 border-b border-amber-100">
                        Carga (Compra)
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Venta Ejecutivas
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Venta Campo
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Venta Planta
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right bg-gray-50/50">
                        Total Vendido
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Diferencia (Merma)
                      </th>
                    </tr>
                    <tr className="border-b border-gray-200">
                      <th className="py-1 text-[8px] uppercase font-bold tracking-wider text-gray-400 text-right bg-amber-50/5 pr-2">
                        Jabas
                      </th>
                      <th className="py-1 text-[8px] uppercase font-bold tracking-wider text-gray-400 text-right bg-amber-50/10 pr-2">
                        Kilos
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                    {data.productos.map((p, i) => (
                      <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 pr-2">
                          <div className="font-bold text-gray-900">{p.producto_nombre}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5 capitalize">
                            {p.producto_categoria}
                          </div>
                        </td>
                        <td className="py-3 text-right font-medium tabular-nums text-gray-500 bg-amber-50/5 pr-2">
                          {p.jabas_compradas > 0 ? `${p.jabas_compradas} jab.` : "—"}
                        </td>
                        <td className="py-3 text-right font-bold tabular-nums text-gray-900 bg-amber-50/10 pr-2">
                          {p.kg_comprados > 0 ? `${p.kg_comprados.toFixed(2)} kg` : "—"}
                        </td>
                        <td className="py-3 text-right font-medium tabular-nums text-blue-600/80">
                          {p.kg_ejecutivas > 0 ? `${p.kg_ejecutivas.toFixed(2)} kg` : "—"}
                        </td>
                        <td className="py-3 text-right font-medium tabular-nums text-amber-600/80">
                          {p.kg_campo > 0 ? `${p.kg_campo.toFixed(2)} kg` : "—"}
                        </td>
                        <td className="py-3 text-right font-medium tabular-nums text-violet-600/80">
                          {p.kg_planta > 0 ? `${p.kg_planta.toFixed(2)} kg` : "—"}
                        </td>
                        <td className="py-3 text-right font-bold tabular-nums text-gray-900 bg-gray-50/50">
                          {p.kg_vendidos > 0 ? `${p.kg_vendidos.toFixed(2)} kg` : "—"}
                        </td>
                        <td className={`py-3 text-right font-black tabular-nums ${
                          p.diferencia < 0 
                            ? "text-red-600 bg-red-50/20" 
                            : p.diferencia > 0 
                            ? "text-blue-600 bg-blue-50/10" 
                            : "text-gray-500"
                        }`}>
                          {p.diferencia !== 0 ? `${p.diferencia.toFixed(2)} kg` : "0.00 kg"}
                        </td>
                      </tr>
                    ))}

                    {/* Fila de Totales */}
                    <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                      <td className="py-3.5 pl-2 text-xs uppercase font-bold text-gray-600">
                        TOTAL CONSOLIDADO
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-gray-600 bg-amber-50/10 pr-2">
                        {totalJabasCompra > 0 ? `${totalJabasCompra} jab.` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-gray-900 bg-amber-50/20 pr-2">
                        {totalCompra > 0 ? `${totalCompra.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-blue-700">
                        {totalEjecutivas > 0 ? `${totalEjecutivas.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-amber-700">
                        {totalCampo > 0 ? `${totalCampo.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-violet-700">
                        {totalPlanta > 0 ? `${totalPlanta.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-gray-900 bg-gray-50">
                        {totalVenta > 0 ? `${totalVenta.toFixed(2)} kg` : "—"}
                      </td>
                      <td className={`py-3.5 text-right tabular-nums text-sm font-black ${
                        totalDiferencia < 0 ? "text-red-700 bg-red-50/40" : "text-blue-700 bg-blue-50/20"
                      }`}>
                        {totalDiferencia.toFixed(2)} kg
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Pie de Página */}
                <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                  <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">
                    Transavic & El Tony · Módulo de Control de Mermas de Carga
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
    </div>
  );
}
