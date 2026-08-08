"use client";

// src/app/dashboard/clientes-planta/estado-cuenta-planta-modal.tsx
// Estado de cuenta del cliente de PLANTA: libro por día con filtro de período,
// toggle con/sin precio, y envío por WhatsApp o descarga del PDF.
// Espejo de clientes-avicola/estado-cuenta-modal.tsx (color violeta 🏭).
//
// La aritmética NO vive acá: viene de construirEstadoCuentaPlanta (fuente única
// compartida con el PDF), para que pantalla y documento nunca discrepen.

import { useEffect, useMemo, useState } from "react";
import { FiDownload, FiLoader, FiShare2, FiX } from "react-icons/fi";
import {
  ETIQUETA_MEDIO_PAGO_PLANTA,
  type ClientePlantaConSaldo,
  type FichaClientePlanta,
} from "@/lib/planta/types";
import { UMBRAL_DEUDA_PLANTA } from "@/lib/planta/saldos";
import { construirEstadoCuentaPlanta } from "@/lib/planta/estado-cuenta";

const fmtSoles = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const cantidad = (n: number) => n.toLocaleString("es-PE", { maximumFractionDigits: 2 });

function fechaCorta(fecha: string): string {
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function horaCorta(createdAt: string): string {
  const d = new Date(createdAt.includes("T") ? createdAt : createdAt.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** "Cabezón Acopio" → "cabezon-acopio" (para el nombre del archivo). */
function slugNombre(nombre: string): string {
  return (
    nombre
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "cliente"
  );
}

function descargarBlob(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nombre;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
  const color = !esSaldo
    ? "text-gray-900"
    : valor > UMBRAL_DEUDA_PLANTA
      ? "text-red-600"
      : valor < -UMBRAL_DEUDA_PLANTA
        ? "text-green-600"
        : "text-gray-900";
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-base font-black tabular-nums ${color}`}>{fmtSoles(valor)}</p>
    </div>
  );
}

interface Props {
  cliente: ClientePlantaConSaldo;
  onClose: () => void;
}

export default function EstadoCuentaPlantaModal({ cliente, onClose }: Props) {
  const [ficha, setFicha] = useState<FichaClientePlanta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [conPrecio, setConPrecio] = useState(true);
  const [generando, setGenerando] = useState<"whatsapp" | "descarga" | null>(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const res = await fetch(`/api/clientes-planta/${cliente.id}`);
        if (!res.ok) throw new Error(`Estado ${res.status}`);
        const data: FichaClientePlanta = await res.json();
        if (activo) setFicha(data);
      } catch (err) {
        console.error("Error al cargar el estado de cuenta:", err);
        if (activo) setError("No se pudo cargar el estado de cuenta.");
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => {
      activo = false;
    };
  }, [cliente.id]);

  const datos = ficha?.cliente ?? cliente;
  const estado = useMemo(
    () =>
      construirEstadoCuentaPlanta(
        datos,
        ficha?.historial ?? [],
        desde || null,
        hasta || null
      ),
    [datos, ficha, desde, hasta]
  );
  const diasDesc = useMemo(() => [...estado.dias].reverse(), [estado]);
  const nombreArchivo = `estado-cuenta-${slugNombre(cliente.nombre)}.pdf`;

  const generarPdf = async (): Promise<Blob | null> => {
    if (!ficha) return null;
    const { generarPdfEstadoCuentaPlanta } = await import(
      "@/lib/reportes/pdf-estado-cuenta-planta"
    );
    return generarPdfEstadoCuentaPlanta(ficha.cliente, ficha.historial, {
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
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Estado de cuenta — ${cliente.nombre.trim()}`,
            text: `Estado de cuenta de ${cliente.nombre.trim()} (${datos.empresa})`,
          });
        } catch (err) {
          // Cancelar el diálogo de compartir no es un error.
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

  const descargar = async () => {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-100 bg-white px-5 pb-3 pt-5">
          <div>
            <h2 className="text-xl font-black text-gray-900">Estado de cuenta</h2>
            <p className="text-sm text-gray-500">
              {cliente.nombre}
              {cliente.razon_social ? ` — ${cliente.razon_social}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1 text-gray-500 hover:text-gray-800"
          >
            <FiX size={24} />
          </button>
        </div>

        <div className="px-5 pb-6 pt-4">
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-2">
            <Cifra label="Saldo anterior" valor={datos.saldo_anterior} />
            <Cifra label="Vendido a crédito" valor={datos.total_deuda} />
            <Cifra label="Total abonado" valor={datos.total_abonado} />
            <Cifra label="Saldo pendiente" valor={datos.saldo_actual} esSaldo />
          </div>
          {datos.total_contado > UMBRAL_DEUDA_PLANTA && (
            <p className="mt-2 text-xs text-gray-500">
              Además compró {fmtSoles(datos.total_contado)} al contado (ya pagado, no suma a la
              deuda).
            </p>
          )}

          {/* Período + toggle */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Desde
                </span>
                <input
                  type="date"
                  value={desde}
                  max={hasta || undefined}
                  onChange={(e) => setDesde(e.target.value)}
                  className="min-h-10 w-full rounded-lg border border-gray-300 px-2 text-sm"
                />
              </label>
              <label className="flex-1">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  Hasta
                </span>
                <input
                  type="date"
                  value={hasta}
                  min={desde || undefined}
                  onChange={(e) => setHasta(e.target.value)}
                  className="min-h-10 w-full rounded-lg border border-gray-300 px-2 text-sm"
                />
              </label>
              {(desde || hasta) && (
                <button
                  type="button"
                  onClick={() => {
                    setDesde("");
                    setHasta("");
                  }}
                  className="min-h-10 whitespace-nowrap rounded-lg border border-gray-300 px-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Ver todo
                </button>
              )}
            </div>
            <div className="inline-flex rounded-full border border-gray-300 p-0.5">
              <button
                type="button"
                onClick={() => setConPrecio(true)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${conPrecio ? "bg-violet-600 text-white" : "text-gray-600"}`}
              >
                Con precio
              </button>
              <button
                type="button"
                onClick={() => setConPrecio(false)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${!conPrecio ? "bg-violet-600 text-white" : "text-gray-600"}`}
              >
                Sin precio
              </button>
            </div>
          </div>

          {/* Libro por día */}
          <h3 className="mt-5 text-sm font-bold text-gray-700">Movimientos por día</h3>
          {cargando ? (
            <div className="py-10 text-center">
              <FiLoader className="mx-auto animate-spin text-violet-600" size={32} />
            </div>
          ) : error ? (
            <p className="rounded-xl bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>
          ) : diasDesc.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              Sin movimientos en este período.
            </p>
          ) : (
            <ul className="mt-2 max-h-[40vh] space-y-2 overflow-y-auto">
              {diasDesc.map((d) => (
                <li key={d.fecha} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex items-baseline justify-between">
                    <p className="font-bold text-gray-900">{fechaCorta(d.fecha)}</p>
                    <p className="text-[11px] font-semibold uppercase text-gray-400">
                      {d.venta_credito > 0 && "Crédito"}
                      {d.venta_credito > 0 && d.venta_contado > 0 && " + "}
                      {d.venta_contado > 0 && "Contado"}
                      {d.hay_abono && (d.hay_venta ? " + Abono" : "Abono")}
                    </p>
                  </div>
                  {d.items.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-xs text-gray-600">
                      {d.items.map((it, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span>
                            {it.producto_nombre} — {cantidad(it.cantidad)}{" "}
                            {(it.unidad || "uni").toLowerCase()}
                            {conPrecio ? ` × ${fmtSoles(it.precio_unitario)}` : ""}
                          </span>
                          <span className="whitespace-nowrap font-semibold text-gray-800">
                            {fmtSoles(it.subtotal)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2 text-xs">
                    <div>
                      <p className="text-gray-500">A crédito</p>
                      <p className="font-bold text-gray-900">{fmtSoles(d.venta_credito)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Abonos</p>
                      <p className="font-bold text-green-600">
                        {d.abonos_del_dia > 0 ? `− ${fmtSoles(d.abonos_del_dia)}` : "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-500">Saldo</p>
                      <p className="font-black text-gray-900">{fmtSoles(d.saldo_actual)}</p>
                    </div>
                  </div>
                  {d.abonos.length > 0 && (
                    <div className="mt-2 rounded-lg bg-green-50 p-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-green-700">
                        Abonos separados
                      </p>
                      <ul className="mt-1 space-y-1">
                        {d.abonos.map((a) => (
                          <li key={a.id} className="flex justify-between gap-2 text-xs">
                            <span className="text-gray-700">
                              {horaCorta(a.created_at)}
                              {a.medio_pago
                                ? ` · ${ETIQUETA_MEDIO_PAGO_PLANTA[a.medio_pago]}`
                                : ""}
                              {a.observaciones ? ` · ${a.observaciones}` : ""}
                              <span className="block text-[10px] text-gray-500">
                                Saldo después: {fmtSoles(a.saldo_posterior)}
                              </span>
                            </span>
                            <span className="whitespace-nowrap font-bold text-green-700">
                              − {fmtSoles(a.monto)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Totales del período */}
          {!cargando && !error && (
            <div className="mt-4 rounded-xl border-2 border-violet-200 bg-violet-50/60 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Vendido a crédito</span>
                <span className="font-bold text-gray-900">{fmtSoles(estado.total_credito)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total abonado</span>
                <span className="font-bold text-green-600">{fmtSoles(estado.total_abonado)}</span>
              </div>
              {estado.total_contado > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Comprado al contado (ya pagado)</span>
                  <span className="font-semibold text-gray-600">
                    {fmtSoles(estado.total_contado)}
                  </span>
                </div>
              )}
              <div className="mt-1.5 flex items-center justify-between border-t border-violet-200 pt-1.5">
                <span className="font-bold text-gray-800">Saldo pendiente final</span>
                <span className="text-lg font-black text-violet-700">
                  {fmtSoles(estado.saldo_final)}
                </span>
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={enviarWhatsApp}
              disabled={!ficha || generando !== null}
              className="flex flex-1 min-h-12 items-center justify-center gap-2 rounded-lg bg-green-500 px-4 font-bold text-white transition hover:bg-green-600 disabled:opacity-50"
            >
              {generando === "whatsapp" ? (
                <FiLoader className="animate-spin" size={18} />
              ) : (
                <FiShare2 size={18} />
              )}
              Enviar por WhatsApp
            </button>
            <button
              onClick={descargar}
              disabled={!ficha || generando !== null}
              className="flex flex-1 min-h-12 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 font-bold text-white transition hover:bg-violet-700 disabled:opacity-50"
            >
              {generando === "descarga" ? (
                <FiLoader className="animate-spin" size={18} />
              ) : (
                <FiDownload size={18} />
              )}
              Descargar PDF
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-gray-400">
            El PDF usa el período y la opción de precio elegidos, y no incluye movimientos anulados.
          </p>
        </div>
      </div>
    </div>
  );
}
