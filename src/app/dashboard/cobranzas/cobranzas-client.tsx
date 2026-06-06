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
  FiEdit2,
  FiCamera,
  FiEye,
  FiCornerUpLeft,
  FiSlash,
  FiTrash2,
  FiChevronDown,
  FiSearch,
} from "react-icons/fi";
import imageCompression from "browser-image-compression";

interface Factura {
  id: string;
  pedido_id: string | null;
  cliente_nombre: string;
  monto: string | number;
  plazo_dias: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  fecha_pago: string | null;
  estado: "Pendiente" | "Pagada" | "Vencida" | "Anulada";
  numero_comprobante: string | null;
  notas: string | null;
  asesor_name: string | null;
  // M4 — Datos del pago
  metodo_pago?: string | null;
  pago_detalle?: string | null;
  imagenes_ids: string[];  // UUIDs de capturas en pago_imagenes (vacío si no hay)
  // Anulación (soft): rastro de quién la anuló y por qué.
  anulada_por?: string | null;
  anulada_motivo?: string | null;
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
  if (estado === "Anulada") return { bg: "bg-gray-50", text: "text-gray-400", label: "Anulada" };
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
  const [busqueda, setBusqueda] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Edición de la fecha de vencimiento (clic en "Vence" de una cobranza pendiente).
  const [editandoVenc, setEditandoVenc] = useState<string | null>(null);
  const [guardandoVenc, setGuardandoVenc] = useState<string | null>(null);

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

