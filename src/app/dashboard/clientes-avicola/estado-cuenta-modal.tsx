// src/app/dashboard/clientes-avicola/estado-cuenta-modal.tsx
// Modal de ESTADO DE CUENTA del cliente avícola (req. §12): resumen (2×2),
// chips de rango, lista de movimientos y envío por WhatsApp / descarga en PDF.
// El PDF (src/lib/reportes/pdf-estado-cuenta-avicola.ts) EXCLUYE los anulados;
// la lista en pantalla SÍ los muestra (tachados) para auditoría.
"use client";

import { useEffect, useMemo, useState } from "react";
import { FiDownload, FiLoader, FiShare2, FiX } from "react-icons/fi";
import type {
  ClienteAvicolaConSaldo,
  FichaClienteAvicola,
  MovimientoAvicola,
} from "@/lib/avicola/types";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/avicola/types";
import { UMBRAL_DEUDA } from "@/lib/avicola/saldos";

type Rango = "todo" | "30d";

const RANGOS: { id: Rango; label: string }[] = [
  { id: "todo", label: "Todo" },
  { id: "30d", label: "Últimos 30 días" },
];

function soles(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2026-07-07" → "07/07/2026" (sin pasar por Date: evita el corrimiento UTC). */
function fechaCorta(fecha: string): string {
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** YYYY-MM-DD de hace `dias` días en zona Lima (chip "Últimos 30 días"). */
function fechaLimaHace(dias: number): string {
  const hoyLima = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
  }).format(new Date());
  const d = new Date(`${hoyLima}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
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

/** Patrón descargarBlob de src/lib/descargar-comprobante.ts (no exportado allá). */
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

function detalleMovimiento(mov: MovimientoAvicola): string {
  if (mov.tipo === "venta") return `Venta · Guía N.º ${mov.numero_guia ?? "—"}`;
  const medio = mov.medio_pago ? ETIQUETA_MEDIO_PAGO[mov.medio_pago] : "—";
  return `Abono · ${medio}`;
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
    <div
      className={`rounded-lg border p-3 ${
        esSaldo ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </p>
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
  const [rango, setRango] = useState<Rango>("todo");
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
        if (activo) {
          setError("No se pudo cargar el estado de cuenta. Revisa tu conexión e intenta de nuevo.");
        }
      } finally {
        if (activo) setCargando(false);
      }
    };
    cargar();
    return () => {
      activo = false;
    };
  }, [cliente.id]);

  // Cifras: usa la ficha fresca del servidor; mientras carga, las de la lista.
  const datos = ficha?.cliente ?? cliente;

  // Historial del rango elegido, DESC para la lista en pantalla.
  // (El PDF recibe este mismo arreglo y lo reordena ASC internamente.)
  const historialFiltrado = useMemo(() => {
    const base = ficha?.historial ?? [];
    const corte = rango === "30d" ? fechaLimaHace(30) : null;
    const filtrado = corte
      ? base.filter((m) => m.fecha.slice(0, 10) >= corte)
      : base;
    return [...filtrado].sort((a, b) =>
      a.fecha === b.fecha
        ? b.created_at.localeCompare(a.created_at)
        : b.fecha.localeCompare(a.fecha)
    );
  }, [ficha, rango]);

  const nombreArchivo = `estado-cuenta-${slugNombre(cliente.nombre)}.pdf`;

  const generarPdf = async (): Promise<Blob | null> => {
    if (!ficha) return null;
    const { generarPdfEstadoCuenta } = await import(
      "@/lib/reportes/pdf-estado-cuenta-avicola"
    );
    // La función del PDF ya excluye los anulados del saldo corrido.
    return generarPdfEstadoCuenta(ficha.cliente, historialFiltrado);
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
          if ((err as Error).name !== "AbortError") {
            console.error("Error al compartir:", err);
          }
        }
      } else {
        // Sin Web Share (PC): se descarga para adjuntarlo a mano en WhatsApp.
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
    <div
      className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-lg relative max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky: el botón X queda SIEMPRE visible aunque haya scroll. */}
        <div className="sticky top-0 z-10 bg-white px-6 pt-5 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-800">Estado de cuenta</h2>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="text-gray-500 hover:text-gray-800"
            >
              <FiX size={24} />
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-0.5 truncate">
            {datos.nombre.trim()} — {datos.mercado}
            {datos.numero_puesto ? ` · ${datos.numero_puesto}` : ""}
          </p>
        </div>

        <div className="px-6 pb-6 pt-4">
          {/* Resumen 2×2 */}
          <div className="grid grid-cols-2 gap-3">
            <Cifra label="Saldo anterior" valor={datos.saldo_anterior} />
            <Cifra label="Total vendido" valor={datos.total_vendido} />
            <Cifra label="Total abonado" valor={datos.total_abonado} />
            <Cifra label="Saldo pendiente" valor={datos.saldo_actual} esSaldo />
          </div>

          {/* Chips de rango */}
          <div className="mt-5 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-700">Movimientos</h3>
            <div className="flex gap-1.5">
              {RANGOS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRango(r.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    rango === r.id
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lista de movimientos */}
          {cargando ? (
            <div className="min-h-[160px] flex flex-col justify-center items-center text-gray-500">
              <FiLoader className="animate-spin text-red-600" size={32} />
              <p className="mt-2 text-sm">Cargando movimientos…</p>
            </div>
          ) : error ? (
            <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-md p-3">
              {error}
            </p>
          ) : (
            <ul className="mt-2 max-h-[38vh] overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {historialFiltrado.length === 0 && (
                <li className="p-4 text-sm text-gray-500 text-center">
                  Sin movimientos en este rango.
                </li>
              )}
              {historialFiltrado.map((m) => {
                const esVenta = m.tipo === "venta";
                return (
                  <li
                    key={`${m.tipo}-${m.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <span
                          className={
                            m.anulado
                              ? "line-through text-gray-400"
                              : "text-gray-800"
                          }
                        >
                          {detalleMovimiento(m)}
                        </span>
                        {m.anulado && (
                          <span
                            className="ml-2 inline-block align-middle text-[10px] font-semibold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full"
                            title={m.anulacion_motivo ?? undefined}
                          >
                            Anulado
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400">{fechaCorta(m.fecha)}</p>
                    </div>
                    <p
                      className={`text-sm font-bold whitespace-nowrap ${
                        m.anulado
                          ? "line-through text-gray-400"
                          : esVenta
                            ? "text-red-600"
                            : "text-green-600"
                      }`}
                    >
                      {esVenta ? "+" : "−"} {soles(m.monto)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Acciones */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={enviarWhatsApp}
              disabled={!ficha || generando !== null}
              className="flex-1 bg-green-500 text-white font-bold py-3 px-4 rounded-md hover:bg-green-600 transition-colors flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {generando === "whatsapp" ? (
                <FiLoader className="animate-spin mr-2" />
              ) : (
                <FiShare2 className="mr-2" />
              )}
              Enviar por WhatsApp
            </button>
            <button
              onClick={descargarPdf}
              disabled={!ficha || generando !== null}
              className="flex-1 bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {generando === "descarga" ? (
                <FiLoader className="animate-spin mr-2" />
              ) : (
                <FiDownload className="mr-2" />
              )}
              Descargar PDF
            </button>
          </div>
          <p className="mt-2 text-[11px] text-gray-400 text-center">
            El PDF usa el rango elegido y no incluye los movimientos anulados.
          </p>
        </div>
      </div>
    </div>
  );
}
