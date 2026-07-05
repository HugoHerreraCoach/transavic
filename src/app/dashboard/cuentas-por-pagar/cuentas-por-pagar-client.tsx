"use client";

import { useState, useEffect, useMemo } from "react";
import { 
  FiFileText, 
  FiPlus, 
  FiDollarSign, 
  FiCheckCircle, 
  FiClock, 
  FiAlertCircle, 
  FiTrendingUp, 
  FiSearch, 
  FiFilter,
  FiX
} from "react-icons/fi";
import Link from "next/link";
import SearchableSelect from "@/components/SearchableSelect";
import GuiaModulo from "@/components/GuiaModulo";

type Deuda = {
  id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  proveedor_ruc: string;
  compra_id: string | null;
  compra_nro_doc: string | null;
  compra_tipo_doc: string | null;
  monto_deuda: number;
  monto_pagado: number;
  estado: "Pendiente" | "Parcial" | "Pagado";
  fecha_vencimiento: string;
  created_at: string;
};

type CuentaBancaria = {
  id: string;
  nombre: string;
  tipo: string;
  saldo: number;
};

export default function CuentasPorPagarClient() {
  const [deudas, setDeudas] = useState<Deuda[]>([]);
  const [cuentas, setCuentas] = useState<CuentaBancaria[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtros
  const [filtroProveedorId, setFiltroProveedorId] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");

  // Modal Pago
  const [selectedDeuda, setSelectedDeuda] = useState<Deuda | null>(null);
  const [montoPago, setMontoPago] = useState("");
  const [cuentaBancariaId, setCuentaBancariaId] = useState("");
  const [fechaPago, setFechaPago] = useState(() => new Date().toISOString().split("T")[0]);
  const [notas, setNotas] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [errorPago, setErrorPago] = useState<string | null>(null);

  // Alertas
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchDeudas();
    fetchCuentas();
  }, []);

  const fetchDeudas = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cuentas-por-pagar");
      if (!res.ok) throw new Error("Error cargando deudas");
      const data = await res.json();
      setDeudas(data.deudas || []);
    } catch (err) {
      console.error(err);
      setErrorMsg("No se pudieron cargar las cuentas por pagar.");
    } finally {
      setLoading(false);
    }
  };

  const fetchCuentas = async () => {
    try {
      const res = await fetch("/api/cuentas");
      if (!res.ok) throw new Error("Error cargando cuentas");
      const data = await res.json();
      setCuentas(data || []);
      if (data && data.length > 0) {
        setCuentaBancariaId(data[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Proveedores únicos para el filtro
  const proveedoresUnicos = useMemo(() => {
    const map = new Map<string, string>();
    deudas.forEach(d => {
      map.set(d.proveedor_id, d.proveedor_nombre);
    });
    return Array.from(map.entries()).map(([id, nombre]) => ({ id, nombre }));
  }, [deudas]);

  // KPIs
  const kpis = useMemo(() => {
    let pendiente = 0;
    let vencida = 0;
    let pagado = 0;
    const hoyStr = new Date().toISOString().split("T")[0];

    deudas.forEach(d => {
      const saldoRestante = d.monto_deuda - d.monto_pagado;
      pagado += d.monto_pagado;
      if (d.estado !== "Pagado") {
        pendiente += saldoRestante;
        if (d.fecha_vencimiento < hoyStr) {
          vencida += saldoRestante;
        }
      }
    });

    return { pendiente, vencida, pagado };
  }, [deudas]);

  // Filtrado de deudas
  const deudasFiltradas = useMemo(() => {
    return deudas.filter(d => {
      const matchProv = filtroProveedorId ? d.proveedor_id === filtroProveedorId : true;
      let matchEst = true;
      if (filtroEstado === "pendiente") matchEst = d.estado === "Pendiente";
      else if (filtroEstado === "parcial") matchEst = d.estado === "Parcial";
      else if (filtroEstado === "pagado") matchEst = d.estado === "Pagado";
      else if (filtroEstado === "vencido") {
        const hoyStr = new Date().toISOString().split("T")[0];
        matchEst = d.estado !== "Pagado" && d.fecha_vencimiento < hoyStr;
      }
      return matchProv && matchEst;
    });
  }, [deudas, filtroProveedorId, filtroEstado]);

  const handleOpenPago = (deuda: Deuda) => {
    setSelectedDeuda(deuda);
    const restante = deuda.monto_deuda - deuda.monto_pagado;
    setMontoPago(restante.toFixed(2));
    setNotas("");
    setErrorPago(null);
    setFechaPago(new Date().toISOString().split("T")[0]);
    if (cuentas.length > 0) {
      setCuentaBancariaId(cuentas[0].id);
    }
  };

  const handleClosePago = () => {
    setSelectedDeuda(null);
    setErrorPago(null);
  };

  const handleRegistrarPago = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeuda) return;

    const montoVal = Number(montoPago);
    const restante = selectedDeuda.monto_deuda - selectedDeuda.monto_pagado;
    const cuentaSel = cuentas.find(c => c.id === cuentaBancariaId);

    if (isNaN(montoVal) || montoVal <= 0) {
      alert("El monto de pago debe ser positivo.");
      return;
    }
    if (montoVal > restante + 0.01) {
      alert("El monto a pagar excede el saldo pendiente.");
      return;
    }
    if (cuentaSel && cuentaSel.saldo < montoVal) {
      alert(`Fondos insuficientes en la cuenta "${cuentaSel.nombre}".`);
      return;
    }

    setActionLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    setErrorPago(null);

    try {
      const res = await fetch("/api/cuentas-por-pagar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cuentaPagarId: selectedDeuda.id,
          cuentaBancariaId,
          montoPago: montoVal,
          fechaPago,
          notas: notas || null
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al procesar pago");

      setSuccessMsg("¡Pago registrado exitosamente!");
      handleClosePago();
      fetchDeudas();
      fetchCuentas();
    } catch (err: unknown) {
      console.error(err);
      // El modal sigue abierto: el error se muestra DENTRO del modal, no en el banner de la página.
      setErrorPago(err instanceof Error ? err.message : "Error al registrar el pago.");
    } finally {
      setActionLoading(false);
    }
  };

  // Formateador de moneda
  const formatSoles = (val: number) => {
    return `S/ ${val.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const selectedCuentaDetails = useMemo(() => {
    return cuentas.find(c => c.id === cuentaBancariaId);
  }, [cuentas, cuentaBancariaId]);

  return (
    <div className="space-y-6">
      {/* Alertas */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="text-xs font-semibold flex items-center gap-2">
            <FiCheckCircle size={16} /> {successMsg}
          </span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700 cursor-pointer">
            <FiX size={16} />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="text-xs font-semibold flex items-center gap-2">
            <FiAlertCircle size={16} /> {errorMsg}
          </span>
          <button onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-700 cursor-pointer">
            <FiX size={16} />
          </button>
        </div>
      )}

      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FiFileText className="text-red-500" /> Cuentas por Pagar
          </h1>
          <p className="text-xs text-gray-500 mt-1">Control de facturas de proveedores y pagos parciales.</p>
        </div>
      </div>

      <GuiaModulo modulo="cuentas-por-pagar" />

      {/* Tarjetas KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI Deuda Pendiente */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Deuda Pendiente</span>
            <span className="text-xl font-black text-gray-800 mt-1 block">
              {formatSoles(kpis.pendiente)}
            </span>
          </div>
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <FiClock size={20} />
          </div>
        </div>

        {/* KPI Deudas Vencidas */}
        <div className={`bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between transition-all ${kpis.vencida > 0 ? "ring-2 ring-red-500/20" : ""}`}>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Deuda Vencida</span>
            <span className={`text-xl font-black mt-1 block ${kpis.vencida > 0 ? "text-red-600 animate-pulse" : "text-gray-800"}`}>
              {formatSoles(kpis.vencida)}
            </span>
          </div>
          <div className={`p-3 rounded-xl ${kpis.vencida > 0 ? "bg-red-100 text-red-700" : "bg-gray-50 text-gray-400"}`}>
            <FiAlertCircle size={20} />
          </div>
        </div>

        {/* KPI Total Amortizado */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Total Pagado</span>
            <span className="text-xl font-black text-emerald-600 mt-1 block">
              {formatSoles(kpis.pagado)}
            </span>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <FiCheckCircle size={20} />
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
            <FiSearch size={12} /> Buscar Proveedor
          </label>
          <SearchableSelect
            options={proveedoresUnicos}
            value={filtroProveedorId}
            onChange={setFiltroProveedorId}
            placeholder="Todos los proveedores"
            className="w-full"
          />
        </div>
        <div className="w-full md:w-48">
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
            <FiFilter size={12} /> Estado de Deuda
          </label>
          <select
            value={filtroEstado}
            onChange={e => setFiltroEstado(e.target.value)}
            className="block w-full rounded-xl border border-gray-300 py-2.5 px-3 bg-gray-50 text-xs text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 cursor-pointer"
          >
            <option value="todos">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Pago parcial</option>
            <option value="pagado">Pagada</option>
            <option value="vencido">Vencida (Expirada)</option>
          </select>
        </div>
        {(filtroProveedorId || filtroEstado !== "todos") && (
          <button
            onClick={() => {
              setFiltroProveedorId("");
              setFiltroEstado("todos");
            }}
            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition-all cursor-pointer active:scale-95 whitespace-nowrap self-stretch md:self-auto flex items-center justify-center gap-1"
          >
            <FiX size={14} /> Limpiar Filtros
          </button>
        )}
      </div>

      {/* Tabla de Deudas */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center py-20 text-gray-400 animate-pulse">Cargando cuentas por pagar...</div>
        ) : deudasFiltradas.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-500">
              <FiFileText size={32} />
            </div>
            <h3 className="font-bold text-gray-800 text-base">No hay deudas</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">No se encontraron cuentas por pagar con los filtros seleccionados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                  <th className="py-4 px-6">Proveedor</th>
                  <th className="py-4 px-4">Comprobante de Compra</th>
                  <th className="py-4 px-4 text-right">Monto Deuda</th>
                  <th className="py-4 px-4 text-right">Monto Pagado</th>
                  <th className="py-4 px-4 text-right">Saldo Restante</th>
                  <th className="py-4 px-4">Vencimiento</th>
                  <th className="py-4 px-4">Estado</th>
                  <th className="py-4 px-6 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {deudasFiltradas.map(d => {
                  const restante = d.monto_deuda - d.monto_pagado;
                  const hoyStr = new Date().toISOString().split("T")[0];
                  const isVencido = d.estado !== "Pagado" && d.fecha_vencimiento < hoyStr;

                  return (
                    <tr key={d.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 px-6 font-medium text-gray-900">
                        <div>{d.proveedor_nombre}</div>
                        <div className="text-[10px] text-gray-400 font-mono mt-0.5">{d.proveedor_ruc}</div>
                      </td>
                      <td className="py-4 px-4 text-gray-600">
                        {d.compra_nro_doc ? (
                          <div>
                            <span className="font-semibold text-gray-700">{d.compra_tipo_doc}</span>
                            <span className="text-[10px] text-gray-400 block mt-0.5">{d.compra_nro_doc}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">Carga Manual / Sin Doc</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right text-gray-900 font-medium">
                        {formatSoles(d.monto_deuda)}
                      </td>
                      <td className="py-4 px-4 text-right text-emerald-600 font-medium">
                        {formatSoles(d.monto_pagado)}
                      </td>
                      <td className="py-4 px-4 text-right text-gray-900 font-extrabold text-sm">
                        {formatSoles(restante)}
                      </td>
                      <td className="py-4 px-4">
                        <span className={`font-semibold ${isVencido ? "text-red-600" : "text-gray-700"}`}>
                          {new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(d.fecha_vencimiento))}
                        </span>
                        {isVencido && (
                          <span className="block text-[9px] text-red-500 font-bold mt-0.5 uppercase tracking-wide">Vencido</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        {d.estado === "Pagado" ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center gap-1 w-max">
                            <FiCheckCircle size={10} /> Pagada
                          </span>
                        ) : d.estado === "Parcial" ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-100 flex items-center gap-1 w-max">
                            <FiClock size={10} /> Pago parcial
                          </span>
                        ) : (
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold flex items-center gap-1 w-max ${
                            isVencido 
                              ? "bg-red-50 text-red-700 border border-red-100" 
                              : "bg-gray-100 text-gray-700"
                          }`}>
                            <FiAlertCircle size={10} /> Pendiente
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-right">
                        {d.estado !== "Pagado" ? (
                          <button
                            onClick={() => handleOpenPago(d)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-bold text-[10px] transition-all cursor-pointer active:scale-95 shadow-sm inline-flex items-center gap-1"
                          >
                            <FiDollarSign size={12} /> Registrar Pago
                          </button>
                        ) : (
                          <span className="text-gray-400 text-[10px] font-semibold italic">Completo</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Registrar Pago */}
      {selectedDeuda && (
        <div className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-gray-50 p-6 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <FiDollarSign className="text-emerald-500" /> Registrar Pago de Deuda
              </h2>
              <button 
                onClick={handleClosePago} 
                className="text-gray-400 hover:text-gray-600 p-2 cursor-pointer rounded-lg hover:bg-gray-100 transition-all"
              >
                <FiX size={18} />
              </button>
            </div>

            <form onSubmit={handleRegistrarPago} className="p-6 space-y-4">
              {/* Información Proveedor */}
              <div className="bg-indigo-50/50 border border-indigo-100/50 p-4 rounded-2xl text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-500">Proveedor:</span>
                  <span className="font-bold text-indigo-950">{selectedDeuda.proveedor_nombre}</span>
                </div>
                {selectedDeuda.compra_nro_doc && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Documento:</span>
                    <span className="font-mono text-gray-700 font-semibold">{selectedDeuda.compra_tipo_doc} {selectedDeuda.compra_nro_doc}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-indigo-100/50 pt-1.5 mt-1.5 text-sm">
                  <span className="text-gray-600 font-semibold">Pendiente de Pago:</span>
                  <span className="font-extrabold text-indigo-700">
                    {formatSoles(selectedDeuda.monto_deuda - selectedDeuda.monto_pagado)}
                  </span>
                </div>
              </div>

              {/* Cuenta Bancaria Origen */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Cuenta Origen de Fondos</label>
                <select
                  required
                  value={cuentaBancariaId}
                  onChange={e => setCuentaBancariaId(e.target.value)}
                  className="block w-full rounded-xl border border-gray-300 py-2.5 px-3 bg-gray-50 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 cursor-pointer font-medium"
                >
                  {cuentas.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} (Saldo: {formatSoles(c.saldo)})
                    </option>
                  ))}
                </select>
                {selectedCuentaDetails && (
                  <span className="block text-[10px] text-gray-400 mt-1">
                    El saldo de esta cuenta se reducirá automáticamente al confirmar el pago.
                  </span>
                )}
                {cuentas.length === 0 && (
                  <span className="block text-[10px] text-red-600 font-semibold mt-1">
                    No hay cuentas disponibles. Primero crea una cuenta en el módulo{" "}
                    <Link href="/dashboard/cuentas" className="underline hover:text-red-700">Cuentas</Link>.
                  </span>
                )}
              </div>

              {/* Monto del Pago */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Monto del Pago (S/)</label>
                <div className="relative rounded-xl shadow-sm">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <span className="text-gray-500 text-xs">S/</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={montoPago}
                    onChange={e => setMontoPago(e.target.value)}
                    placeholder="0.00"
                    className="block w-full rounded-xl border border-gray-300 pl-8 pr-3 py-2.5 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-gray-50 font-bold"
                  />
                </div>
              </div>

              {/* Fecha Pago */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Fecha de Pago</label>
                <input
                  type="date"
                  required
                  value={fechaPago}
                  onChange={e => setFechaPago(e.target.value)}
                  className="block w-full rounded-xl border border-gray-300 py-2.5 px-3 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-gray-50 font-medium"
                />
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Notas / Referencia Operativa</label>
                <input
                  type="text"
                  value={notas}
                  onChange={e => setNotas(e.target.value)}
                  placeholder="Ej: Pago con transferencia nro. operacion..."
                  className="block w-full rounded-xl border border-gray-300 py-2.5 px-3 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-gray-50"
                />
              </div>

              {/* Error del pago (dentro del modal, visible sobre los botones) */}
              {errorPago && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-xl flex items-center gap-2 text-xs font-semibold">
                  <FiAlertCircle size={14} className="shrink-0" /> {errorPago}
                </div>
              )}

              {/* Botones de acción */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={handleClosePago}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all cursor-pointer active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || cuentas.length === 0}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer active:scale-95 flex items-center gap-1.5"
                >
                  {actionLoading ? "Registrando..." : "Registrar Pago"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
