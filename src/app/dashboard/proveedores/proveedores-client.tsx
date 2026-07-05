"use client";

import { useState, useEffect } from "react";
import { FiSearch, FiPlus, FiEdit2, FiTrash2, FiUsers, FiX, FiPhone, FiMapPin, FiFileText } from "react-icons/fi";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";

interface Proveedor {
  id: string;
  ruc: string;
  razon_social: string;
  direccion: string | null;
  telefono: string | null;
}

interface ProveedoresClientProps {
  userRole: string;
}

export default function ProveedoresClient({ userRole }: ProveedoresClientProps) {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProveedor, setEditingProveedor] = useState<Proveedor | null>(null);
  const [proveedorAEliminar, setProveedorAEliminar] = useState<Proveedor | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { mostrarToast, toasts } = useToast();

  // Form State
  const [form, setForm] = useState({
    ruc: "",
    razon_social: "",
    direccion: "",
    telefono: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchProveedores();
  }, []);

  const fetchProveedores = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/proveedores");
      if (!res.ok) throw new Error("Error cargando proveedores");
      const data = await res.json();
      setProveedores(data);
    } catch (error) {
      console.error(error);
      alert("Error al cargar la lista de proveedores");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingProveedor(null);
    setForm({ ruc: "", razon_social: "", direccion: "", telefono: "" });
    setFormError(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (p: Proveedor) => {
    setEditingProveedor(p);
    setForm({
      ruc: p.ruc,
      razon_social: p.razon_social,
      direccion: p.direccion || "",
      telefono: p.telefono || ""
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleDelete = async () => {
    if (!proveedorAEliminar) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/proveedores/${proveedorAEliminar.id}`, { method: "DELETE" });
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Error al eliminar");
      }

      mostrarToast("Proveedor eliminado con éxito", "exito");
      setProveedorAEliminar(null);
      fetchProveedores();
    } catch (error: unknown) {
      console.error(error);
      mostrarToast(error instanceof Error ? error.message : "Error al eliminar proveedor", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const url = editingProveedor ? `/api/proveedores/${editingProveedor.id}` : "/api/proveedores";
    const method = editingProveedor ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Ocurrió un error");
      }

      setModalOpen(false);
      mostrarToast("Proveedor guardado correctamente", "exito");
      fetchProveedores();
    } catch (error: unknown) {
      console.error(error);
      setFormError(error instanceof Error ? error.message : "Error al procesar formulario");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = proveedores.filter(
    (p) =>
      p.razon_social.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.ruc.includes(searchTerm)
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            Directorio de Proveedores
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full uppercase font-bold tracking-wider">Beta</span>
          </h1>
          <p className="text-gray-500 mt-1">Administra los datos de contacto y facturación de tus proveedores de mercadería.</p>
        </div>
        <button 
          onClick={handleOpenCreate}
          className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg"
        >
          <FiPlus className="w-5 h-5" /> Agregar Proveedor
        </button>
      </div>

      <GuiaModulo modulo="proveedores" />

      <div className="flex items-center bg-white rounded-2xl shadow-sm border border-gray-100 p-2 max-w-md">
        <FiSearch className="text-gray-400 w-5 h-5 ml-3" />
        <input 
          type="text" 
          placeholder="Buscar por Razón Social o RUC..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-3 pr-4 py-2 bg-transparent text-gray-900 focus:outline-none placeholder-gray-400"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 animate-pulse font-medium">Cargando proveedores...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200">
          <FiUsers className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-lg font-medium">No se encontraron proveedores.</p>
          <p className="text-gray-400 text-sm mt-1">Prueba con otra búsqueda o agrega un nuevo proveedor.</p>
          {searchTerm ? (
            <button
              onClick={() => setSearchTerm("")}
              className="mt-4 px-5 py-2.5 text-indigo-600 hover:bg-indigo-50 border border-indigo-200 rounded-xl font-semibold transition-colors cursor-pointer"
            >
              Limpiar búsqueda
            </button>
          ) : (
            <button
              onClick={handleOpenCreate}
              className="mt-4 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-md transition-colors cursor-pointer inline-flex items-center gap-2"
            >
              <FiPlus className="w-4 h-4" /> Agregar Proveedor
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="p-4 font-semibold text-gray-600">RUC</th>
                  <th className="p-4 font-semibold text-gray-600">Razón Social</th>
                  <th className="p-4 font-semibold text-gray-600">Dirección</th>
                  <th className="p-4 font-semibold text-gray-600">Teléfono</th>
                  <th className="p-4 font-semibold text-gray-600 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="p-4 font-medium text-gray-900 flex items-center gap-2">
                      <FiFileText className="text-gray-400" /> {p.ruc}
                    </td>
                    <td className="p-4 text-gray-900 font-semibold">{p.razon_social}</td>
                    <td className="p-4 text-gray-500 max-w-xs truncate">
                      {p.direccion ? (
                        <span className="flex items-center gap-1"><FiMapPin className="text-gray-400 flex-shrink-0" /> {p.direccion}</span>
                      ) : "-"}
                    </td>
                    <td className="p-4 text-gray-500">
                      {p.telefono ? (
                        <span className="flex items-center gap-1"><FiPhone className="text-gray-400" /> {p.telefono}</span>
                      ) : "-"}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleOpenEdit(p)}
                          className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Editar Proveedor"
                        >
                          <FiEdit2 className="w-4 h-4" />
                        </button>
                        {userRole === "admin" && (
                          <button
                            onClick={() => setProveedorAEliminar(p)}
                            className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Eliminar Proveedor"
                          >
                            <FiTrash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL REGISTRAR/EDITAR */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">
                {editingProveedor ? "Editar Proveedor" : "Agregar Nuevo Proveedor"}
              </h2>
              <button 
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3.5 bg-red-50 text-red-700 rounded-xl text-sm font-medium border border-red-100">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">RUC (11 dígitos)</label>
                <input 
                  required 
                  type="text" 
                  maxLength={11}
                  value={form.ruc} 
                  onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, "") })} 
                  className="w-full border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-xl p-3 outline-none transition-all text-gray-900 bg-gray-50" 
                  placeholder="Ej: 20123456789" 
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Razón Social</label>
                <input 
                  required 
                  type="text" 
                  value={form.razon_social} 
                  onChange={(e) => setForm({ ...form, razon_social: e.target.value })} 
                  className="w-full border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-xl p-3 outline-none transition-all text-gray-900 bg-gray-50" 
                  placeholder="Ej: Granja San Fernando S.A." 
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Dirección Fiscal / Granja</label>
                <input 
                  type="text" 
                  value={form.direccion} 
                  onChange={(e) => setForm({ ...form, direccion: e.target.value })} 
                  className="w-full border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-xl p-3 outline-none transition-all text-gray-900 bg-gray-50" 
                  placeholder="Ej: Km 45 Panamericana Norte, Chancay" 
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Teléfono de Contacto</label>
                <input 
                  type="text" 
                  value={form.telefono} 
                  onChange={(e) => setForm({ ...form, telefono: e.target.value })} 
                  className="w-full border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-xl p-3 outline-none transition-all text-gray-900 bg-gray-50" 
                  placeholder="Ej: 987654321 o (01) 456-7890" 
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-50">
                <button 
                  type="button" 
                  onClick={() => setModalOpen(false)} 
                  className="px-5 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl font-semibold transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={submitting} 
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition-colors disabled:opacity-50"
                >
                  {submitting ? "Guardando..." : "Guardar Proveedor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAR ELIMINACIÓN */}
      {proveedorAEliminar && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex justify-center items-center p-4 print:hidden">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Eliminar proveedor</h2>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                ¿Seguro que quieres eliminar al proveedor{" "}
                <span className="font-semibold text-gray-900">&quot;{proveedorAEliminar.razon_social}&quot;</span>?
                Esta acción no se puede deshacer.
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setProveedorAEliminar(null)}
                  disabled={deleting}
                  className="px-5 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl font-semibold transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold shadow-md transition-colors disabled:opacity-50"
                >
                  {deleting ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
