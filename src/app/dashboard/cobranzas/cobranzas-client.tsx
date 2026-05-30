// src/app/dashboard/cobranzas/cobranzas-client.tsx
// Vista de cobranzas. Aplica "No me hagas pensar":
//   - Filas con colores claros por urgencia (rojo vencida, amarillo urgente, verde holgada).
//   - Botón "Marcar pagada" en cada factura pendiente.
//   - Stats arriba: total pendiente, vencido, pagado este mes.
"use client";

import { useEffect, useState, useMemo } from "react";
import {
  FiDollarSign,
  FiAlertCircle,
  FiClock,
  FiCheckCircle,
  FiRefreshCw,
  FiX,
  FiPlus,
} from "react-icons/fi";

interface Factura {
  id: string;
  pedido_id: string | null;
  cliente_nombre: string;
  monto: string | number;
  plazo_dias: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  fecha_pago: string | null;
  estado: "Pendiente" | "Pagada" | "Vencida";
  numero_comprobante: string | null;
  notas: string | null;
  asesor_name: string | null;
}

interface StatRow {
  estado: string;
  cnt: number;
  total: string | number;
}

function toNum(v: string | number): number {
  return typeof v === "string" ? parseFloat(v) : v;
}

function urgenciaColor(estado: string, vencimiento: string): { bg: string; text: string; label: string } {
  if (estado === "Pagada") return { bg: "bg-gray-50", text: "text-gray-500", label: "Pagada" };
  if (estado === "Vencida") return { bg: "bg-red-50", text: "text-red-700", label: "Vencida" };

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const v = new Date(vencimiento + "T00:00:00");
  const diff = Math.round((v.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  if (diff <= 1) return { bg: "bg-orange-50", text: "text-orange-700", label: diff <= 0 ? "Hoy" : "Vence mañana" };
  if (diff <= 3) return { bg: "bg-yellow-50", text: "text-yellow-700", label: `En ${diff} días` };
  return { bg: "bg-green-50", text: "text-green-700", label: `En ${diff} días` };
}

export default function CobranzasClient({ userRole }: { userRole: string }) {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const url =
        filtroEstado === "all"
          ? "/api/facturas"
          : `/api/facturas?estado=${filtroEstado}`;
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setFacturas(json.data ?? []);
      setStats(json.stats ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroEstado]);

  // Stats agregadas
  const pendientes = useMemo(
    () => stats.find((s) => s.estado === "Pendiente") ?? { cnt: 0, total: 0 },
    [stats]
  );
  const vencidas = useMemo(
    () => stats.find((s) => s.estado === "Vencida") ?? { cnt: 0, total: 0 },
    [stats]
  );
  const pagadas = useMemo(
    () => stats.find((s) => s.estado === "Pagada") ?? { cnt: 0, total: 0 },
    [stats]
  );

  // P1.6 — 1 clic marca pagada (sin modal) + toast "Deshacer" 5 s.
  // Patrón Gmail/Slack para acciones irreversibles-pero-frecuentes:
  //   - Click "Marcar pagada" → actualización optimista de la fila + POST en bg.
  //   - Aparece banner amarillo abajo con "Deshacer" durante 5 s.
  //   - Si el usuario clickea "Deshacer" → DELETE al endpoint + rollback local.
  //   - Si el POST falla → rollback local + mensaje de error.
  // El modal viejo (`modalPago`) se eliminó: la confirmación visual ahora es el
  // propio cambio en la fila + la ventana de 5 s para revertir.
  const [undoPago, setUndoPago] = useState<Factura | null>(null);
  const [revertiendo, setRevertiendo] = useState(false);

  // Timeout para auto-ocultar el toast de undo a los 5 s. Lo guardamos en
  // un ref-via-state para poder cancelarlo si el usuario hace undo antes.
  const [undoTimeoutId, setUndoTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);

  const limpiarUndo = () => {
    if (undoTimeoutId) clearTimeout(undoTimeoutId);
    setUndoTimeoutId(null);
    setUndoPago(null);
  };

  const marcarPagada = async (id: string) => {
    const original = facturas.find((x) => x.id === id);
    if (!original) return;

    // Si ya hay un undo pendiente de otro pago, lo cerramos (commit del anterior).
    if (undoTimeoutId) clearTimeout(undoTimeoutId);

    // Optimismo: actualizamos la fila localmente antes de pegarle al server.
    const hoy = new Date().toISOString().split("T")[0];
    setFacturas((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, estado: "Pagada", fecha_pago: hoy } : f
      )
    );
    setUndoPago(original);

    // Toast de 5 s antes de "comprometer" el cambio en la UI (refrescar stats).
    const t = setTimeout(() => {
      setUndoPago(null);
      setUndoTimeoutId(null);
      // Refrescamos para que las stats (Pagadas / Pendientes) se recalculen.
      fetchData();
    }, 5000);
    setUndoTimeoutId(t);

    // POST en background. Si falla, rollback inmediato + error.
    try {
      const res = await fetch(`/api/facturas/${id}/pago`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "Error al registrar pago");
      }
    } catch (e) {
      clearTimeout(t);
      setUndoTimeoutId(null);
      setUndoPago(null);
      // Rollback: devolvemos la fila a su estado original.
      setFacturas((prev) => prev.map((f) => (f.id === id ? original : f)));
      setMensaje(e instanceof Error ? `❌ ${e.message}` : "❌ Error al registrar pago");
      setTimeout(() => setMensaje(null), 4000);
    }
  };

  const deshacerPago = async () => {
    if (!undoPago) return;
    setRevertiendo(true);
    const original = undoPago;
    // Cerramos el timeout antes de hacer el rollback visual.
    if (undoTimeoutId) clearTimeout(undoTimeoutId);
    setUndoTimeoutId(null);

    try {
      const res = await fetch(`/api/facturas/${original.id}/pago`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "Error al revertir");
      }
      // Rollback local: la fila vuelve al estado previo.
      setFacturas((prev) => prev.map((f) => (f.id === original.id ? original : f)));
      setUndoPago(null);
      setMensaje("↩️ Pago revertido");
      setTimeout(() => setMensaje(null), 2500);
      fetchData();
    } catch (e) {
      setMensaje(e instanceof Error ? `❌ ${e.message}` : "❌ No se pudo revertir");
      setTimeout(() => setMensaje(null), 4000);
    } finally {
      setRevertiendo(false);
    }
  };

  // Modal de cobranza manual — registra una factura sin pedido ni comprobante.
  const [showModalManual, setShowModalManual] = useState(false);
  const [guardandoManual, setGuardandoManual] = useState(false);
  const [errorManual, setErrorManual] = useState<string | null>(null);
  const [manualCliente, setManualCliente] = useState("");
  const [manualMonto, setManualMonto] = useState<number>(0);
  const [manualPlazo, setManualPlazo] = useState<number>(7);
  const [manualNotas, setManualNotas] = useState("");
  // Conexiones nuevas (P0.2): autocomplete contra /api/clientes + selector de
  // facturas ya emitidas del cliente seleccionado. Permiten vincular la cobranza
  // al cliente guardado y al comprobante real (no dato suelto).
  const [manualSugClientes, setManualSugClientes] = useState<
    Array<{ id: string; nombre: string; ruc_dni: string | null }>
  >([]);
  const [manualClienteId, setManualClienteId] = useState<string | null>(null);
  const [manualFacturas, setManualFacturas] = useState<
    Array<{ id: string; serie_numero: string; monto_total: number }>
  >([]);
  const [manualComprobanteId, setManualComprobanteId] = useState<string | null>(null);

  // P0.2 — Autocomplete del cliente: busca contra /api/clientes?q=, con debounce.
  // Solo activo cuando el modal está abierto. Si el texto coincide exacto con una
  // sugerencia, guardamos su id (para enviarlo como cliente_id en el POST).
  useEffect(() => {
    if (!showModalManual) return;
    const q = manualCliente.trim();
    if (q.length < 2) {
      setManualSugClientes([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clientes?q=${encodeURIComponent(q)}&limit=10`);
        if (!res.ok) return;
        const json = await res.json();
        const arr = (json.data ?? json) as Array<{
          id: string;
          nombre: string;
          ruc_dni: string | null;
        }>;
        setManualSugClientes(arr.slice(0, 10));
      } catch {
        /* silencioso */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [manualCliente, showModalManual]);

  // P0.2 — Cuando se elige un cliente con doc, traemos sus facturas/boletas ya
  // emitidas para poder vincular esta cobranza al comprobante correcto.
  useEffect(() => {
    const sel = manualSugClientes.find((s) => s.id === manualClienteId);
    const doc = sel?.ruc_dni?.trim();
    if (!manualClienteId || !doc) {
      setManualFacturas([]);
      setManualComprobanteId(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/comprobantes?tipo=01&cliente_doc_num=${encodeURIComponent(doc)}`
        );
        if (!res.ok) return;
        const json = await res.json();
        const arr = (json.data ?? json) as Array<{
          id: string;
          serie_numero: string;
          monto_total: string | number;
        }>;
        setManualFacturas(
          arr.map((c) => ({
            id: c.id,
            serie_numero: c.serie_numero,
            monto_total: Number(c.monto_total),
          }))
        );
      } catch {
        setManualFacturas([]);
      }
    })();
  }, [manualClienteId, manualSugClientes]);

  const cerrarModalManual = () => {
    if (guardandoManual) return;
    setShowModalManual(false);
    setErrorManual(null);
    setManualCliente("");
    setManualMonto(0);
    setManualPlazo(7);
    setManualNotas("");
    setManualSugClientes([]);
    setManualClienteId(null);
    setManualFacturas([]);
    setManualComprobanteId(null);
  };

  const guardarCobranzaManual = async () => {
    setErrorManual(null);
    if (manualCliente.trim().length < 2) {
      setErrorManual("Ingresá el nombre del cliente.");
      return;
    }
    if (!(manualMonto > 0)) {
      setErrorManual("El monto debe ser mayor a 0.");
      return;
    }
    setGuardandoManual(true);
    try {
      const res = await fetch("/api/facturas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteNombre: manualCliente.trim(),
          monto: Number(manualMonto),
          plazoDias: Number(manualPlazo) || 0,
          notas: manualNotas.trim() || undefined,
          // Vínculos opcionales (P0.2): si el usuario eligió cliente/comprobante
          // de las sugerencias, los enviamos para que la cobranza quede conectada.
          cliente_id: manualClienteId,
          comprobante_id: manualComprobanteId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "No se pudo registrar la cobranza");
      }
      setMensaje("✅ Cobranza registrada");
      cerrarModalManual();
      fetchData();
      setTimeout(() => setMensaje(null), 2500);
    } catch (e) {
      setErrorManual(e instanceof Error ? e.message : "Error al registrar");
    } finally {
      setGuardandoManual(false);
    }
  };

  const puedeRegistrar = userRole === "admin" || userRole === "asesor";

  if (loading) return <div className="p-8 text-center text-gray-500">Cargando…</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      {/* ── Header ── */}
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <FiDollarSign className="text-red-600" />
            Cobranzas
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {userRole === "admin" ? "Todas las facturas del negocio" : "Tus facturas pendientes"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {puedeRegistrar && (
            <button
              onClick={() => setShowModalManual(true)}
              className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-1 font-medium"
            >
              <FiPlus />
              Registrar cobranza manual
            </button>
          )}
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1"
          >
            <FiRefreshCw className={refreshing ? "animate-spin" : ""} />
            Refrescar
          </button>
        </div>
      </header>

      {mensaje && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg">
          {mensaje}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button
            onClick={fetchData}
            className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <StatCard
          label="Por cobrar"
          cant={pendientes.cnt}
          monto={toNum(pendientes.total)}
          color="bg-amber-50 text-amber-700"
          icon={<FiClock />}
        />
        <StatCard
          label="Vencidas"
          cant={vencidas.cnt}
          monto={toNum(vencidas.total)}
          color="bg-red-50 text-red-700"
          icon={<FiAlertCircle />}
        />
        <StatCard
          label="Pagadas"
          cant={pagadas.cnt}
          monto={toNum(pagadas.total)}
          color="bg-green-50 text-green-700"
          icon={<FiCheckCircle />}
        />
      </div>

      {/* ── P3.13 — Aging de cobranzas ── */}
      <AgingPanel userRole={userRole} />

      {/* ── Filtros ── */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {[
          { value: "all", label: "Todas" },
          { value: "Pendiente", label: "Pendientes" },
          { value: "Vencida", label: "Vencidas" },
          { value: "Pagada", label: "Pagadas" },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFiltroEstado(f.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filtroEstado === f.value
                ? "bg-red-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Tabla ── */}
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Cliente</th>
              {userRole === "admin" && <th className="px-3 py-2 text-left">Asesora</th>}
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2 text-center">Emisión</th>
              <th className="px-3 py-2 text-center">Vence</th>
              <th className="px-3 py-2 text-center">Estado</th>
              <th className="px-3 py-2 text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {facturas.length === 0 && (
              <tr>
                <td colSpan={userRole === "admin" ? 7 : 6} className="text-center text-gray-400 py-8">
                  No hay facturas
                </td>
              </tr>
            )}
            {facturas.map((f) => {
              const urg = urgenciaColor(f.estado, f.fecha_vencimiento);
              return (
                <tr key={f.id} className={`border-t ${urg.bg}`}>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {f.cliente_nombre}
                    {f.numero_comprobante && (
                      <div className="text-[10px] text-gray-400">{f.numero_comprobante}</div>
                    )}
                  </td>
                  {userRole === "admin" && (
                    <td className="px-3 py-3 text-gray-600">{f.asesor_name ?? "—"}</td>
                  )}
                  <td className="px-3 py-3 text-right font-mono font-semibold">
                    S/ {toNum(f.monto).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-center text-xs text-gray-500">
                    {f.fecha_emision}
                  </td>
                  <td className="px-3 py-3 text-center text-xs">
                    <div className="font-medium">{f.fecha_vencimiento}</div>
                    <div className={`text-[10px] ${urg.text}`}>{urg.label}</div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${urg.text} bg-white border`}>
                      {f.estado}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {f.estado !== "Pagada" ? (
                      <button
                        onClick={() => marcarPagada(f.id)}
                        className="px-2.5 py-1 bg-green-500 text-white rounded text-xs font-medium hover:bg-green-600"
                      >
                        Marcar pagada
                      </button>
                    ) : (
                      <span className="text-[10px] text-gray-500">
                        Pagada {f.fecha_pago}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* P1.6 — Toast "Deshacer" 5 s (reemplaza el modal de confirmación).
          Sale como pill flotante abajo-centro, no bloquea el resto de la UI. */}
      {undoPago && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-gray-900 text-white rounded-full shadow-2xl flex items-center gap-4 pl-5 pr-2 py-2 max-w-md">
            <FiCheckCircle className="text-green-400 h-5 w-5 shrink-0" />
            <div className="text-sm flex-1">
              <span className="font-medium">Pago registrado</span>
              <span className="text-gray-300 ml-2">
                {undoPago.cliente_nombre} · S/ {toNum(undoPago.monto).toFixed(2)}
              </span>
            </div>
            <button
              onClick={deshacerPago}
              disabled={revertiendo}
              className="px-3 py-1.5 bg-amber-500 text-gray-900 rounded-full text-xs font-bold hover:bg-amber-400 disabled:opacity-50 flex items-center gap-1.5"
            >
              {revertiendo ? (
                <>
                  <FiRefreshCw className="h-3 w-3 animate-spin" />
                  Revirtiendo…
                </>
              ) : (
                <>↩️ Deshacer</>
              )}
            </button>
            <button
              onClick={limpiarUndo}
              aria-label="Cerrar"
              className="text-gray-400 hover:text-white p-1"
            >
              <FiX className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Modal de cobranza manual (sin pedido ni comprobante) */}
      {showModalManual && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={cerrarModalManual}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <FiDollarSign className="text-red-600" />
                Registrar cobranza manual
              </h3>
              <button
                onClick={cerrarModalManual}
                disabled={guardandoManual}
                aria-label="Cerrar"
                className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                  Cliente
                </label>
                <input
                  value={manualCliente}
                  list="cobranza-manual-clientes"
                  onChange={(e) => {
                    setManualCliente(e.target.value);
                    // Si el texto coincide exacto con una sugerencia, guardamos su id;
                    // si no, queda como texto libre (cliente_id = null).
                    const match = manualSugClientes.find(
                      (s) =>
                        s.nombre.trim().toLowerCase() ===
                        e.target.value.trim().toLowerCase()
                    );
                    setManualClienteId(match?.id ?? null);
                  }}
                  placeholder="Buscá un cliente guardado o escribí uno nuevo"
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
                <datalist id="cobranza-manual-clientes">
                  {manualSugClientes.map((s) => (
                    <option key={s.id} value={s.nombre}>
                      {s.ruc_dni ? `${s.ruc_dni} · ` : ""}
                      {s.nombre}
                    </option>
                  ))}
                </datalist>
                {manualClienteId && (
                  <p className="text-[11px] text-green-700 mt-1">
                    ✓ Cliente guardado seleccionado (se vincula a su perfil)
                  </p>
                )}
              </div>
              {/* Selector opcional: factura ya emitida a este cliente que esta
                  cobranza viene a cubrir. Si se elige, autopobla el monto. */}
              {manualFacturas.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                    Factura existente <span className="text-gray-400 normal-case">(opcional)</span>
                  </label>
                  <select
                    value={manualComprobanteId ?? ""}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      setManualComprobanteId(id);
                      const f = manualFacturas.find((x) => x.id === id);
                      if (f) setManualMonto(f.monto_total);
                    }}
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  >
                    <option value="">— Cobranza sin vincular —</option>
                    {manualFacturas.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.serie_numero} · S/ {f.monto_total.toFixed(2)}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Si elegís una factura, vinculamos la cobranza y autollenamos el monto.
                  </p>
                </div>
              )}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                    Monto (S/)
                  </label>
                  <input
                    type="number"
                    value={manualMonto || ""}
                    min={0}
                    step="0.01"
                    onChange={(e) => setManualMonto(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                </div>
                <div className="w-28">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                    Plazo (días)
                  </label>
                  <input
                    type="number"
                    value={manualPlazo}
                    min={0}
                    max={120}
                    step={1}
                    onChange={(e) => setManualPlazo(parseInt(e.target.value) || 0)}
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">
                  Notas (opcional)
                </label>
                <textarea
                  value={manualNotas}
                  onChange={(e) => setManualNotas(e.target.value)}
                  rows={2}
                  placeholder="Detalle de la venta, referencia, etc."
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
              {errorManual && (
                <p className="text-sm text-red-600">{errorManual}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={cerrarModalManual}
                  disabled={guardandoManual}
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={guardarCobranzaManual}
                  disabled={guardandoManual}
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {guardandoManual ? (
                    <>
                      <FiRefreshCw className="h-4 w-4 animate-spin" />
                      Guardando…
                    </>
                  ) : (
                    <>
                      <FiPlus className="h-4 w-4" />
                      Registrar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  cant,
  monto,
  color,
  icon,
}: {
  label: string;
  cant: number;
  monto: number;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl p-4 ${color}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs uppercase tracking-wide opacity-75">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold">{cant}</span>
        <span className="text-sm opacity-75">facturas</span>
      </div>
      <div className="text-sm font-semibold mt-1">
        S/ {monto.toFixed(2)}
      </div>
    </div>
  );
}

// P3.13 — Panel "aging" de cobranzas (colapsable). Pide /api/cobranzas/aging
// solo cuando se expande para no encarecer la carga inicial. Muestra los 4
// buckets clásicos + top 5 morosos.
interface AgingBucket {
  label: string;
  cnt: number;
  total: number;
}
interface AgingMoroso {
  cliente_nombre: string;
  cnt: number;
  total: number;
  max_dias: number;
}

function AgingPanel({ userRole }: { userRole: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [buckets, setBuckets] = useState<AgingBucket[]>([]);
  const [morosos, setMorosos] = useState<AgingMoroso[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/cobranzas/aging");
        if (!res.ok) return;
        const json = await res.json();
        setBuckets(json.buckets ?? []);
        setMorosos(json.topMorosos ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  // Color por bucket — sigue la convención de cobranzas (gris→ámbar→rojo).
  const colorPorBucket = (label: string) => {
    if (label.includes("Por vencer")) return "bg-blue-50 text-blue-700 border-blue-200";
    if (label.startsWith("0–30")) return "bg-amber-50 text-amber-700 border-amber-200";
    if (label.startsWith("31–60")) return "bg-orange-50 text-orange-700 border-orange-200";
    if (label.startsWith("61–90")) return "bg-red-50 text-red-700 border-red-200";
    return "bg-red-100 text-red-800 border-red-300";
  };

  return (
    <div className="mb-6 bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 text-left"
      >
        <div className="flex items-center gap-2">
          <FiClock className="text-gray-500" />
          <span className="font-semibold text-gray-800">Aging de cobranzas</span>
          <span className="text-xs text-gray-500">
            (deuda por antigüedad{userRole === "asesor" ? " — tuya" : ""})
          </span>
        </div>
        <span className="text-xs text-gray-400">{open ? "Ocultar" : "Mostrar"}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-4">Cargando…</div>
          ) : (
            <>
              {/* Buckets */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {buckets.map((b) => (
                  <div
                    key={b.label}
                    className={`rounded-lg border p-3 ${colorPorBucket(b.label)}`}
                  >
                    <div className="text-[10px] uppercase tracking-wide opacity-75 mb-1">
                      {b.label}
                    </div>
                    <div className="text-lg font-bold">S/ {b.total.toFixed(2)}</div>
                    <div className="text-[11px] opacity-80">
                      {b.cnt} factura{b.cnt === 1 ? "" : "s"}
                    </div>
                  </div>
                ))}
              </div>

              {/* Top morosos */}
              {morosos.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
                    Top 5 con más deuda vencida
                  </div>
                  <div className="space-y-1.5">
                    {morosos.map((m) => (
                      <div
                        key={m.cliente_nombre}
                        className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg text-sm"
                      >
                        <div className="flex-1 min-w-0 truncate font-medium text-gray-800">
                          {m.cliente_nombre}
                        </div>
                        <div className="text-xs text-gray-500 whitespace-nowrap">
                          {m.cnt} factura{m.cnt === 1 ? "" : "s"} · máx {m.max_dias}d
                        </div>
                        <div className="font-mono font-semibold text-red-700 whitespace-nowrap">
                          S/ {m.total.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
