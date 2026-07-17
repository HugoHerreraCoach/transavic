"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiAlertCircle,
  FiArrowLeft,
  FiCheckCircle,
  FiDownload,
  FiDollarSign,
  FiEdit2,
  FiFileText,
  FiLoader,
  FiRefreshCw,
  FiShare2,
  FiX,
} from "react-icons/fi";
import { construirEstadoCuentaProveedor } from "@/lib/proveedores/estado-cuenta";
import type {
  DeudaProveedorFicha,
  FichaProveedorResponse,
  PagoProveedorFicha,
} from "@/lib/proveedores/types";

type Cuenta = { id: string; nombre: string; saldo: number; activa?: boolean };

const hoyLima = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
const dinero = (monto: number) =>
  `S/ ${Number(monto).toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const fecha = (valor: string) => {
  const [y, m, d] = valor.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const hora = (valor: string) =>
  new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(valor));

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

function Resumen({ label, monto, tono = "normal" }: { label: string; monto: number; tono?: "normal" | "deuda" | "favor" }) {
  const clases =
    tono === "deuda"
      ? "border-red-100 bg-red-50 text-red-700"
      : tono === "favor"
        ? "border-emerald-100 bg-emerald-50 text-emerald-700"
        : "border-gray-100 bg-white text-gray-900";
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${clases}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide opacity-60">{label}</p>
      <p className="mt-1 text-xl font-black">{dinero(monto)}</p>
    </div>
  );
}

function ModalPago({
  ficha,
  cuentas,
  deudaInicial,
  onClose,
  onGuardado,
}: {
  ficha: FichaProveedorResponse;
  cuentas: Cuenta[];
  deudaInicial: DeudaProveedorFicha | null;
  onClose: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id ?? "");
  const [monto, setMonto] = useState(
    deudaInicial ? deudaInicial.saldo_restante.toFixed(2) : ""
  );
  const [fechaPago, setFechaPago] = useState(hoyLima);
  const [notas, setNotas] = useState("");
  const [deudaId, setDeudaId] = useState(deudaInicial?.id ?? "");
  const [confirmacion, setConfirmacion] = useState<{
    mensaje: string;
    saldo: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const montoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    montoRef.current?.focus();
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const enviar = async (confirmarAnticipo: boolean) => {
    const montoNumero = Number(monto);
    if (!cuentaId || !Number.isFinite(montoNumero) || montoNumero <= 0) {
      setError("Selecciona una cuenta e ingresa un monto mayor a cero.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/proveedores/${ficha.proveedor.id}/pagos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          cuenta_bancaria_id: cuentaId,
          monto: montoNumero,
          fecha: fechaPago,
          notas: notas || null,
          deuda_prioritaria_id: deudaId || null,
          confirmar_anticipo: confirmarAnticipo,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.codigo === "ANTICIPO_REQUIERE_CONFIRMACION") {
        setConfirmacion({ mensaje: data.error, saldo: Number(data.saldo_favor_nuevo) });
        return;
      }
      if (!res.ok) throw new Error(data.error || "No se pudo registrar el pago.");
      onGuardado(data.message || "Pago registrado correctamente.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el pago.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/55 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-pago-proveedor"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-100 bg-white px-5 py-4">
          <div>
            <h2 id="titulo-pago-proveedor" className="text-lg font-black text-gray-900">
              Registrar pago
            </h2>
            <p className="text-sm text-gray-500">{ficha.proveedor.razon_social}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar registro de pago" className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-indigo-500">
            <FiX size={20} />
          </button>
        </header>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 rounded-2xl bg-indigo-50 p-4 text-sm">
            <div>
              <p className="text-xs text-indigo-500">Deuda actual</p>
              <p className="font-black text-indigo-950">{dinero(ficha.resumen.deuda_pendiente)}</p>
            </div>
            <div>
              <p className="text-xs text-indigo-500">Saldo a favor actual</p>
              <p className="font-black text-emerald-700">{dinero(ficha.resumen.saldo_favor)}</p>
            </div>
          </div>
          <label className="block text-sm font-semibold text-gray-700">
            Cuenta de origen
            <select required value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100">
              <option value="">Selecciona una cuenta</option>
              {cuentas.map((cuenta) => (
                <option key={cuenta.id} value={cuenta.id}>
                  {cuenta.nombre} (saldo {dinero(cuenta.saldo)})
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs font-normal text-gray-400">El pago se registra aunque esta cuenta quede con saldo negativo.</span>
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            Monto del pago
            <input ref={montoRef} type="number" min="0.01" step="0.01" required value={monto} onChange={(e) => { setMonto(e.target.value); setConfirmacion(null); }} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-lg font-black text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-gray-700">
              Fecha real del pago
              <input type="date" max={hoyLima()} required value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            </label>
            <label className="block text-sm font-semibold text-gray-700">
              Pagar primero
              <select value={deudaId} onChange={(e) => setDeudaId(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100">
                <option value="">Deudas más antiguas</option>
                {ficha.deudas.filter((d) => d.saldo_restante > 0.009).map((deuda) => (
                  <option key={deuda.id} value={deuda.id}>
                    {deuda.nro_doc || deuda.concepto || "Deuda"} - {dinero(deuda.saldo_restante)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm font-semibold text-gray-700">
            Notas o número de operación
            <input maxLength={500} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej.: Operación BBVA 000005221" className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>

          {confirmacion && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4" role="alert">
              <p className="font-bold text-amber-900">Confirmar anticipo de {dinero(confirmacion.saldo)}</p>
              <p className="mt-1 text-sm text-amber-800">{confirmacion.mensaje} Se aplicará automáticamente a futuras deudas del mismo proveedor.</p>
              <button disabled={enviando} onClick={() => enviar(true)} className="mt-3 min-h-11 w-full rounded-xl bg-amber-600 px-4 font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                {enviando ? "Registrando..." : "Confirmar pago y anticipo"}
              </button>
            </div>
          )}
          {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p>}
          {!confirmacion && (
            <div className="flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-gray-100 px-5 font-bold text-gray-700 hover:bg-gray-200">Cancelar</button>
              <button type="button" disabled={enviando || cuentas.length === 0} onClick={() => enviar(false)} className="min-h-11 rounded-xl bg-indigo-600 px-5 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                {enviando ? "Registrando..." : "Registrar pago"}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ModalEditarDeuda({
  proveedorNombre,
  deuda,
  onClose,
  onGuardado,
}: {
  proveedorNombre: string;
  deuda: DeudaProveedorFicha;
  onClose: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const [monto, setMonto] = useState(deuda.monto_deuda.toFixed(2));
  const [vencimiento, setVencimiento] = useState(deuda.fecha_vencimiento?.slice(0, 10) ?? "");
  const [concepto, setConcepto] = useState(deuda.concepto || "Saldo anterior");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const montoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    montoRef.current?.focus();
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  // Lo que sobra del pago si el saldo se achica por debajo de lo ya aplicado.
  const montoIngresado = Number(monto);
  const liberado =
    Number.isFinite(montoIngresado) && montoIngresado > 0
      ? Math.round(Math.max(0, deuda.monto_pagado - montoIngresado) * 100) / 100
      : 0;

  const guardar = async () => {
    const montoNumero = Number(monto);
    if (!Number.isFinite(montoNumero) || montoNumero <= 0) {
      setError("Ingresa un monto mayor a cero.");
      return;
    }
    if (!concepto.trim()) {
      setError("Escribe un concepto para la deuda.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/cuentas-por-pagar/${deuda.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monto: montoNumero,
          fecha_vencimiento: vencimiento || null,
          concepto: concepto.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar la deuda.");
      const liberadoResp = Number(data.liberado || 0);
      onGuardado(
        liberadoResp > 0
          ? `Saldo anterior actualizado. ${dinero(liberadoResp)} quedaron como saldo a favor del proveedor.`
          : "Saldo anterior actualizado correctamente."
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la deuda.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/55 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-editar-deuda"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-100 bg-white px-5 py-4">
          <div>
            <h2 id="titulo-editar-deuda" className="text-lg font-black text-gray-900">Editar saldo anterior</h2>
            <p className="text-sm text-gray-500">{proveedorNombre}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar edición" className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-indigo-500"><FiX size={20} /></button>
        </header>
        <div className="space-y-4 p-5">
          <p className="rounded-2xl bg-indigo-50 p-3 text-xs text-indigo-800">Corrige el monto, el nombre o la fecha del saldo anterior. Las deudas que vienen de una compra no se pueden editar.</p>
          {deuda.monto_pagado > 0.009 && (
            <p className="rounded-2xl bg-gray-50 p-3 text-xs text-gray-600">
              Este saldo ya tiene <b>{dinero(deuda.monto_pagado)}</b> pagados.
            </p>
          )}
          {liberado > 0 && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800" role="alert">
              Al bajarlo a {dinero(montoIngresado)} se liberarán <b>{dinero(liberado)}</b> del pago ya aplicado. Ese dinero queda como <b>saldo a favor</b> del proveedor y se descuenta solo de la próxima compra.
            </p>
          )}
          <label className="block text-sm font-semibold text-gray-700">
            Monto de la deuda
            <input ref={montoRef} type="number" min="0.01" step="0.01" required value={monto} onChange={(e) => setMonto(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-lg font-black text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            Concepto
            <input maxLength={200} value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej.: Saldo anterior" className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            Vence (opcional)
            <input type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-gray-300 px-3 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </label>
          {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p>}
          <div className="flex flex-col-reverse gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-gray-100 px-5 font-bold text-gray-700 hover:bg-gray-200">Cancelar</button>
            <button type="button" disabled={enviando} onClick={guardar} className="min-h-11 rounded-xl bg-indigo-600 px-5 font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{enviando ? "Guardando..." : "Guardar cambios"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function FichaProveedorClient({ proveedorId }: { proveedorId: string }) {
  const [ficha, setFicha] = useState<FichaProveedorResponse | null>(null);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [modalPago, setModalPago] = useState(false);
  const [deudaInicial, setDeudaInicial] = useState<DeudaProveedorFicha | null>(null);
  const [deudaAEditar, setDeudaAEditar] = useState<DeudaProveedorFicha | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [generandoPdf, setGenerandoPdf] = useState<"compartir" | "descargar" | null>(null);
  const estadoRef = useRef<HTMLElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [fichaRes, cuentasRes] = await Promise.all([
        fetch(`/api/proveedores/${proveedorId}/ficha`, { cache: "no-store" }),
        fetch("/api/cuentas", { cache: "no-store" }),
      ]);
      const fichaData = await fichaRes.json();
      if (!fichaRes.ok) throw new Error(fichaData.error || "No se pudo cargar la ficha.");
      setFicha(fichaData);
      if (cuentasRes.ok) setCuentas(await cuentasRes.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la ficha.");
    } finally {
      setCargando(false);
    }
  }, [proveedorId]);

  useEffect(() => { cargar(); }, [cargar]);

  const estado = useMemo(
    () => construirEstadoCuentaProveedor(ficha?.movimientos ?? [], desde || null, hasta || null),
    [ficha, desde, hasta]
  );

  const generarPdf = async (accion: "compartir" | "descargar") => {
    if (!ficha || generandoPdf) return;
    setGenerandoPdf(accion);
    try {
      const { generarPdfEstadoCuentaProveedor } = await import("@/lib/reportes/pdf-estado-cuenta-proveedor");
      const blob = await generarPdfEstadoCuentaProveedor(ficha.proveedor, estado);
      const slug = ficha.proveedor.razon_social.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const nombre = `estado-cuenta-proveedor-${slug || "proveedor"}.pdf`;
      if (accion === "compartir") {
        const archivo = new File([blob], nombre, { type: "application/pdf" });
        if (navigator.share && navigator.canShare?.({ files: [archivo] })) {
          await navigator.share({ files: [archivo], title: `Estado de cuenta - ${ficha.proveedor.razon_social}` });
        } else descargar(blob, nombre);
      } else descargar(blob, nombre);
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") setError("No se pudo generar el PDF.");
    } finally {
      setGenerandoPdf(null);
    }
  };

  const anular = async (pago: PagoProveedorFicha) => {
    const motivo = window.prompt("Motivo de la anulación (mínimo 5 caracteres):");
    if (!motivo) return;
    try {
      const res = await fetch(`/api/proveedores/${proveedorId}/pagos/${pago.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo anular el pago.");
      setMensaje("Pago anulado y movimiento bancario revertido.");
      cargar();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo anular el pago.");
    }
  };

  if (cargando && !ficha) return <div className="flex min-h-80 items-center justify-center gap-3 text-gray-500"><FiLoader className="animate-spin" /> Cargando ficha financiera...</div>;
  if (!ficha) return <div className="mx-auto max-w-xl rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700"><p className="font-bold">{error || "Proveedor no encontrado."}</p><Link href="/dashboard/proveedores" className="mt-3 inline-block underline">Volver a proveedores</Link></div>;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
        <Link href="/dashboard/proveedores" className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-gray-500 hover:text-indigo-700"><FiArrowLeft /> Proveedores</Link>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-black text-gray-950 sm:text-3xl">{ficha.proveedor.razon_social}</h1>{!ficha.proveedor.activo && <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">Inactivo</span>}</div>
            <p className="mt-1 text-sm text-gray-500">{ficha.proveedor.ruc ? `RUC ${ficha.proveedor.ruc}` : "Sin RUC"}{ficha.proveedor.telefono ? ` - ${ficha.proveedor.telefono}` : ""}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button onClick={() => { setDeudaInicial(null); setModalPago(true); }} className="min-h-11 rounded-xl bg-indigo-600 px-4 font-bold text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"><FiDollarSign className="mr-2 inline" />Registrar pago</button>
            <button onClick={() => estadoRef.current?.scrollIntoView({ behavior: "smooth" })} className="min-h-11 rounded-xl bg-gray-900 px-4 font-bold text-white hover:bg-black"><FiFileText className="mr-2 inline" />Estado de cuenta</button>
            <button onClick={cargar} disabled={cargando} className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"><FiRefreshCw className={`mr-2 inline ${cargando ? "animate-spin" : ""}`} />Refrescar</button>
          </div>
        </div>
      </header>

      {mensaje && <div role="status" className="flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-700"><FiCheckCircle />{mensaje}</div>}
      {error && <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700"><FiAlertCircle />{error}</div>}

      <section aria-label="Resumen financiero" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Resumen label="Deuda anterior" monto={ficha.resumen.deuda_anterior} />
        <Resumen label="Total comprado" monto={ficha.resumen.total_comprado} />
        <Resumen label="Total pagado" monto={ficha.resumen.total_pagado} />
        <Resumen label="Deuda pendiente" monto={ficha.resumen.deuda_pendiente} tono="deuda" />
        <div className="col-span-2 lg:col-span-1"><Resumen label="Saldo a favor" monto={ficha.resumen.saldo_favor} tono="favor" /></div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-5"><h2 className="text-lg font-black text-gray-900">Deudas y documentos</h2><p className="text-sm text-gray-500">El pago elegido se aplica primero y luego continúa por antigüedad.</p></div>
          <div className="max-h-[540px] space-y-3 overflow-y-auto p-4">
            {ficha.deudas.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">Sin deudas registradas.</p> : ficha.deudas.map((deuda) => (
              <article key={deuda.id} className="rounded-2xl border border-gray-100 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black text-gray-900">{deuda.tipo_doc && deuda.nro_doc ? `${deuda.tipo_doc} ${deuda.nro_doc}` : deuda.concepto || "Deuda manual"}</p><p className="text-xs text-gray-400">{fecha(deuda.fecha)}{deuda.fecha_vencimiento ? ` - vence ${fecha(deuda.fecha_vencimiento)}` : ""}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${deuda.estado === "Pagado" ? "bg-emerald-50 text-emerald-700" : deuda.estado === "Parcial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{deuda.estado}</span></div>
                {deuda.items.length > 0 && <ul className="mt-3 space-y-1 rounded-xl bg-gray-50 p-3 text-xs text-gray-600">{deuda.items.map((item) => <li key={item.id} className="flex justify-between gap-3"><span>{item.producto_nombre} - {item.peso_neto.toLocaleString("es-PE", { maximumFractionDigits: 2 })} kg x {dinero(item.costo_unitario)}</span><b>{dinero(item.subtotal)}</b></li>)}</ul>}
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><span className="block text-xs text-gray-400">Deuda</span><b>{dinero(deuda.monto_deuda)}</b></div><div><span className="block text-xs text-gray-400">Pagado</span><b className="text-emerald-700">{dinero(deuda.monto_pagado)}</b></div><div><span className="block text-xs text-gray-400">Restante</span><b className="text-red-700">{dinero(deuda.saldo_restante)}</b></div></div>
                {(deuda.saldo_restante > 0.009 || deuda.compra_id === null) && (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    {deuda.saldo_restante > 0.009 && <button onClick={() => { setDeudaInicial(deuda); setModalPago(true); }} className="min-h-10 flex-1 rounded-xl bg-indigo-50 text-sm font-bold text-indigo-700 hover:bg-indigo-100">Pagar este documento primero</button>}
                    {deuda.compra_id === null && <button onClick={() => setDeudaAEditar(deuda)} className="min-h-10 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-600 hover:bg-gray-50" title="Corregir el monto, concepto o fecha del saldo anterior"><FiEdit2 className="mr-1.5 inline" />Editar</button>}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-5"><h2 className="text-lg font-black text-gray-900">Pagos separados</h2><p className="text-sm text-gray-500">Cada abono conserva su fecha, hora, cuenta y distribución.</p></div>
          <div className="max-h-[540px] space-y-3 overflow-y-auto p-4">
            {ficha.pagos.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">Aún no hay pagos registrados.</p> : ficha.pagos.map((pago) => (
              <article key={pago.id} className={`rounded-2xl border p-4 ${pago.estado === "anulado" ? "border-gray-200 bg-gray-50 opacity-70" : "border-emerald-100 bg-emerald-50/30"}`}>
                <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-black text-emerald-700">- {dinero(pago.monto)}</p><p className="text-xs text-gray-500">{fecha(pago.fecha)} a las {hora(pago.created_at)} - {pago.cuenta_nombre}</p></div><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-gray-600">{pago.estado === "anulado" ? "Anulado" : "Registrado"}</span></div>
                {pago.notas && <p className="mt-2 text-sm text-gray-600">Referencia: {pago.notas}</p>}
                {pago.aplicaciones.length > 0 && <ul className="mt-2 space-y-1 border-t border-emerald-100 pt-2 text-xs text-gray-600">{pago.aplicaciones.map((app) => <li key={app.id} className="flex justify-between gap-2"><span>{app.documento || "Deuda"}</span><b>{dinero(app.monto)}</b></li>)}</ul>}
                {pago.saldo_anticipo > 0 && <p className="mt-2 rounded-lg bg-blue-50 p-2 text-xs font-bold text-blue-700">Anticipo disponible: {dinero(pago.saldo_anticipo)}</p>}
                {pago.estado === "registrado" && <button onClick={() => anular(pago)} className="mt-3 text-xs font-bold text-red-600 underline hover:text-red-800">Anular y generar contraasiento</button>}
                {pago.estado === "anulado" && pago.motivo_anulacion && <p className="mt-2 text-xs text-gray-500">Motivo: {pago.motivo_anulacion}</p>}
              </article>
            ))}
          </div>
        </section>
      </div>

      <section ref={estadoRef} className="scroll-mt-5 rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-black text-gray-900">Estado de cuenta</h2><p className="text-sm text-gray-500">Compras y cada pago por separado, con saldo acumulado.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => generarPdf("compartir")} disabled={!!generandoPdf} className="min-h-11 rounded-xl bg-gray-900 px-4 text-sm font-bold text-white disabled:opacity-50"><FiShare2 className="mr-2 inline" />{generandoPdf === "compartir" ? "Generando..." : "Compartir PDF"}</button><button onClick={() => generarPdf("descargar")} disabled={!!generandoPdf} className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-700 disabled:opacity-50"><FiDownload className="mr-2 inline" />Descargar</button></div></div>
        <div className="mt-4 grid gap-3 rounded-2xl bg-gray-50 p-4 sm:grid-cols-3"><label className="text-xs font-bold uppercase text-gray-500">Desde<input type="date" max={hasta || undefined} value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm font-normal text-gray-900" /></label><label className="text-xs font-bold uppercase text-gray-500">Hasta<input type="date" min={desde || undefined} value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm font-normal text-gray-900" /></label><button onClick={() => { setDesde(""); setHasta(""); }} className="min-h-10 self-end rounded-lg border border-gray-200 bg-white text-sm font-bold text-gray-600">Ver todo</button></div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase text-gray-400">
                <th className="p-3">Fecha</th><th className="p-3">Movimiento</th>
                <th className="p-3">Detalle</th><th className="p-3 text-right">Deuda</th>
                <th className="p-3 text-right">Pago</th><th className="p-3 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {estado.movimientos.map((mov) => (
                <tr key={`${mov.tipo}-${mov.id}`}>
                  <td className="p-3 whitespace-nowrap">
                    {fecha(mov.fecha)}
                    {mov.tipo !== "deuda" && <span className="block text-xs text-gray-400">{hora(mov.created_at)}</span>}
                  </td>
                  <td className="p-3 font-bold">
                    {mov.tipo === "deuda" ? "Compra / deuda" : mov.tipo === "pago" ? "Pago" : "Contraasiento"}
                  </td>
                  <td className="p-3 text-gray-600">
                    <span className="font-medium text-gray-800">{mov.documento || mov.concepto}</span>
                    {mov.cuenta_nombre && <span className="block text-xs">{mov.cuenta_nombre}</span>}
                    {mov.notas && <span className="block text-xs">Ref.: {mov.notas}</span>}
                  </td>
                  <td className="p-3 text-right font-bold">
                    {mov.tipo === "deuda" || mov.tipo === "contraasiento" ? dinero(mov.monto) : ""}
                  </td>
                  <td className="p-3 text-right font-bold text-emerald-700">
                    {mov.tipo === "pago" ? `- ${dinero(mov.monto)}` : ""}
                  </td>
                  <td className="p-3 text-right font-black">{dinero(mov.saldo_posterior)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {estado.movimientos.length === 0 && <p className="p-8 text-center text-sm text-gray-400">Sin movimientos en el período.</p>}
        </div>
        <div className="mt-4 ml-auto grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4"><Resumen label="Saldo inicial" monto={estado.saldo_inicial} /><Resumen label="Comprado" monto={estado.total_comprado} /><Resumen label="Pagos netos" monto={estado.total_pagado} /><Resumen label={estado.saldo_favor > 0 ? "Saldo a favor" : "Deuda final"} monto={estado.saldo_favor > 0 ? estado.saldo_favor : estado.deuda_pendiente} tono={estado.saldo_favor > 0 ? "favor" : "deuda"} /></div>
      </section>

      {modalPago && <ModalPago ficha={ficha} cuentas={cuentas} deudaInicial={deudaInicial} onClose={() => setModalPago(false)} onGuardado={(texto) => { setModalPago(false); setMensaje(texto); cargar(); }} />}
      {deudaAEditar && <ModalEditarDeuda proveedorNombre={ficha.proveedor.razon_social} deuda={deudaAEditar} onClose={() => setDeudaAEditar(null)} onGuardado={(texto) => { setDeudaAEditar(null); setMensaje(texto); cargar(); }} />}
    </main>
  );
}
