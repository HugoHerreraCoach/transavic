// src/app/dashboard/clientes-avicola/estado-cuenta-modal.tsx
// Modal de ESTADO DE CUENTA del cliente avícola (rediseño 11 jul 2026):
// resumen general, filtro por período (Desde–Hasta), libro mayor POR DÍA
// (Venta del día · Peso/Producto · Monto del día · Saldo anterior · Abonos ·
// Saldo actual), totales del período y envío por WhatsApp / descarga en PDF,
// con opción Con precio / Sin precio. La aritmética vive en
// src/lib/avicola/estado-cuenta.ts (misma fuente que el PDF).
"use client";

import { useEffect, useMemo, useState } from "react";
import { FiDownload, FiLoader, FiShare2, FiX } from "react-icons/fi";
import type { ClienteAvicolaConSaldo, FichaClienteAvicola } from "@/lib/avicola/types";
import { UMBRAL_DEUDA } from "@/lib/avicola/saldos";
import { construirEstadoCuenta } from "@/lib/avicola/estado-cuenta";

function soles(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const kg = (n: number) => n.toLocaleString("es-PE", { maximumFractionDigits: 2 });

/** "2026-07-07" → "07/07/2026". */
function fechaCorta(fecha: string): string {
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function slugNombre(nombre: string): string {
  return (
    nombre
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "cliente"
  );
}

function descargarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Cifra({
  label,
  valor,
  esSaldo = false,
}: {
  label: string;
  valor: number;
  esSaldo?: boolean;
}) {
  const color = esSaldo
    ? valor > UMBRAL_DEUDA
      ? "text-red-600"
      : valor < -UMBRAL_DEUDA
        ? "text-green-600"
        : "text-gray-900"
    : "text-gray-900";
  return (
    <div className={`rounded-lg border p-3 ${esSaldo ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{soles(valor)}</p>
    </div>
  );
}

export default function EstadoCuentaModal({
  cliente,
  onClose,
}: {
  cliente: ClienteAvicolaConSaldo;
  onClose: () => void;
}) {
  const [ficha, setFicha] = useState<FichaClienteAvicola | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [conPrecio, setConPrecio] = useState(true);
  const [generando, setGenerando] = useState<"whatsapp" | "descarga" | null>(null);

  useEffect(() => {
    let activo = true;
    const cargar = async () => {
      try {
        const res = await fetch(`/api/avicola/clientes/${cliente.id}`);
        if (!res.ok) throw new Error(`Estado ${res.status}`);
        const data: FichaClienteAvicola = await res.json();
        if (activo) setFicha(data);
      } catch (err) {
        console.error("Error al cargar el estado de cuenta:", err);
        if (activo) setError("No se pudo cargar el estado de cuenta. Revisa tu conexión e intenta de nuevo.");
      } finally {
        if (activo) setCargando(false);
      }
    };
    cargar();
    return () => {
      activo = false;
    };
  }, [cliente.id]);

  const datos = ficha?.cliente ?? cliente;

  // Libro mayor por día del período elegido (misma lógica que el PDF).
  const estado = useMemo(
    () => construirEstadoCuenta(datos, ficha?.historial ?? [], desde || null, hasta || null),
    [datos, ficha, desde, hasta]
  );
  // Para mostrarlo DESC (lo más reciente arriba) en pantalla.
  const diasDesc = useMemo(() => [...estado.dias].reverse(), [estado]);

  const nombreArchivo = `estado-cuenta-${slugNombre(cliente.nombre)}.pdf`;

  const generarPdf = async (): Promise<Blob | null> => {
    if (!ficha) return null;
    const { generarPdfEstadoCuenta } = await import("@/lib/reportes/pdf-estado-cuenta-avicola");
    return generarPdfEstadoCuenta(ficha.cliente, ficha.historial, {
      desde: desde || null,
      hasta: hasta || null,
      conPrecio,
    });
  };

  const enviarWhatsApp = async () => {
    if (!ficha || generando) return;
    setGenerando("whatsapp");
    try {
      const blob = await generarPdf();
      if (!blob) return;
      const file = new File([blob], nombreArchivo, { type: "application/pdf" });
      if (navigator.share && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Estado de cuenta — ${cliente.nombre.trim()}`,
            text: `Estado de cuenta de ${cliente.nombre.trim()} (${datos.empresa})`,
          });
        } catch (err) {
          if ((err as Error).name !== "AbortError") console.error("Error al compartir:", err);
        }
      } else {
        descargarBlob(blob, nombreArchivo);
      }
    } catch (err) {
      console.error("Error al generar el PDF:", err);
      alert("No se pudo generar el PDF. Intenta de nuevo.");
    } finally {
      setGenerando(null);
    }
  };

  const descargarPdf = async () => {
    if (!ficha || generando) return;
    setGenerando("descarga");
    try {
      const blob = await generarPdf();
      if (blob) descargarBlob(blob, nombreArchivo);
    } catch (err) {
      console.error("Error al generar el PDF:", err);
      alert("No se pudo generar el PDF. Intenta de nuevo.");
    } finally {
      setGenerando(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-lg relative max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky */}
        <div className="sticky top-0 z-10 bg-white px-6 pt-5 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-800">Estado de cuenta</h2>
            <button onClick={onClose} aria-label="Cerrar" className="text-gray-500 hover:text-gray-800">
              <FiX size={24} />
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-0.5 truncate">
            {datos.nombre.trim()} — {datos.mercado}
            {datos.numero_puesto ? ` · ${datos.numero_puesto}` : ""}
          </p>
        </div>

        <div className="px-6 pb-6 pt-4">
          {/* Resumen general 2×2 */}
          <div className="grid grid-cols-2 gap-3">
            <Cifra label="Saldo anterior" valor={datos.saldo_anterior} />
            <Cifra label="Total vendido" valor={datos.total_vendido} />
            <Cifra label="Total abonado" valor={datos.total_abonado} />
            <Cifra label="Saldo pendiente" valor={datos.saldo_actual} esSaldo />
          </div>

          {/* Filtro por período + con/sin precio */}
          <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Desde</span>
                <input
                  type="date"
                  value={desde}
                  max={hasta || undefined}
                  onChange={(e) => setDesde(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Hasta</span>
                <input
                  type="date"
                  value={hasta}
                  min={desde || undefined}
                  onChange={(e) => setHasta(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2">
              {(desde || hasta) && (
                <button
                  onClick={() => {
                    setDesde("");
                    setHasta("");
                  }}
                  className="text-xs font-semibold text-gray-500 hover:text-gray-700 underline"
                >
                  Ver todo
                </button>
              )}
              <div className="ml-auto inline-flex rounded-full border border-gray-300 p-0.5 bg-white">
                <button
                  onClick={() => setConPrecio(true)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    conPrecio ? "bg-red-600 text-white" : "text-gray-600"
                  }`}
                >
                  Con precio
                </button>
                <button
                  onClick={() => setConPrecio(false)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                    !conPrecio ? "bg-red-600 text-white" : "text-gray-600"
                  }`}
                >
                  Sin precio
                </button>
              </div>
            </div>
          </div>

          {/* Libro mayor por día */}
          <h3 className="mt-5 text-sm font-semibold text-gray-700">Movimientos por día</h3>
          {cargando ? (
            <div className="min-h-[140px] flex flex-col justify-center items-center text-gray-500">
              <FiLoader className="animate-spin text-red-600" size={32} />
              <p className="mt-2 text-sm">Cargando movimientos…</p>
            </div>
          ) : error ? (
            <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-md p-3">{error}</p>
          ) : diasDesc.length === 0 ? (
            <p className="mt-2 p-4 text-sm text-gray-500 text-center border border-gray-100 rounded-lg">
              Sin movimientos en este período.
            </p>
          ) : (
            <div className="mt-2 max-h-[40vh] overflow-y-auto space-y-2 pr-0.5">
              {diasDesc.map((d) => (
                <div key={d.fecha} className="rounded-xl border border-gray-100 bg-white p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-bold text-gray-800">{fechaCorta(d.fecha)}</p>
                    <p className="text-xs text-gray-400">
                      {d.guias.length > 0 ? d.guias.map((g) => `Guía ${g}`).join(", ") : "Solo abono"}
                    </p>
                  </div>
                  {d.items.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {d.items.map((it) => (
                        <li key={it.id} className="flex items-baseline justify-between gap-3 text-sm text-gray-700">
                          <span className="min-w-0">
                            {it.producto_nombre}
                            <span className="text-gray-400">
                              {" — "}
                              {kg(it.peso_kg)} kg
                              {conPrecio ? ` × ${soles(it.precio_kg)}` : ""}
                            </span>
                          </span>
                          <span className="font-semibold whitespace-nowrap">{soles(it.subtotal)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-gray-400">Venta del día</p>
                      <p className="font-bold text-gray-800">{d.hay_venta ? soles(d.venta_del_dia) : "—"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Abonos</p>
                      <p className="font-bold text-green-600">{d.hay_abono ? `− ${soles(d.abonos_del_dia)}` : "—"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-400">Saldo</p>
                      <p className="font-bold text-gray-900">{soles(d.saldo_actual)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Totales del período */}
          {!cargando && !error && (
            <div className="mt-4 rounded-xl border-2 border-red-200 bg-red-50/60 p-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total vendido del período</span>
                <span className="font-bold text-gray-900">{soles(estado.total_vendido)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total abonado del período</span>
                <span className="font-bold text-green-600">{soles(estado.total_abonado)}</span>
              </div>
              <div className="flex justify-between items-center border-t border-red-200 pt-1.5">
                <span className="text-sm font-black text-gray-900">Saldo pendiente final</span>
                <span className="text-lg font-black text-red-600">{soles(estado.saldo_final)}</span>
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={enviarWhatsApp}
              disabled={!ficha || generando !== null}
              className="flex-1 bg-green-500 text-white font-bold py-3 px-4 rounded-md hover:bg-green-600 transition-colors flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {generando === "whatsapp" ? <FiLoader className="animate-spin mr-2" /> : <FiShare2 className="mr-2" />}
              Enviar por WhatsApp
            </button>
            <button
              onClick={descargarPdf}
              disabled={!ficha || generando !== null}
              className="flex-1 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {generando === "descarga" ? <FiLoader className="animate-spin mr-2" /> : <FiDownload className="mr-2" />}
              Descargar PDF
            </button>
          </div>
          <p className="mt-2 text-[11px] text-gray-400 text-center">
            El PDF usa el período y la opción de precio elegidos, y no incluye movimientos anulados.
          </p>
        </div>
      </div>
    </div>
  );
}
