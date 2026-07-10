"use client";

import { useEffect, useState } from "react";
import { FiPlus, FiBox, FiCreditCard, FiPower, FiSliders } from "react-icons/fi";
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

  // Desactivar / reactivar
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Ajuste manual de saldo
  const [cuentaAjuste, setCuentaAjuste] = useState<Cuenta | null>(null);
  const [direccionAjuste, setDireccionAjuste] = useState<"sumar" | "restar">("sumar");
  const [montoAjuste, setMontoAjuste] = useState("");
  const [motivoAjuste, setMotivoAjuste] = useState("");
  const [ajustando, setAjustando] = useState(false);

  const fetchCuentas = async () => {
    try {
      const res = await fetch("/api/cuentas");
      if (res.ok) {
        const data = await res.json();
        setCuentas(data);
      }
    } catch {
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
    } catch {
      alert("Error de red");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActiva = async (cuenta: Cuenta) => {
    if (cuenta.activa) {
      const confirmar = confirm(
        `¿Desactivar la cuenta "${cuenta.nombre}"? Dejará de aparecer en los selectores de otras vistas; puedes reactivarla cuando quieras.`
      );
      if (!confirmar) return;
    }
    setTogglingId(cuenta.id);
    try {
      const res = await fetch("/api/cuentas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cuenta.id, activa: !cuenta.activa }),
      });
      if (res.ok) {
        fetchCuentas();
      } else {
        const error = await res.json();
        alert(error.error || "Error al actualizar la cuenta");
      }
    } catch {
      alert("Error de red");
    } finally {
      setTogglingId(null);
    }
  };

  const abrirAjuste = (cuenta: Cuenta) => {
    setCuentaAjuste(cuenta);
    setDireccionAjuste("sumar");
    setMontoAjuste("");
    setMotivoAjuste("");
  };

  const handleAjustarSaldo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cuentaAjuste) return;
    const monto = Number(montoAjuste);
    if (!montoAjuste || isNaN(monto) || monto <= 0) {
      return alert("Ingresa un monto mayor a 0");
    }
    if (!motivoAjuste.trim()) {
      return alert("El motivo del ajuste es obligatorio");
    }
    setAjustando(true);
    try {
      const res = await fetch("/api/transacciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cuenta_id: cuentaAjuste.id,
          tipo: direccionAjuste === "sumar" ? "ingreso" : "egreso",
          monto,
          concepto: `Ajuste manual: ${motivoAjuste.trim()}`,
        }),
      });
      if (res.ok) {
        alert("Saldo ajustado correctamente");
        setCuentaAjuste(null);
        fetchCuentas();
      } else {
        const error = await res.json();
        alert(error.error || "Error al ajustar el saldo");
      }
    } catch {
      alert("Error de red");
    } finally {
      setAjustando(false);
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
            <div key={c.id} className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col hover:shadow-md transition-shadow ${c.activa ? "" : "opacity-60"}`}>
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
              <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-end gap-2">
                {c.activa && (
                  <button
                    onClick={() => abrirAjuste(c)}
                    className="text-sm px-3 py-1.5 rounded-lg font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 inline-flex items-center transition-colors"
                  >
                    <FiSliders className="mr-1.5" size={14} /> Ajustar saldo
                  </button>
                )}
                <button
                  onClick={() => handleToggleActiva(c)}
                  disabled={togglingId === c.id}
                  className={`text-sm px-3 py-1.5 rounded-lg font-medium inline-flex items-center transition-colors disabled:opacity-50 ${
                    c.activa
                      ? "text-red-600 border border-red-200 hover:bg-red-50"
                      : "text-green-700 border border-green-200 hover:bg-green-50"
                  }`}
                >
                  <FiPower className="mr-1.5" size={14} />
                  {togglingId === c.id ? "Guardando..." : c.activa ? "Desactivar" : "Reactivar"}
                </button>
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

      {cuentaAjuste && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Ajustar saldo</h2>
              <p className="text-sm text-gray-500 mt-1">
                {cuentaAjuste.nombre} — saldo actual S/ {Number(cuentaAjuste.saldo).toFixed(2)}
              </p>
            </div>
            <form onSubmit={handleAjustarSaldo} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dirección del ajuste</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDireccionAjuste("sumar")}
                    className={`px-4 py-2 rounded-xl font-medium border transition-colors ${
                      direccionAjuste === "sumar"
                        ? "bg-green-600 border-green-600 text-white"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    + Sumar
                  </button>
                  <button
                    type="button"
                    onClick={() => setDireccionAjuste("restar")}
                    className={`px-4 py-2 rounded-xl font-medium border transition-colors ${
                      direccionAjuste === "restar"
                        ? "bg-red-600 border-red-600 text-white"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    − Restar
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Monto (S/)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={montoAjuste}
                  onChange={(e) => setMontoAjuste(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motivo del ajuste</label>
                <input
                  type="text"
                  value={motivoAjuste}
                  onChange={(e) => setMotivoAjuste(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="Ej. Corrección de saldo inicial"
                  required
                />
              </div>
              {Number(montoAjuste) > 0 && (
                <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-2">
                  Nuevo saldo:{" "}
                  <span className="font-semibold text-gray-900">
                    S/ {(Number(cuentaAjuste.saldo) + (direccionAjuste === "sumar" ? 1 : -1) * Number(montoAjuste)).toFixed(2)}
                  </span>
                </p>
              )}
              <div className="pt-4 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setCuentaAjuste(null)}
                  className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={ajustando}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-medium transition-colors disabled:opacity-50"
                >
                  {ajustando ? "Ajustando..." : "Aplicar ajuste"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