  const facturasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return facturas;
    return facturas.filter((f) =>
      (f.cliente_nombre ?? "").toLowerCase().includes(q) ||
      (f.numero_comprobante ?? "").toLowerCase().includes(q) ||
      (f.asesor_name ?? "").toLowerCase().includes(q)
    );
  }, [facturas, busqueda]);

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

  // M4 — Modal "Registrar / Editar pago": método + nota + nro operación + capturas.
  const [modalPago, setModalPago] = useState<Factura | null>(null);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [pagoMetodo, setPagoMetodo] = useState<string>("efectivo");
  const [pagoNota, setPagoNota] = useState("");       // notas generales
  const [pagoNumOp, setPagoNumOp] = useState("");     // número de operación (pago_detalle)
  const [pagoImagenes, setPagoImagenes] = useState<Array<{base64: string; mime: string; preview: string}>>([]);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [revirtiendoId, setRevirtiendoId] = useState<string | null>(null);
  const [confirmandoRevertir, setConfirmandoRevertir] = useState<string | null>(null);
  const [confirmandoEliminarImg, setConfirmandoEliminarImg] = useState<string | null>(null);
  const [expandiendoCapturas, setExpandiendoCapturas] = useState<string | null>(null);

  const limpiarUndo = () => {
    if (undoTimeoutId) clearTimeout(undoTimeoutId);
    setUndoTimeoutId(null);
    setUndoPago(null);
  };

  // M4 — Abre el modal para REGISTRAR el pago (campos en blanco).
  const abrirModalPago = (f: Factura) => {
    setModoEdicion(false);
    setPagoMetodo("efectivo");
    setPagoNota("");
    setPagoNumOp("");
    setPagoImagenes([]);
    setModalPago(f);
  };

  // M4 — Abre el modal para EDITAR un pago ya registrado (rellena con datos actuales).
  const abrirEditarPago = (f: Factura) => {
    setModoEdicion(true);
    setPagoMetodo(f.metodo_pago || "efectivo");
    setPagoNota(f.notas || "");
    setPagoNumOp(f.pago_detalle || "");
    setPagoImagenes([]);  // solo se agregan nuevas; las existentes siguen en DB
    setModalPago(f);
  };

  // Comprime cada captura a webp ~60-90KB y la agrega al array (máx 10).
  const onSelectImagePago = async (file: File | null) => {
    if (!file) return;
    if (pagoImagenes.length >= 10) return;
    setComprimiendo(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.09,
        maxWidthOrHeight: 1280,
        useWebWorker: true,
        fileType: "image/webp",
        initialQuality: 0.7,
      });
      const dataUrl = await imageCompression.getDataUrlFromFile(compressed);
      const comma = dataUrl.indexOf(",");
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const mime = compressed.type || "image/webp";
      setPagoImagenes((prev) => [...prev, { base64, mime, preview: dataUrl }]);
    } catch (e) {
      setMensaje(e instanceof Error ? `❌ ${e.message}` : "❌ No se pudo procesar la imagen");
      setTimeout(() => setMensaje(null), 4000);
    } finally {
      setComprimiendo(false);
    }
  };

  // Quita una imagen del array por índice (antes de confirmar).
  const quitarImagenPago = (idx: number) => {
    setPagoImagenes((prev) => prev.filter((_, i) => i !== idx));
  };

  // Elimina una captura ya guardada en DB (post-pago confirmado).
  const eliminarImagenPago = async (facturaId: string, imgId: string) => {
    try {
      const res = await fetch(`/api/pago-imagenes/${imgId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se pudo eliminar");
      setFacturas((prev) =>
        prev.map((f) =>
          f.id === facturaId
            ? { ...f, imagenes_ids: f.imagenes_ids.filter((id) => id !== imgId) }
            : f
        )
      );
    } catch {
      setMensaje("❌ No se pudo eliminar la captura");
      setTimeout(() => setMensaje(null), 4000);
    }
  };

  // Confirma el pago desde el modal: optimista + POST con método/nota/captura +
  // toast "Deshacer" 5 s (mismo patrón de siempre).
  // En modo edición: no muestra undo (el pago ya estaba marcado), solo recarga.
  const confirmarPago = async () => {
    const original = modalPago;
    if (!original) return;
    const id = original.id;
    const metodo = pagoMetodo;
    const nota = pagoNota.trim();
    const numOp = pagoNumOp.trim();
    const imgs = pagoImagenes;
    const esEdicion = modoEdicion;

    if (undoTimeoutId) clearTimeout(undoTimeoutId);
    setModalPago(null);

    const hoy = new Date().toISOString().split("T")[0];
    let undoTimer: ReturnType<typeof setTimeout> | null = null;

    if (!esEdicion) {
      // Solo modo registro nuevo usa el optimistic update + undo.
      setFacturas((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, estado: "Pagada", fecha_pago: hoy, metodo_pago: metodo, imagenes_ids: imgs.map((_, i) => `__pending_${i}`) }
            : f
        )
      );
      setUndoPago(original);
      undoTimer = setTimeout(() => {
        setUndoPago(null);
        setUndoTimeoutId(null);
        fetchData();
      }, 5000);
      setUndoTimeoutId(undoTimer);
    }

    try {
      const res = await fetch(`/api/facturas/${id}/pago`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metodo_pago: metodo,
          notas: nota || undefined,
          pago_detalle: numOp || undefined,
          imagenes: imgs.length > 0
            ? imgs.map((i) => ({ base64: i.base64, mime: i.mime }))
            : undefined,
          appendImagenes: esEdicion ? true : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "Error al registrar pago");
      }
      if (esEdicion) {
        setMensaje("✅ Pago actualizado");
        setTimeout(() => setMensaje(null), 3000);
        fetchData();
      }
    } catch (e) {
      if (!esEdicion) {
        if (undoTimer) clearTimeout(undoTimer);
        setUndoTimeoutId(null);
        setUndoPago(null);
        setFacturas((prev) => prev.map((f) => (f.id === id ? original : f)));
      }
      setMensaje(e instanceof Error ? `❌ ${e.message}` : "❌ Error al registrar pago");
      setTimeout(() => setMensaje(null), 4000);
    }
  };

  // M4 — Revertir un pago YA confirmado (botón permanente en filas Pagadas).
  // Para cuando se marcó pagada por error: vuelve a Pendiente/Vencida y limpia la
  // captura/método. (El "Deshacer" de 5 s sigue existiendo para el arrepentimiento
  // inmediato; esto cubre la corrección posterior.)
  const revertirPagoPermanente = async (id: string) => {
    setRevirtiendoId(id);
    try {
      const res = await fetch(`/api/facturas/${id}/pago`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.error === "string" ? err.error : "Error al revertir");
      }
      setMensaje("↩️ Pago revertido — la cobranza vuelve a estar pendiente.");
      setTimeout(() => setMensaje(null), 3000);
      fetchData();
    } catch (e) {
      setMensaje(e instanceof Error ? `❌ ${e.message}` : "❌ No se pudo revertir");
      setTimeout(() => setMensaje(null), 4000);
    } finally {
      setRevirtiendoId(null);
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

  // Cambiar la fecha de vencimiento de una cobranza (la mayoría paga días
  // después; la asesora ajusta cuándo). Optimista + refresca las stats.
  const cambiarVencimiento = async (id: string, nuevaFecha: string) => {
    setGuardandoVenc(id);
    try {
      const res = await fetch(`/api/facturas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha_vencimiento: nuevaFecha }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          typeof err.error === "string" ? err.error : "Error al cambiar la fecha"
        );
      }
      const j = (await res.json()) as { fecha_vencimiento: string; estado: string };
      setFacturas((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, fecha_vencimiento: j.fecha_vencimiento, estado: j.estado as Factura["estado"] }
            : f
        )
      );
      setMensaje("📅 Vencimiento actualizado");
      setTimeout(() => setMensaje(null), 2500);
      fetchData(); // refresca stats (Pendientes / Vencidas)
    } catch (e) {
      setMensaje(e instanceof Error ? `❌ ${e.message}` : "❌ No se pudo cambiar la fecha");
      setTimeout(() => setMensaje(null), 4000);
    } finally {
      setGuardandoVenc(null);
      setEditandoVenc(null);
    }
  };

  // ── Anular cobranza (soft) ──
  // Para cobranzas creadas por error o cuya factura/boleta se anuló con NC. Abre
  // un modal que pide el motivo; el backend valida (propiedad, que no esté
  // pagada, y que no respalde una factura vigente sin NC). Si rechaza, mostramos
  // su mensaje tal cual (p. ej. "emite primero la Nota de Crédito").
  const [anularModal, setAnularModal] = useState<Factura | null>(null);
  const [anularMotivo, setAnularMotivo] = useState("");
  const [anulando, setAnulando] = useState(false);
  const [anularError, setAnularError] = useState<string | null>(null);

  const abrirAnular = (f: Factura) => {
    setAnularModal(f);
    setAnularMotivo("");
    setAnularError(null);
  };

  const confirmarAnular = async () => {
    if (!anularModal) return;
    const motivo = anularMotivo.trim();
    if (motivo.length < 3) {
      setAnularError("Explica el motivo (mín. 3 caracteres).");
      return;
    }
    setAnulando(true);
    setAnularError(null);
    try {
      const res = await fetch(`/api/facturas/${anularModal.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg =
          typeof j.error === "string" ? j.error : "No se pudo anular la cobranza.";
        throw new Error(msg);
      }
      // Optimista: la sacamos de la vista (salvo que estemos viendo justamente
      // las anuladas). Refrescamos stats igual.
      const anuladaId = anularModal.id;
      setFacturas((prev) =>
        filtroEstado === "Anulada"
          ? prev.map((f) =>
              f.id === anuladaId
                ? { ...f, estado: "Anulada", anulada_motivo: motivo }
                : f
            )
          : prev.filter((f) => f.id !== anuladaId)
      );
      setAnularModal(null);
      setMensaje("🚫 Cobranza anulada");
      setTimeout(() => setMensaje(null), 2500);
      fetchData();
    } catch (e) {
      setAnularError(e instanceof Error ? e.message : "No se pudo anular.");
    } finally {
      setAnulando(false);
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
      setErrorManual("Ingresa el nombre del cliente.");
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

      {/* ── Buscador ── */}
      <div className="mb-3 relative">
        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por cliente, comprobante o asesora..."
          className="w-full pl-9 pr-9 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400 transition-all"
        />
        {busqueda && (
          <button
            onClick={() => setBusqueda("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
          >
            <FiX size={14} />
          </button>
        )}
      </div>

      {/* ── Filtros de estado ── */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {[
          { value: "all", label: "Todas" },
          { value: "Pendiente", label: "Pendientes" },
          { value: "Vencida", label: "Vencidas" },
          { value: "Pagada", label: "Pagadas" },
          { value: "Anulada", label: "Anuladas" },
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
        {busqueda && (
          <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-50 text-gray-500 tabular-nums">
            {facturasFiltradas.length} resultado{facturasFiltradas.length !== 1 ? "s" : ""}
          </span>
        )}
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
            {facturasFiltradas.length === 0 && (
              <tr>
                <td colSpan={userRole === "admin" ? 7 : 6} className="text-center text-gray-400 py-8">
                  {busqueda ? `Sin resultados para "${busqueda}"` : "No hay cobranzas"}
                </td>
              </tr>
            )}
            {facturasFiltradas.map((f) => {
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
                    {editandoVenc === f.id ? (
                      <input
                        type="date"
                        defaultValue={f.fecha_vencimiento}
                        autoFocus
                        disabled={guardandoVenc === f.id}
                        onChange={(e) => e.target.value && cambiarVencimiento(f.id, e.target.value)}
                        onBlur={() => setEditandoVenc(null)}
                        className="border border-gray-300 rounded px-1.5 py-1 text-xs focus:ring-2 focus:ring-red-400 focus:outline-none"
                      />
                    ) : f.estado !== "Pagada" ? (
                      <button
                        onClick={() => setEditandoVenc(f.id)}
                        title="Tocá para cambiar la fecha de vencimiento"
                        className="group inline-flex flex-col items-center rounded px-1.5 py-0.5 hover:bg-white/70 transition-colors cursor-pointer"
                      >
                        <span className="font-medium inline-flex items-center gap-1 tabular-nums">
                          {f.fecha_vencimiento}
                          <FiEdit2 className="h-2.5 w-2.5 text-gray-300 group-hover:text-gray-500" />
                        </span>
                        <span className={`text-[10px] ${urg.text}`}>{urg.label}</span>
                      </button>
                    ) : (
                      <>
                        <div className="font-medium tabular-nums">{f.fecha_vencimiento}</div>
                        <div className={`text-[10px] ${urg.text}`}>{urg.label}</div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${urg.text} bg-white border`}>
                      {f.estado}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {f.estado === "Anulada" ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] font-medium text-gray-400">Anulada</span>
                        {f.anulada_motivo && (
                          <span
                            className="text-[10px] text-gray-400 italic max-w-[160px] truncate"
                            title={f.anulada_motivo}
                          >
                            &ldquo;{f.anulada_motivo}&rdquo;
                          </span>
                        )}
                        {f.anulada_por && (
                          <span className="text-[9px] text-gray-300">por {f.anulada_por}</span>
                        )}
                      </div>
                    ) : f.estado !== "Pagada" ? (
                      <div className="flex flex-col items-center gap-1">
                        <button
                          onClick={() => abrirModalPago(f)}
                          className="px-2.5 py-1 bg-green-500 text-white rounded text-xs font-medium hover:bg-green-600"
                        >
                          Marcar pagada
                        </button>
                        <button
                          onClick={() => abrirAnular(f)}
                          className="text-[10px] font-medium text-gray-400 hover:text-red-600 hover:underline inline-flex items-center gap-0.5"
                          title="Anular esta cobranza (creada por error o anulada con Nota de Crédito)"
                        >
                          <FiSlash className="h-3 w-3" /> Anular
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[10px] text-gray-500">Pagada {f.fecha_pago}</span>
                        {(f.metodo_pago || f.pago_detalle || f.imagenes_ids.length > 0) && (
                          <div className="flex items-center gap-1.5 justify-center flex-wrap">
                            {f.metodo_pago && (
                              <span className="text-[10px] font-medium text-gray-600 bg-gray-100 rounded px-1.5 py-0.5 capitalize">
                                {f.metodo_pago}
                              </span>
                            )}
                            {f.pago_detalle && (
                              <span className="text-[10px] text-gray-500" title="Número de operación">
                                N°&nbsp;{f.pago_detalle}
                              </span>
                            )}

                            {/* Capturas de pago */}
                            {(() => {
                              const reales = f.imagenes_ids.filter((id) => !id.startsWith("__pending_"));
                              const pending = f.imagenes_ids.some((id) => id.startsWith("__pending_"));

                              if (pending) return <span className="text-[10px] text-gray-400">guardando…</span>;
                              if (reales.length === 0) return null;

                              // Una sola captura: link directo + basura
                              if (reales.length === 1) {
                                const imgId = reales[0];
                                return (
                                  <span className="inline-flex items-center gap-1">
                                    <a
                                      href={`/api/pago-imagenes/${imgId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[10px] font-medium text-indigo-600 hover:underline inline-flex items-center gap-0.5"
                                    >
                                      <FiEye className="h-3 w-3" /> captura
                                    </a>
                                    {confirmandoEliminarImg === imgId ? (
                                      <span className="inline-flex items-center gap-0.5 text-[10px]">
                                        <button onClick={() => { setConfirmandoEliminarImg(null); eliminarImagenPago(f.id, imgId); }} className="font-semibold text-red-600 hover:text-red-800">Sí</button>
                                        <span className="text-gray-300">·</span>
                                        <button onClick={() => setConfirmandoEliminarImg(null)} className="text-gray-500">No</button>
                                      </span>
                                    ) : (
                                      <button onClick={() => setConfirmandoEliminarImg(imgId)} className="text-gray-300 hover:text-red-500 transition-colors" title="Eliminar">
                                        <FiTrash2 className="h-2.5 w-2.5" />
                                      </button>
                                    )}
                                  </span>
                                );
                              }

                              // Varias capturas: chip compacto + dropdown
                              const abierto = expandiendoCapturas === f.id;
                              return (
                                <div className="relative">
                                  <button
                                    onClick={() => {
                                      setExpandiendoCapturas(abierto ? null : f.id);
                                      setConfirmandoEliminarImg(null);
                                    }}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded px-1.5 py-0.5 transition-colors"
                                  >
                                    <FiCamera className="h-3 w-3" />
                                    {reales.length} capturas
                                    <FiChevronDown className={`h-3 w-3 transition-transform duration-150 ${abierto ? "rotate-180" : ""}`} />
                                  </button>

                                  {abierto && (
                                    <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[130px]">
                                      {reales.map((imgId, idx) => (
                                        <div key={imgId} className="flex items-center justify-between px-2.5 py-1 hover:bg-gray-50">
                                          <a
                                            href={`/api/pago-imagenes/${imgId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[11px] font-medium text-indigo-600 hover:underline inline-flex items-center gap-1"
                                          >
                                            <FiEye className="h-3 w-3" /> Ver {idx + 1}
                                          </a>
                                          {confirmandoEliminarImg === imgId ? (
                                            <span className="inline-flex items-center gap-0.5 text-[10px] ml-2">
                                              <button onClick={() => { setConfirmandoEliminarImg(null); eliminarImagenPago(f.id, imgId); }} className="font-semibold text-red-600 hover:text-red-800">Sí</button>
                                              <span className="text-gray-300">·</span>
                                              <button onClick={() => setConfirmandoEliminarImg(null)} className="text-gray-500">No</button>
                                            </span>
                                          ) : (
                                            <button onClick={() => setConfirmandoEliminarImg(imgId)} className="text-gray-300 hover:text-red-500 transition-colors ml-2" title="Eliminar">
                                              <FiTrash2 className="h-3 w-3" />
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => abrirEditarPago(f)}
                            className="text-[10px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-0.5"
                            title="Editar método, número de operación o agregar capturas"
                          >
                            <FiEdit2 className="h-3 w-3" /> Editar
                          </button>
                          <span className="text-gray-200 text-[10px]">·</span>
                          {confirmandoRevertir === f.id ? (
                            <span className="inline-flex items-center gap-1 text-[10px]">
                              <span className="text-gray-500">¿Revertir?</span>
                              <button
                                onClick={() => { setConfirmandoRevertir(null); revertirPagoPermanente(f.id); }}
                                disabled={revirtiendoId === f.id}
                                className="font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                              >Sí</button>
                              <span className="text-gray-300">·</span>
                              <button onClick={() => setConfirmandoRevertir(null)} className="text-gray-500">No</button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmandoRevertir(f.id)}
                              disabled={revirtiendoId === f.id}
                              className="text-[10px] font-medium text-amber-700 hover:text-amber-900 hover:underline inline-flex items-center gap-0.5 disabled:opacity-50"
                              title="Marcar como NO pagada (borrará método, número y capturas)"
                            >
                              <FiCornerUpLeft className="h-3 w-3" />
                              {revirtiendoId === f.id ? "Revirtiendo…" : "Revertir"}
                            </button>
                          )}
                        </div>
                      </div>
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

      {/* Modal: Anular cobranza (pide motivo) */}
      {anularModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => !anulando && setAnularModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <FiSlash className="text-red-500" /> Anular cobranza
              </h3>
              <button
                onClick={() => !anulando && setAnularModal(null)}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Cerrar"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              {anularModal.cliente_nombre}
              {anularModal.numero_comprobante ? ` · ${anularModal.numero_comprobante}` : ""} · S/{" "}
              {toNum(anularModal.monto).toFixed(2)}
            </p>

            <label className="block text-xs font-medium text-gray-600 mb-1">
              Motivo <span className="text-red-500">*</span>
            </label>
            <textarea
              value={anularMotivo}
              onChange={(e) => setAnularMotivo(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Ej: cobranza duplicada / creada por error / factura anulada con NC"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 focus:outline-none resize-none"
            />

            <p className="text-[11px] text-gray-400 mt-2">
              Queda como <strong>Anulada</strong> (no se borra), con tu nombre y el motivo. Sale
              de la lista y de los totales.
            </p>

            {anularError && (
              <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {anularError}
              </div>
            )}

            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setAnularModal(null)}
                disabled={anulando}
                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarAnular}
                disabled={anulando || anularMotivo.trim().length < 3}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {anulando ? (
                  <>
                    <FiRefreshCw className="h-4 w-4 animate-spin" /> Anulando…
                  </>
                ) : (
                  <>
                    <FiSlash className="h-4 w-4" /> Anular cobranza
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* M4 — Modal "Registrar pago": método de pago + nota + captura opcional */}
      {modalPago && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setModalPago(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h3 className="text-base font-bold text-gray-800">
                  {modoEdicion ? "Editar pago" : "Registrar pago"}
                </h3>
                <p className="text-xs text-gray-500">
                  {modalPago.cliente_nombre} · S/ {toNum(modalPago.monto).toFixed(2)}
                </p>
              </div>
              <button onClick={() => setModalPago(null)} className="text-gray-400 hover:text-gray-700">
                <FiX className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Método de pago */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">¿Cómo pagó?</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: "efectivo", l: "Efectivo" },
                    { v: "transferencia", l: "Transferencia" },
                    { v: "yape", l: "Yape" },
                    { v: "plin", l: "Plin" },
                    { v: "otro", l: "Otro" },
                  ].map((m) => (
                    <button
                      key={m.v}
                      type="button"
                      onClick={() => setPagoMetodo(m.v)}
                      className={`px-2 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        pagoMetodo === m.v
                          ? "bg-green-600 text-white border-green-600"
                          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {m.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Número de operación (para Yape, Plin, transferencia, etc.) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Número de operación
                  <span className="font-normal text-gray-400 ml-1">(opcional)</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pagoNumOp}
                  onChange={(e) => setPagoNumOp(e.target.value.replace(/\D/g, ''))}
                  maxLength={20}
                  placeholder="Ej: 123456789"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-400 focus:outline-none"
                />
              </div>

              {/* Nota / detalle (sobre todo para "Otro" o info extra) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {pagoMetodo === "otro" ? "¿Cómo pagó? (especifica)" : "Nota del pago"}
                  <span className="font-normal text-gray-400 ml-1">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={pagoNota}
                  onChange={(e) => setPagoNota(e.target.value)}
                  maxLength={200}
                  placeholder={pagoMetodo === "otro" ? "Ej: depósito en agente, vale…" : "Ej: acordado con el cliente"}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-400 focus:outline-none"
                />
              </div>

              {/* Capturas del pago (opcional, hasta 10, comprimidas) */}
              {(() => {
                // En edición leemos el estado VIVO de facturas para que el X actualice en tiempo real.
                const captActuales = modoEdicion && modalPago
                  ? (facturas.find(f => f.id === modalPago.id)?.imagenes_ids ?? []).filter(id => !id.startsWith("__pending_"))
                  : [];
                const totalCapturas = captActuales.length + pagoImagenes.length;
                return (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">Capturas del pago (opcional)</label>
                  {totalCapturas > 0 && (
                    <span className="text-xs text-gray-400">{totalCapturas} de 10</span>
                  )}
                </div>

                {/* Capturas ya guardadas en DB (solo modo edición) */}
                {modoEdicion && captActuales.length > 0 && (
                  <div className="mb-2">
                    <p className="text-[11px] text-gray-400 mb-1.5">Capturas guardadas</p>
                    <div className="flex flex-wrap gap-2">
                      {captActuales.map((imgId, idx) => (
                        <div key={imgId} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/pago-imagenes/${imgId}`}
                            alt={`Captura guardada ${idx + 1}`}
                            className="h-20 w-20 object-cover rounded-lg border border-gray-200"
                          />
                          <button
                            type="button"
                            onClick={() => eliminarImagenPago(modalPago!.id, imgId)}
                            className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 shadow hover:bg-red-600"
                            title="Eliminar esta captura"
                          >
                            <FiX className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {pagoImagenes.length > 0 && (
                      <p className="text-[11px] text-gray-400 mt-2 mb-1.5">Nuevas a agregar</p>
                    )}
                  </div>
                )}

                {/* Grid de thumbnails nuevos (pendientes de guardar) */}
                {pagoImagenes.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pagoImagenes.map((img, idx) => (
                      <div key={idx} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.preview}
                          alt={`Nueva captura ${idx + 1}`}
                          className="h-20 w-20 object-cover rounded-lg border border-indigo-200"
                        />
                        <button
                          type="button"
                          onClick={() => quitarImagenPago(idx)}
                          className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 shadow hover:bg-red-600"
                          title="Quitar esta captura"
                        >
                          <FiX className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Botón agregar (visible mientras haya menos de 10 en total) */}
                {totalCapturas < 10 && (
                  <label
                    className={`flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg py-3 cursor-pointer hover:bg-gray-50 text-sm text-gray-500 ${
                      comprimiendo ? "opacity-60 pointer-events-none" : ""
                    }`}
                  >
                    <FiCamera className="h-4 w-4" />
                    {comprimiendo ? "Procesando…" : totalCapturas === 0 ? "Subir foto / captura" : "Agregar otra captura"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        onSelectImagePago(e.target.files?.[0] ?? null);
                        // Limpiar el input para poder seleccionar el mismo archivo de nuevo
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}

                <p className="text-[11px] text-gray-400 mt-1">
                  {modoEdicion
                    ? "Toca ✕ para eliminar una captura guardada. Las que agregues aquí se suman a las existentes."
                    : "Se comprimen automáticamente. Quedan guardadas y vinculadas a esta cobranza."}
                </p>
              </div>
              );
              })()}
            </div>

            <div className="px-5 py-4 border-t flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                onClick={() => setModalPago(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarPago}
                disabled={comprimiendo}
                className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <FiCheckCircle className="h-4 w-4" />
                {modoEdicion ? "Guardar cambios" : "Confirmar pago"}
              </button>
            </div>
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
                  placeholder="Busca un cliente guardado o escribe uno nuevo"
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
                    Si eliges una factura, vinculamos la cobranza y autollenamos el monto.
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
          <span className="font-semibold text-gray-800">Deuda por antigüedad</span>
          <span className="text-xs text-gray-500">
            {userRole === "asesor" ? "— la tuya" : "— cuánto llevan sin cobrar"}
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
