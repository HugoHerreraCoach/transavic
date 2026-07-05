"use client";

import { useEffect, useState } from "react";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";

type MermaRecord = {
  id: string;
  fecha: string;
  peso_bruto: number;
  peso_limpio: number;
  peso_menudencia: number;
  merma: number;
  porcentaje_merma: number;
  registrado_por: string;
};

// Compra tal como llega de GET /api/compras (solo los campos que usamos)
type CompraApi = {
  id: string;
  fecha: string;
  proveedor_nombre: string;
  items?: { peso_neto: number }[];
};

type CargaDelDia = {
  id: string;
  proveedor_nombre: string;
  kg: number;
};

// Fecha de HOY en horario local (la planta opera en Lima)
function fechaHoyLocal(): string {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

export default function MermasClient() {
  const [pesoBruto, setPesoBruto] = useState<string>("");
  const [pesoLimpio, setPesoLimpio] = useState<string>("");
  const [pesoMenudencia, setPesoMenudencia] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [historial, setHistorial] = useState<MermaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [cargasHoy, setCargasHoy] = useState<CargaDelDia[]>([]);
  const [compraId, setCompraId] = useState<string>("");
  const { mostrarToast, toasts } = useToast();

  const fetchHistorial = async () => {
    try {
      const res = await fetch("/api/mermas");
      if (res.ok) {
        setHistorial(await res.json());
      }
    } catch {
      mostrarToast("Error al cargar el historial", "error");
    } finally {
      setLoading(false);
    }
  };

  // Cargas (compras) registradas HOY, para vincular la merma a su lote
  const fetchCargasDeHoy = async () => {
    try {
      const res = await fetch("/api/compras");
      if (!res.ok) return;
      const data: CompraApi[] = await res.json();
      const hoy = fechaHoyLocal();
      setCargasHoy(
        data
          .filter((c) => String(c.fecha).slice(0, 10) === hoy)
          .map((c) => ({
            id: c.id,
            proveedor_nombre: c.proveedor_nombre,
            kg: (c.items || []).reduce((acc, it) => acc + Number(it.peso_neto || 0), 0),
          }))
      );
    } catch {
      // Silencioso: el selector de carga es opcional
    }
  };

  useEffect(() => {
    fetchHistorial();
    fetchCargasDeHoy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bruto = Number(pesoBruto) || 0;
  const limpio = Number(pesoLimpio) || 0;
  const menudencia = Number(pesoMenudencia) || 0;

  const mermaKg = bruto - (limpio + menudencia);
  const mermaPorcentaje = bruto > 0 ? ((mermaKg / bruto) * 100).toFixed(2) : "0.00";
  const sumaExcede = limpio + menudencia > bruto && limpio + menudencia > 0;

  // Al elegir una carga del día, precargar el peso bruto con sus kg (editable)
  const handleSeleccionCarga = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setCompraId(id);
    if (id) {
      const carga = cargasHoy.find((c) => c.id === id);
      if (carga && carga.kg > 0) setPesoBruto(carga.kg.toFixed(2));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bruto <= 0) {
      mostrarToast("El peso bruto debe ser mayor a 0", "error");
      return;
    }
    if (mermaKg < 0) {
      mostrarToast("La suma de limpio y menudencia no puede superar al bruto", "error");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/mermas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peso_bruto: bruto,
          peso_limpio: limpio,
          peso_menudencia: menudencia,
          compra_id: compraId || null,
        }),
      });
      if (res.ok) {
        mostrarToast("Registro de merma guardado", "exito");
        setPesoBruto("");
        setPesoLimpio("");
        setPesoMenudencia("");
        setCompraId("");
        fetchHistorial();
      } else {
        const error = await res.json();
        mostrarToast(error.error || "Error al guardar", "error");
      }
    } catch {
      mostrarToast("Error de red", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <ToastContainer toasts={toasts} />

      <GuiaModulo modulo="mermas" />

      {/* Calculadora Box */}
      <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100 max-w-2xl">
        <h2 className="text-xl font-bold text-gray-800 mb-6">Nuevo Cálculo</h2>
        <form onSubmit={handleSave} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Carga del día (opcional)</label>
            <select
              value={compraId}
              onChange={handleSeleccionCarga}
              className="w-full text-sm border border-gray-300 rounded-2xl px-4 py-3 bg-white focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
            >
              <option value="">— Sin vincular —</option>
              {cargasHoy.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.proveedor_nombre} · {c.kg.toFixed(2)} kg
                </option>
              ))}
            </select>
            {cargasHoy.length === 0 && (
              <p className="text-xs text-gray-400 mt-1.5">No hay cargas registradas hoy.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Peso Bruto (Jaba)</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  value={pesoBruto}
                  onChange={(e) => setPesoBruto(e.target.value)}
                  className="w-full text-lg border border-gray-300 rounded-2xl pl-4 pr-12 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="0.00"
                  required
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">kg</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Pollo Limpio</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  value={pesoLimpio}
                  onChange={(e) => setPesoLimpio(e.target.value)}
                  className="w-full text-lg border border-gray-300 rounded-2xl pl-4 pr-12 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="0.00"
                  required
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">kg</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Menudencia</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  value={pesoMenudencia}
                  onChange={(e) => setPesoMenudencia(e.target.value)}
                  className="w-full text-lg border border-gray-300 rounded-2xl pl-4 pr-12 py-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="0.00"
                  required
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">kg</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-2xl p-6 flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm font-medium">Merma Total Calculada</p>
              <div className="flex items-end space-x-3 mt-1">
                <span className={`text-3xl font-bold ${sumaExcede || mermaKg > (bruto * 0.1) ? 'text-red-600' : 'text-indigo-600'}`}>
                  {mermaKg.toFixed(2)} kg
                </span>
                <span className="text-lg text-gray-500 font-medium mb-1">
                  ({mermaPorcentaje}%)
                </span>
              </div>
              {sumaExcede && (
                <p className="text-sm font-semibold text-red-600 mt-1">La suma supera el bruto</p>
              )}
            </div>
            <button
              type="submit"
              disabled={saving || bruto <= 0 || mermaKg < 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-2xl font-semibold shadow-sm transition-colors disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar Registro"}
            </button>
          </div>
        </form>
      </div>

      {/* Historial */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-4">Historial Reciente</h3>
        {loading ? (
          <p className="text-gray-500">Cargando...</p>
        ) : (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Fecha</th>
                    <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Bruto</th>
                    <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Limpio</th>
                    <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Menudencia</th>
                    <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Merma</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {historial.map((h) => (
                    <tr key={h.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(h.fecha).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{h.peso_bruto} kg</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{h.peso_limpio} kg</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{h.peso_menudencia} kg</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-red-600">
                        {h.merma} kg ({h.porcentaje_merma}%)
                      </td>
                    </tr>
                  ))}
                  {historial.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500">No hay mermas registradas</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
