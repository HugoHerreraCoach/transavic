// src/app/dashboard/comunicados/comunicados-client.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import {
  FiPlus,
  FiEye,
  FiX,
  FiCheckCircle,
  FiClock,
  FiMessageSquare,
  FiImage,
  FiSend,
  FiTrash2,
} from "react-icons/fi";
import imageCompression from "browser-image-compression";

interface User {
  id: string;
  name: string;
  role: string;
}

interface Comunicado {
  id: string;
  titulo: string;
  cuerpo: string;
  creado_por: string;
  destinatarios: string[]; // UUID strings
  created_at: string;
  lecturas_count: number;
}

interface DetalleLectura {
  user_id: string;
  name: string;
  role: string;
  leido_at: string;
}

interface DetalleComunicado {
  comunicado: {
    id: string;
    titulo: string;
    cuerpo: string;
    creado_por: string;
    destinatarios: string[];
    created_at: string;
  };
  imagenes: Array<{ id: string; orden: number; imagen_mime: string }>;
  lecturas: DetalleLectura[];
  pendientes: Array<{ id: string; name: string; role: string }>;
}

export default function ComunicadosClient() {
  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [usuarios, setUsuarios] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // Modales
  const [showNuevoModal, setShowNuevoModal] = useState(false);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [detalleData, setDetalleData] = useState<DetalleComunicado | null>(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);
  const [lightboxImgId, setLightboxImgId] = useState<string | null>(null);

  // Formulario Nuevo Comunicado
  const [titulo, setTitulo] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [destinatariosSeleccionados, setDestinatariosSeleccionados] = useState<string[]>([]);
  const [imagenes, setImagenes] = useState<Array<{ base64: string; mime: string; preview: string }>>([]);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  // Cargar datos iniciales
  const fetchInitialData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resCom, resUser] = await Promise.all([
        fetch("/api/comunicados"),
        fetch("/api/users"),
      ]);

      if (!resCom.ok) throw new Error("No se pudieron obtener los comunicados");
      if (!resUser.ok) throw new Error("No se pudieron obtener los usuarios");

      const comData = await resCom.json();
      const userData = await resUser.json();

      setComunicados(comData);
      // Filtrar administradores si no queremos mandar comunicados a los administradores habitualmente,
      // pero igual los dejamos en la lista por si acaso.
      setUsuarios(userData);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  // Cargar detalle de un comunicado
  const fetchDetalle = async (id: string) => {
    setLoadingDetalle(true);
    setDetalleId(id);
    setDetalleData(null);
    try {
      const res = await fetch(`/api/comunicados/${id}`);
      if (!res.ok) throw new Error("No se pudo obtener el detalle del comunicado");
      const data = await res.json();
      setDetalleData(data);
    } catch (err) {
      setMensaje((err as Error).message);
      setTimeout(() => setMensaje(null), 4000);
      setDetalleId(null);
    } finally {
      setLoadingDetalle(false);
    }
  };

  // Compresión y previsualización de imágenes
  const handleSelectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    // Máximo 10 imágenes
    if (imagenes.length + files.length > 10) {
      setMensaje("❌ Máximo 10 imágenes por comunicado");
      setTimeout(() => setMensaje(null), 4000);
      return;
    }

    setComprimiendo(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const compressed = await imageCompression(file, {
          maxSizeMB: 0.09, // ~90KB
          maxWidthOrHeight: 1280,
          useWebWorker: true,
          fileType: "image/webp",
          initialQuality: 0.75,
        });

        const dataUrl = await imageCompression.getDataUrlFromFile(compressed);
        const comma = dataUrl.indexOf(",");
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const mime = compressed.type || "image/webp";

        setImagenes((prev) => [...prev, { base64, mime, preview: dataUrl }]);
      }
    } catch (err) {
      console.error(err);
      setMensaje("❌ Error al procesar las imágenes");
      setTimeout(() => setMensaje(null), 4000);
    } finally {
      setComprimiendo(false);
      // Reset input value to allow selecting same images again
      e.target.value = "";
    }
  };

  const removeImagen = (index: number) => {
    setImagenes((prev) => prev.filter((_, i) => i !== index));
  };

  // Agrupar usuarios por rol para el selector
  const usuariosPorRol = useMemo(() => {
    const roles: Record<string, User[]> = {
      asesor: [],
      repartidor: [],
      produccion: [],
      admin: [],
    };
    usuarios.forEach((u) => {
      if (roles[u.role]) roles[u.role].push(u);
    });
    return roles;
  }, [usuarios]);

  const toggleSelectUser = (id: string) => {
    setDestinatariosSeleccionados((prev) =>
      prev.includes(id) ? prev.filter((uid) => uid !== id) : [...prev, id]
    );
  };

  const selectGroup = (role: string) => {
    const ids = usuariosPorRol[role].map((u) => u.id);
    setDestinatariosSeleccionados((prev) => {
      // Filtrar los que ya estaban y añadir todos
      const filtered = prev.filter((id) => !ids.includes(id));
      return [...filtered, ...ids];
    });
  };

  const deselectGroup = (role: string) => {
    const ids = usuariosPorRol[role].map((u) => u.id);
    setDestinatariosSeleccionados((prev) => prev.filter((id) => !ids.includes(id)));
  };

  const selectAll = () => {
    const allIds = usuarios.map((u) => u.id);
    setDestinatariosSeleccionados(allIds);
  };

  const deselectAll = () => {
    setDestinatariosSeleccionados([]);
  };

  // Envío del comunicado
  const handleEnviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim()) {
      setMensaje("❌ El título es obligatorio");
      setTimeout(() => setMensaje(null), 3000);
      return;
    }
    if (destinatariosSeleccionados.length === 0) {
      setMensaje("❌ Debes seleccionar al menos un destinatario");
      setTimeout(() => setMensaje(null), 3000);
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/comunicados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: titulo.trim(),
          cuerpo: cuerpo.trim(),
          destinatarios: destinatariosSeleccionados,
          imagenes: imagenes.map((img) => ({ base64: img.base64, mime: img.mime })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo crear el comunicado");
      }

      setMensaje("🎉 Comunicado enviado con éxito");
      setTimeout(() => setMensaje(null), 3000);
      
      // Limpiar form y cerrar modal
      setTitulo("");
      setCuerpo("");
      setDestinatariosSeleccionados([]);
      setImagenes([]);
      setShowNuevoModal(false);
      
      // Recargar lista
      fetchInitialData();
    } catch (err) {
      setMensaje(`❌ ${(err as Error).message}`);
      setTimeout(() => setMensaje(null), 4000);
    } finally {
      setEnviando(false);
    }
  };

  const handleEliminar = async (id: string) => {
    if (
      !window.confirm(
        "¿Estás seguro de que deseas eliminar este comunicado? Se borrará permanentemente junto con su historial de lecturas e imágenes asociadas."
      )
    ) {
      return;
    }

    setEliminandoId(id);
    try {
      const res = await fetch(`/api/comunicados/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo eliminar el comunicado");
      }

      setMensaje("🚫 Comunicado eliminado con éxito");
      setTimeout(() => setMensaje(null), 3000);

      if (detalleId === id) {
        setDetalleId(null);
        setDetalleData(null);
      }

      fetchInitialData();
    } catch (err) {
      setMensaje(`❌ ${(err as Error).message}`);
      setTimeout(() => setMensaje(null), 4000);
    } finally {
      setEliminandoId(null);
    }
  };

  // Naming helper en español neutro
  const translateRole = (role: string) => {
    switch (role) {
      case "admin":
        return "Administrador";
      case "asesor":
        return "Asesora comercial";
      case "repartidor":
        return "Repartidor";
      case "produccion":
        return "Producción";
      default:
        return role;
    }
  };

  const translateRolePlural = (role: string) => {
    switch (role) {
      case "admin":
        return "Administradores";
      case "asesor":
        return "Asesoras comerciales";
      case "repartidor":
        return "Repartidores";
      case "produccion":
        return "Personal de producción";
      default:
        return role + "s";
    }
  };

  const formatFecha = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleDateString("es-PE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando comunicados…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <header className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FiMessageSquare className="text-red-600" />
            Comunicados Internos
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Envía avisos importantes con texto e imágenes a los usuarios del equipo y audita su lectura.
          </p>
        </div>
        <div>
          <button
            onClick={() => setShowNuevoModal(true)}
            className="w-full sm:w-auto px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl flex items-center justify-center gap-2 font-semibold shadow-md active:scale-95 transition-all duration-200 cursor-pointer"
          >
            <FiPlus size={18} />
            Nuevo comunicado
          </button>
        </div>
      </header>

      {mensaje && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-xl">
          {mensaje}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
          ⚠️ {error}
        </div>
      )}

      {/* Lista de comunicados */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-700">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider border-b border-gray-100">
              <tr>
                <th className="px-6 py-4">Título</th>
                <th className="px-6 py-4">Creado por</th>
                <th className="px-6 py-4">Fecha de envío</th>
                <th className="px-6 py-4 text-center">Lecturas / Destinatarios</th>
                <th className="px-6 py-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {comunicados.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-400">
                    No se han enviado comunicados todavía.
                  </td>
                </tr>
              ) : (
                comunicados.map((com) => {
                  const total = com.destinatarios ? com.destinatarios.length : 0;
                  const leidos = com.lecturas_count || 0;
                  const ratio = total > 0 ? (leidos / total) * 100 : 0;
                  
                  return (
                    <tr key={com.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 font-semibold text-gray-900 max-w-xs truncate">
                        {com.titulo}
                      </td>
                      <td className="px-6 py-4 text-gray-500">{com.creado_por}</td>
                      <td className="px-6 py-4 text-gray-500">{formatFecha(com.created_at)}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <span className="font-semibold text-gray-800 text-xs">
                            {leidos} de {total} ({Math.round(ratio)}%)
                          </span>
                          <div className="w-24 bg-gray-150 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-green-500 h-full rounded-full transition-all duration-300"
                              style={{ width: `${ratio}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => fetchDetalle(com.id)}
                            className="inline-flex items-center justify-center gap-1 px-3 py-1.5 border border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gray-800 font-medium rounded-lg text-xs hover:bg-gray-55 transition-colors cursor-pointer"
                          >
                            <FiEye />
                            Auditar
                          </button>
                          <button
                            onClick={() => handleEliminar(com.id)}
                            disabled={eliminandoId === com.id}
                            className="inline-flex items-center justify-center p-1.5 border border-red-200 hover:border-red-300 hover:bg-red-50 text-red-600 hover:text-red-700 font-medium rounded-lg text-xs transition-colors cursor-pointer disabled:opacity-50"
                            title="Eliminar comunicado"
                          >
                            {eliminandoId === com.id ? (
                              <span className="w-3.5 h-3.5 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <FiTrash2 size={14} />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Detalle & Auditoría */}
      {detalleId && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6 anim-fade"
          onClick={() => setDetalleId(null)}
        >
          <div
            className="relative my-4 w-full max-w-4xl overflow-x-hidden rounded-2xl bg-white p-5 sm:p-6 shadow-2xl anim-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setDetalleId(null)}
              aria-label="Cerrar modal"
              className="absolute right-3 top-3 z-10 rounded-full bg-gray-100 p-2 text-gray-500 hover:text-gray-900 active:scale-95 transition cursor-pointer"
            >
              <FiX size={18} />
            </button>

            {loadingDetalle || !detalleData ? (
              <div className="py-12 text-center text-gray-500">Cargando reporte de lectura…</div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-800 pr-8">
                    {detalleData.comunicado.titulo}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mt-1">
                    <span>Enviado por: <strong>{detalleData.comunicado.creado_por}</strong></span>
                    <span>•</span>
                    <span>Fecha: {formatFecha(detalleData.comunicado.created_at)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                  {/* Contenido Izquierda */}
                  <div className="md:col-span-3 space-y-4 pr-0 md:pr-4 md:border-r border-gray-100">
                    <div className="bg-gray-50 p-4 rounded-xl text-sm leading-relaxed text-gray-700 whitespace-pre-wrap max-h-80 overflow-y-auto border border-gray-100/50">
                      {detalleData.comunicado.cuerpo || <span className="italic text-gray-400">Sin cuerpo de texto.</span>}
                    </div>

                    {/* Imágenes del comunicado */}
                    {detalleData.imagenes && detalleData.imagenes.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                          Imágenes adjuntas ({detalleData.imagenes.length})
                        </h4>
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                          {detalleData.imagenes.map((img) => (
                            <button
                              key={img.id}
                              onClick={() => setLightboxImgId(img.id)}
                              className="relative flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border border-gray-200 hover:opacity-90 active:scale-95 transition cursor-pointer"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/comunicado-imagenes/${img.id}`}
                                alt="Adjunto de comunicado"
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Estado Lecturas Derecha */}
                  <div className="md:col-span-2 space-y-5">
                    {/* Leídos */}
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-green-600 mb-2.5 flex items-center gap-1.5">
                        <FiCheckCircle />
                        Leído por ({detalleData.lecturas.length})
                      </h3>
                      <div className="max-h-56 overflow-y-auto space-y-2 border border-gray-100 rounded-xl p-3 bg-gray-50/50">
                        {detalleData.lecturas.length === 0 ? (
                          <p className="text-xs text-gray-400 italic text-center py-4">
                            Nadie ha leído el comunicado todavía.
                          </p>
                        ) : (
                          detalleData.lecturas.map((lec) => (
                            <div
                              key={lec.user_id}
                              className="flex items-center justify-between text-xs py-1 border-b border-gray-150 last:border-b-0"
                            >
                              <div>
                                <p className="font-semibold text-gray-800">{lec.name.trim()}</p>
                                <p className="text-[10px] text-gray-400 capitalize">
                                  {translateRole(lec.role)}
                                </p>
                              </div>
                              <span className="text-[10px] text-gray-500 tabular-nums">
                                {formatFecha(lec.leido_at)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Pendientes */}
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-2.5 flex items-center gap-1.5">
                        <FiClock />
                        Pendiente de leer ({detalleData.pendientes.length})
                      </h3>
                      <div className="max-h-56 overflow-y-auto space-y-2 border border-gray-100 rounded-xl p-3 bg-gray-50/50">
                        {detalleData.pendientes.length === 0 ? (
                          <p className="text-xs text-green-600 italic text-center py-4">
                            ✅ ¡Leído por todos los destinatarios!
                          </p>
                        ) : (
                          detalleData.pendientes.map((pen) => (
                            <div
                              key={pen.id}
                              className="flex flex-col text-xs py-1 border-b border-gray-150 last:border-b-0"
                            >
                              <span className="font-medium text-gray-600">{pen.name.trim()}</span>
                              <span className="text-[10px] text-gray-400 capitalize">
                                {translateRole(pen.role)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Crear Comunicado */}
      {showNuevoModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6 anim-fade"
          onClick={() => {
            if (!enviando) setShowNuevoModal(false);
          }}
        >
          <div
            className="relative my-4 w-full max-w-3xl overflow-x-hidden rounded-2xl bg-white p-5 sm:p-6 shadow-2xl anim-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                if (!enviando) setShowNuevoModal(false);
              }}
              disabled={enviando}
              aria-label="Cerrar modal"
              className="absolute right-3 top-3 z-10 rounded-full bg-gray-100 p-2 text-gray-500 hover:text-gray-900 active:scale-95 transition disabled:opacity-50 cursor-pointer"
            >
              <FiX size={18} />
            </button>

            <h2 className="text-xl font-bold text-gray-800 mb-5 flex items-center gap-2 pr-8">
              <FiMessageSquare className="text-red-600" />
              Nuevo comunicado para el equipo
            </h2>

            <form onSubmit={handleEnviar} className="space-y-5">
              {/* Título */}
              <div>
                <label htmlFor="txt-titulo" className="block text-sm font-semibold text-gray-700 mb-1">
                  Título del comunicado
                </label>
                <input
                  id="txt-titulo"
                  type="text"
                  required
                  disabled={enviando}
                  placeholder="Ej. Cambio de horario o recordatorio importante..."
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 transition"
                />
              </div>

              {/* Cuerpo */}
              <div>
                <label htmlFor="txt-cuerpo" className="block text-sm font-semibold text-gray-700 mb-1">
                  Mensaje / Cuerpo de texto
                </label>
                <textarea
                  id="txt-cuerpo"
                  rows={4}
                  disabled={enviando}
                  placeholder="Escribe el contenido detallado del comunicado..."
                  value={cuerpo}
                  onChange={(e) => setCuerpo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 transition resize-y"
                />
              </div>

              {/* Imágenes */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Imágenes adjuntas (opcional, máx. 10)
                </label>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <label
                      htmlFor="input-imgs"
                      className={`px-4 py-2 border border-gray-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                        enviando || comprimiendo
                          ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                          : "bg-white hover:bg-gray-50 text-gray-700 shadow-sm active:scale-95"
                      }`}
                    >
                      <FiImage size={15} />
                      Seleccionar imágenes
                    </label>
                    <input
                      id="input-imgs"
                      type="file"
                      multiple
                      accept="image/*"
                      disabled={enviando || comprimiendo}
                      onChange={handleSelectImage}
                      className="hidden"
                    />
                    {comprimiendo && (
                      <span className="text-xs text-gray-500 flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                        Comprimiendo imágenes…
                      </span>
                    )}
                  </div>

                  {/* Previsualización */}
                  {imagenes.length > 0 && (
                    <div className="flex flex-wrap gap-2.5 p-3 bg-gray-50 rounded-xl border border-gray-100">
                      {imagenes.map((img, idx) => (
                        <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 group">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.preview}
                            alt={`Preview ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                          {!enviando && (
                            <button
                              type="button"
                              onClick={() => removeImagen(idx)}
                              className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 shadow hover:bg-red-700 transition cursor-pointer"
                              title="Quitar imagen"
                            >
                              <FiX size={10} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Destinatarios */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-gray-700">
                    Destinatarios del comunicado
                  </label>
                  <div className="flex gap-2 text-xs font-medium mt-1 sm:mt-0">
                    <button
                      type="button"
                      onClick={selectAll}
                      disabled={enviando}
                      className="text-red-600 hover:text-red-700 hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      Seleccionar todos
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      type="button"
                      onClick={deselectAll}
                      disabled={enviando}
                      className="text-gray-500 hover:text-gray-700 hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      Limpiar selección
                    </button>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-2xl overflow-hidden max-h-64 overflow-y-auto bg-gray-50/50 p-4 space-y-4">
                  {["asesor", "repartidor", "produccion", "admin"].map((role) => {
                    const list = usuariosPorRol[role] || [];
                    if (list.length === 0) return null;

                    return (
                      <div key={role} className="space-y-1.5">
                        <div className="flex items-center justify-between border-b border-gray-150 pb-1">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 capitalize">
                            {translateRolePlural(role)} ({list.length})
                          </h4>
                          <div className="flex gap-2 text-[10px] font-semibold text-gray-500">
                            <button
                              type="button"
                              onClick={() => selectGroup(role)}
                              disabled={enviando}
                              className="hover:text-red-600 cursor-pointer"
                            >
                              Marcar grupo
                            </button>
                            <span>•</span>
                            <button
                              type="button"
                              onClick={() => deselectGroup(role)}
                              disabled={enviando}
                              className="hover:text-red-600 cursor-pointer"
                            >
                              Limpiar grupo
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                          {list.map((u) => {
                            const isChecked = destinatariosSeleccionados.includes(u.id);
                            return (
                              <label
                                key={u.id}
                                className={`flex items-center gap-2 p-2 rounded-xl border text-xs cursor-pointer select-none transition-all duration-200 ${
                                  isChecked
                                    ? "bg-red-50/70 border-red-200 text-red-800 font-semibold"
                                    : "bg-white border-gray-150 hover:bg-gray-50 text-gray-700"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={enviando}
                                  checked={isChecked}
                                  onChange={() => toggleSelectUser(u.id)}
                                  className="w-3.5 h-3.5 accent-red-600 rounded"
                                />
                                <span className="truncate" title={u.name.trim()}>
                                  {u.name.trim()}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  Seleccionados: {destinatariosSeleccionados.length} usuarios.
                </p>
              </div>

              {/* Botón Envío */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={enviando || comprimiendo}
                  className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl font-bold shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {enviando ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Enviando comunicado…
                    </>
                  ) : (
                    <>
                      <FiSend size={15} />
                      Enviar comunicado
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox para imágenes */}
      {lightboxImgId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 anim-fade"
          onClick={() => setLightboxImgId(null)}
        >
          <button
            onClick={() => setLightboxImgId(null)}
            className="absolute top-4 right-4 text-white bg-white/10 hover:bg-white/20 p-2.5 rounded-full shadow-lg active:scale-90 transition cursor-pointer"
          >
            <FiX size={24} />
          </button>
          <div
            className="max-w-4xl max-h-[85vh] overflow-hidden rounded-xl shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/comunicado-imagenes/${lightboxImgId}`}
              alt="Adjunto ampliado"
              className="w-full h-auto max-h-[85vh] object-contain mx-auto"
            />
          </div>
        </div>
      )}
    </div>
  );
}
