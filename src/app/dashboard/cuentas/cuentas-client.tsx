"use client";

import { useEffect, useState } from "react";
import { FiPlus, FiBox, FiCreditCard } from "react-icons/fi";
import GuiaModulo from "@/components/GuiaModulo";

type Cuenta = {
  id: string;
  nombre: string;
  tipo: "banco" | "efectivo" | "billetera";
  saldo: number;
  activa: boolean;
};

export default function CuentasClient() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<"banco" | "efectivo" | "billetera">("banco");
  const [saving, setSaving] = useState(false);

  const fetchCuentas = async () => {
    try {
      const res = await fetch("/api/cuentas");
      if (res.ok) {
        const data = await res.json();
        setCuentas(data);
      }
    } catch (error) {
      alert("Error al cargar cuentas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCuentas();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return alert("El nombre es requerido");
    setSaving(true);
    try {
      const res = await fetch("/api/cuentas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, tipo }),
      });
      if (res.ok) {
        alert("Cuenta creada exitosamente");
        setShowModal(false);
        setNombre("");
        fetchCuentas();
      } else {
        const error = await res.json();
        alert(error.error || "Error al crear cuenta");
      }
    } catch (error) {
      alert("Error de red");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <GuiaModulo modulo="cuentas" />
      <div className="flex justify-end">
        <button
          onClick={() => setShowModal(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl flex items-center font-medium shadow-sm transition-colors"
        >
          <FiPlus className="mr-2" /> Nueva Cuenta
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Cargando cuentas...</div>
      ) : cuentas.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center space-y-4">
          <p className="text-gray-500 font-medium">Aún no hay cuentas registradas</p>
          <button
            onClick={() => setShowModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl inline-flex items-center font-medium shadow-sm transition-colors"
          >
            <FiPlus className="mr-2" /> Crear primera cuenta
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cuentas.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className={`p-3 rounded-full ${c.tipo === 'efectivo' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
                    {c.tipo === 'efectivo' ? <FiBox size={20} /> : <FiCreditCard size={20} />}
                  </div>
                  <h3 className="font-semibold text-gray-800 text-lg">{c.nombre}</h3>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.activa ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {c.activa ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <div className="mt-auto pt-4 border-t border-gray-50 flex items-end justify-between">
                <p className="text-sm text-gray-500 font-medium">Saldo Actual</p>
                <p className={`text-2xl font-bold tracking-tight ${c.saldo < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  S/ {Number(c.saldo).toFixed(2)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Nueva Cuenta Bancaria / Caja</h2>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la cuenta</label>
                <input
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="Ej. BCP Antonio, Caja Producción"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as "banco" | "efectivo" | "billetera")}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="banco">Banco</option>
                  <option value="billetera">Billetera Digital (Yape / Plin)</option>
                  <option value="efectivo">Caja Efectivo</option>
                </select>
              </div>
              <div className="pt-4 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-medium transition-colors disabled:opacity-50"
                >
                  {saving ? "Guardando..." : "Crear Cuenta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
