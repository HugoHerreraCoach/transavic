// src/app/dashboard/guias/guias-client.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  FiFileText, 
  FiCheckCircle, 
  FiAlertTriangle, 
  FiXCircle, 
  FiClock, 
  FiDownload, 
  FiPrinter,
  FiSearch,
  FiRefreshCw
} from "react-icons/fi";
import Link from "next/link";

interface Guia {
  id: string;
  pedido_id: string;
  ruc_emisor: string;
  empresa: string;
  serie_numero: string;
  serie: string;
  numero: number;
  cliente_doc_num: string;
  cliente_razon_social: string;
  peso_bruto_total: string;
  total_bultos: number;
  fecha_inicio_traslado: string;
  vehiculo_placa: string | null;
  chofer_doc_num: string | null;
  chofer_licencia: string | null;
  estado: string;
  mensaje_sunat: string | null;
  emitido_por: string | null;
  created_at: string;
  pedido_cliente: string | null;
}

interface GuiasClientProps {
  userRole: string;
}

export default function GuiasClient({ userRole: _userRole }: GuiasClientProps) {
  const [guias, setGuias] = useState<Guia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>("todos");
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");
  const [busqueda, setBusqueda] = useState<string>("");
  // id de la guía cuyo PDF se está generando (descarga jsPDF, como boletas/facturas)
  const [descargandoPdfId, setDescargandoPdfId] = useState<string | null>(null);

  const descargarPdf = async (g: Guia) => {
    setDescargandoPdfId(g.id);
    try {
      const { descargarPdfGuia } = await import("@/lib/descargar-guia");
      await descargarPdfGuia(g.id);
    } catch (err) {
      setError(`No se pudo generar el PDF de ${g.serie_numero}: ${(err as Error).message}`);
    } finally {
      setDescargandoPdfId(null);
    }
  };

  const cargarGuias = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = "/api/guias";
      const params = new URLSearchParams();
      if (filtroEmpresa !== "todos") params.append("empresa", filtroEmpresa);
      
      const queryStr = params.toString();
      if (queryStr) url += `?${queryStr}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error("Error al obtener las guías de remisión");
      const json = await res.json();
      setGuias(json.data || []);
    } catch (err) {
      console.error(err);
      setError("No se pudieron cargar las guías de remisión.");
    } finally {
      setLoading(false);
    }
  }, [filtroEmpresa]);

  useEffect(() => {
    cargarGuias();
  }, [cargarGuias]);

  // Filtrado local en base al estado y búsqueda
  const guiasFiltradas = guias.filter((g) => {
    const cumpleEstado = filtroEstado === "todos" || g.estado === filtroEstado;
    const cleanSearch = busqueda.trim().toLowerCase();
    const cumpleBusqueda =
      !cleanSearch ||
      g.serie_numero.toLowerCase().includes(cleanSearch) ||
      g.cliente_razon_social.toLowerCase().includes(cleanSearch) ||
      g.cliente_doc_num.includes(cleanSearch) ||
      (g.pedido_cliente && g.pedido_cliente.toLowerCase().includes(cleanSearch)) ||
      (g.emitido_por && g.emitido_por.toLowerCase().includes(cleanSearch));

    return cumpleEstado && cumpleBusqueda;
  });

  const getEstadoBadge = (estado: string) => {
    switch (estado) {
      case "aceptado":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/30">
            <FiCheckCircle className="w-3.5 h-3.5" /> Aceptado
          </span>
        );
      case "observado":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/30">
            <FiAlertTriangle className="w-3.5 h-3.5" /> Observado
          </span>
        );
      case "rechazado":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800/30">
            <FiXCircle className="w-3.5 h-3.5" /> Rechazado
          </span>
        );
      case "pendiente":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
            <FiClock className="w-3.5 h-3.5" /> Pendiente
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800/30">
            <FiXCircle className="w-3.5 h-3.5" /> Error
          </span>
        );
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <FiFileText className="text-amber-500" /> Guías de Remisión Electrónicas
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Consulta y descarga las guías de remisión legales emitidas ante la SUNAT.
          </p>
        </div>
        <button
          onClick={cargarGuias}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 active:scale-95 transition-all disabled:opacity-50"
        >
          <FiRefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {/* Barra de Filtros */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        {/* Búsqueda de Texto */}
        <div className="relative md:col-span-2">
          <FiSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por serie/número, cliente, DNI/RUC..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 text-slate-900 dark:text-white transition-all"
          />
        </div>

        {/* Filtro Empresa */}
        <div>
          <select
            value={filtroEmpresa}
            onChange={(e) => setFiltroEmpresa(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 text-slate-950 dark:text-slate-50"
          >
            <option value="todos">Todas las marcas</option>
            <option value="transavic">Transavic</option>
            <option value="avicola">Avícola de Tony</option>
          </select>
        </div>

        {/* Filtro Estado */}
        <div>
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 text-slate-950 dark:text-slate-50"
          >
            <option value="todos">Todos los estados</option>
            <option value="aceptado">Aceptadas</option>
            <option value="observado">Observadas</option>
            <option value="rechazado">Rechazadas</option>
            <option value="pendiente">Pendientes</option>
            <option value="error">Error de Envío</option>
          </select>
        </div>
      </div>

      {/* Listado / Tabla */}
      <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <FiRefreshCw className="w-8 h-8 animate-spin text-amber-500" />
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Cargando guías...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <FiAlertTriangle className="w-10 h-10 text-rose-500" />
            <p className="text-sm font-medium text-rose-600 dark:text-rose-450">{error}</p>
            <button
              onClick={cargarGuias}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-medium text-xs rounded-xl shadow transition-all"
            >
              Reintentar Carga
            </button>
          </div>
        ) : guiasFiltradas.length === 0 ? (
          <div className="text-center py-20">
            <FiFileText className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto" />
            <p className="text-slate-550 dark:text-slate-400 font-medium text-sm mt-3">
              No se encontraron guías de remisión emitidas.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="px-6 py-4">Guía (Serie-Nº)</th>
                  <th className="px-6 py-4">Fecha Traslado</th>
                  <th className="px-6 py-4">Cliente / Receptor</th>
                  <th className="px-6 py-4">Detalle Carga</th>
                  <th className="px-6 py-4">Vehículo / Chofer</th>
                  <th className="px-6 py-4">Estado SUNAT</th>
                  <th className="px-6 py-4 text-right">Descargas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm text-slate-700 dark:text-slate-350">
                {guiasFiltradas.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                    <td className="px-6 py-4.5 font-semibold text-slate-900 dark:text-white">
                      <div>{g.serie_numero}</div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 font-normal mt-0.5">
                        {g.empresa === "avicola" ? "Avícola de Tony" : "Transavic"}
                      </div>
                    </td>
                    <td className="px-6 py-4.5">
                      {new Date(g.fecha_inicio_traslado).toLocaleDateString("es-PE", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric"
                      })}
                    </td>
                    <td className="px-6 py-4.5">
                      <div className="font-semibold text-slate-800 dark:text-slate-200 max-w-[200px] truncate">
                        {g.cliente_razon_social}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {g.cliente_doc_num}
                      </div>
                    </td>
                    <td className="px-6 py-4.5">
                      <div>{parseFloat(g.peso_bruto_total).toFixed(2)} kg</div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {g.total_bultos} bulto(s)
                      </div>
                    </td>
                    <td className="px-6 py-4.5">
                      <div className="font-medium">{g.vehiculo_placa || "Sin Placa"}</div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        DNI: {g.chofer_doc_num || "—"}
                      </div>
                    </td>
                    <td className="px-6 py-4.5">
                      <div>{getEstadoBadge(g.estado)}</div>
                      {g.mensaje_sunat && (
                        <div className="text-[10px] text-slate-400 dark:text-slate-550 max-w-[200px] truncate mt-1" title={g.mensaje_sunat}>
                          {g.mensaje_sunat}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4.5 text-right">
                      <div className="flex justify-end items-center gap-1.5">
                        {/* Descargar PDF (jsPDF, como boletas/facturas) */}
                        <button
                          onClick={() => descargarPdf(g)}
                          disabled={descargandoPdfId === g.id}
                          title="Descargar PDF de la Guía de Remisión"
                          className="px-2.5 py-1.5 text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 rounded-md flex items-center gap-1 transition-colors active:scale-95 disabled:opacity-50"
                        >
                          {descargandoPdfId === g.id
                            ? <FiRefreshCw className="w-3.5 h-3.5 animate-spin" />
                            : <FiDownload className="w-3.5 h-3.5" />}
                          PDF
                        </button>

                        {/* Imprimir representación gráfica */}
                        <Link
                          href={`/pedidos/${g.pedido_id || g.id}/gre?print=true`}
                          target="_blank"
                          className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-650 dark:text-slate-350 rounded-lg transition-colors active:scale-95"
                          title="Imprimir Guía de Remisión"
                        >
                          <FiPrinter className="w-4 h-4" />
                        </Link>

                        {/* Descargar XML */}
                        {g.estado !== "pendiente" && (
                          <>
                            <a
                              href={`/api/guias/${g.id}/xml`}
                              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-650 dark:text-slate-350 rounded-lg transition-colors active:scale-95"
                              title="Descargar XML firmado"
                              download
                            >
                              <FiDownload className="w-4 h-4" />
                            </a>
                            
                            {/* Descargar CDR */}
                            {(g.estado === "aceptado" || g.estado === "observado") && (
                              <a
                                href={`/api/guias/${g.id}/cdr`}
                                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-emerald-600 dark:text-emerald-450 rounded-lg transition-colors active:scale-95"
                                title="Descargar Constancia CDR (ZIP)"
                                download
                              >
                                <FiCheckCircle className="w-4 h-4" />
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
