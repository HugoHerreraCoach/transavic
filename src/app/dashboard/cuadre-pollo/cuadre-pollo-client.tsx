// src/app/dashboard/cuadre-pollo/cuadre-pollo-client.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  FiLoader,
  FiSave,
  FiFileText,
  FiCopy,
  FiAlertTriangle,
  FiCheckCircle,
  FiTruck,
  FiInfo,
} from "react-icons/fi";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";
import { toLocalDateString } from "@/lib/utils";

interface LineaProveedor {
  proveedor: string;
  jabas: number;
  bruto: number;
  tara: number;
  neto: number;
  esVivo: boolean;
  esDevolucion: boolean;
}

interface Cuadre {
  fecha: string;
  proveedores: LineaProveedor[];
  jabas: number;
  kgBruto: number;
  kgTara: number;
  kgNetoIngresado: number;
  guiasCompra: number;
  avesMacho: number;
  avesHembra: number;
  avesTotal: number;
  avesManuales: boolean;
  kgCampo: number;
  kgPlanta: number;
  kgCorte: number;
  kgCorteEspecial: number;
  kgPolloEntero: number;
  kgSalidaCorte: number;
  kgTotalSalida: number;
  mermaReal: number;
  mermaEsperada: number;
  diferencia: number;
  mermaPorAve: number | null;
  mermaPct: number;
  mermaAlta: boolean;
  tolerancia: number;
  cuadra: boolean;
  kgFacturadoAsesoras: number;
  diferenciaDelivery: number;
  usoFacturadoComoSalida: boolean;
  observaciones: string | null;
  parametros: { merma_estandar_ave_kg: number; merma_alta_pct: number };
}

const kg = (n: number): string =>
  `${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;

const fechaLarga = (iso: string): string => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

/** Los inputs viven como texto para que se puedan vaciar sin que salte un 0. */
type Manual = {
  aves_macho: string;
  aves_hembra: string;
  kg_corte: string;
  kg_corte_especial: string;
  kg_pollo_entero: string;
  observaciones: string;
};

const MANUAL_VACIO: Manual = {
  aves_macho: "",
  aves_hembra: "",
  kg_corte: "",
  kg_corte_especial: "",
  kg_pollo_entero: "",
  observaciones: "",
};

export default function CuadrePolloClient() {
  const hoy = toLocalDateString(new Date());
  const [fecha, setFecha] = useState(hoy);
  const [data, setData] = useState<Cuadre | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [manual, setManual] = useState<Manual>(MANUAL_VACIO);
  const { mostrarToast, toasts } = useToast();

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/cuadre-pollo?fecha=${fecha}`);
      if (!res.ok) throw new Error("No se pudo cargar el cuadre.");
      const d: Cuadre = await res.json();
      setData(d);
      // El formulario refleja lo guardado del día; 0 se muestra vacío.
      const t = (n: number) => (n ? String(n) : "");
      setManual({
        aves_macho: d.avesManuales ? t(d.avesMacho) : "",
        aves_hembra: d.avesManuales ? t(d.avesHembra) : "",
        kg_corte: t(d.kgCorte),
        kg_corte_especial: t(d.kgCorteEspecial),
        kg_pollo_entero: t(d.kgPolloEntero),
        observaciones: d.observaciones ?? "",
      });
    } catch (error) {
      mostrarToast(error instanceof Error ? error.message : "Error al cargar.", "error");
      setData(null);
    } finally {
      setCargando(false);
    }
    // mostrarToast es estable en el hook; no se incluye para no re-disparar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const guardar = async () => {
    setGuardando(true);
    try {
      const res = await fetch("/api/cuadre-pollo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha,
          aves_macho: Math.trunc(Number(manual.aves_macho) || 0),
          aves_hembra: Math.trunc(Number(manual.aves_hembra) || 0),
          kg_corte: Number(manual.kg_corte) || 0,
          kg_corte_especial: Number(manual.kg_corte_especial) || 0,
          kg_pollo_entero: Number(manual.kg_pollo_entero) || 0,
          observaciones: manual.observaciones.trim() || null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(typeof e?.error === "string" ? e.error : "No se pudo guardar.");
      }
      setData(await res.json());
      mostrarToast("Cuadre guardado.", "exito");
    } catch (error) {
      mostrarToast(error instanceof Error ? error.message : "No se pudo guardar.", "error");
    } finally {
      setGuardando(false);
    }
  };

  const copiarResumen = async () => {
    if (!data) return;
    const signo = (n: number) => (n >= 0 ? "+" : "");
    const texto = [
      `*CUADRE DE POLLO* — ${fechaLarga(data.fecha)}`,
      "",
      `Entró (neto):  ${kg(data.kgNetoIngresado)}  (${data.jabas} jabas)`,
      `Salió (total): ${kg(data.kgTotalSalida)}`,
      `  · Campo:   ${kg(data.kgCampo)}`,
      `  · Planta:  ${kg(data.kgPlanta)}`,
      `  · Delivery: ${kg(data.usoFacturadoComoSalida ? data.kgFacturadoAsesoras : data.kgSalidaCorte)}`,
      "",
      `Merma real:     ${kg(data.mermaReal)} (${data.mermaPct.toFixed(1)}%)`,
      `Merma esperada: ${kg(data.mermaEsperada)} (${data.avesTotal} aves)`,
      `DIFERENCIA:     ${signo(data.diferencia)}${kg(data.diferencia)}`,
      data.cuadra
        ? "✅ La merma estuvo dentro de lo normal."
        : "⚠️ Se perdió más peso del esperado.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      mostrarToast("Resumen copiado. Ya lo puedes pegar en WhatsApp.", "exito");
    } catch {
      mostrarToast("No se pudo copiar.", "error");
    }
  };

  const exportarPDF = async () => {
    if (!data) return;
    setExportando(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = 210;
      const centro = W / 2;

      doc.setFillColor(220, 38, 38);
      doc.rect(0, 0, W, 12, "F");

      doc.setTextColor(220, 38, 38);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("TRANSAVIC & LA AVÍCOLA DE TONY", centro, 23, { align: "center" });

      doc.setTextColor(31, 41, 55);
      doc.setFontSize(16);
      doc.text("Cuadre de Pollo — Merma del día", centro, 31, { align: "center" });

      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(fechaLarga(data.fecha), centro, 37, { align: "center" });

      doc.setDrawColor(229, 231, 235);
      doc.line(15, 42, W - 15, 42);

      let y = 51;
      const fila = (etiqueta: string, valor: string, negrita = false) => {
        doc.setFont("helvetica", negrita ? "bold" : "normal");
        doc.setFontSize(negrita ? 10.5 : 10);
        doc.setTextColor(negrita ? 31 : 75, negrita ? 41 : 85, negrita ? 55 : 99);
        doc.text(etiqueta, 18, y);
        doc.text(valor, W - 18, y, { align: "right" });
        y += 7;
      };
      const titulo = (t: string) => {
        y += 3;
        doc.setFillColor(243, 244, 246);
        doc.rect(15, y - 5, W - 30, 8, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(55, 65, 81);
        doc.text(t.toUpperCase(), 18, y);
        y += 9;
      };

      titulo("Entró — compra de pollo vivo");
      data.proveedores.forEach((p) => {
        const etiqueta = p.esDevolucion
          ? " · devolución"
          : p.esVivo
            ? ""
            : " · corte comprado";
        fila(`${p.proveedor}${p.jabas ? ` (${p.jabas} jabas)` : ""}${etiqueta}`, kg(p.neto));
      });
      fila("Total neto ingresado", kg(data.kgNetoIngresado), true);
      fila("Aves", `${data.avesTotal} (${data.avesMacho} machos / ${data.avesHembra} hembras)`);

      titulo("Salió");
      fila("Venta en Campo", kg(data.kgCampo));
      fila("Venta en Planta", kg(data.kgPlanta));
      if (data.usoFacturadoComoSalida) {
        fila("Delivery (facturado por asesoras)", kg(data.kgFacturadoAsesoras));
      } else {
        fila("Corte", kg(data.kgCorte));
        fila("Corte especial", kg(data.kgCorteEspecial));
        fila("Pollo entero a delivery", kg(data.kgPolloEntero));
      }
      fila("Total salida", kg(data.kgTotalSalida), true);

      titulo("Cuadre");
      fila("Merma real", `${kg(data.mermaReal)}  (${data.mermaPct.toFixed(1)}%)`);
      fila(
        "Merma esperada",
        `${kg(data.mermaEsperada)}  (${data.avesTotal} aves × ${data.parametros.merma_estandar_ave_kg} kg)`
      );
      if (!data.cuadra) doc.setTextColor(185, 28, 28);
      else doc.setTextColor(21, 128, 61);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("DIFERENCIA", 18, y);
      doc.text(`${data.diferencia >= 0 ? "+" : ""}${kg(data.diferencia)}`, W - 18, y, {
        align: "right",
      });
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(107, 114, 128);
      doc.text(
        data.cuadra
          ? "La merma estuvo dentro de lo normal."
          : "Se perdió más peso del esperado. Conviene revisar.",
        18,
        y
      );
      y += 5;

      titulo("Control de delivery");
      fila("Salió a corte (planta)", kg(data.kgSalidaCorte));
      fila("Facturado por las asesoras", kg(data.kgFacturadoAsesoras));
      fila("Diferencia", `${data.diferenciaDelivery >= 0 ? "+" : ""}${kg(data.diferenciaDelivery)}`, true);

      if (data.observaciones) {
        titulo("Observaciones");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(75, 85, 99);
        doc.text(doc.splitTextToSize(data.observaciones, W - 36), 18, y);
      }

      doc.save(`cuadre-pollo-${data.fecha}.pdf`);
      mostrarToast("PDF descargado.", "exito");
    } catch {
      mostrarToast("No se pudo generar el PDF.", "error");
    } finally {
      setExportando(false);
    }
  };

  const setCampo = (k: keyof Manual) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setManual((m) => ({ ...m, [k]: e.target.value }));

  const inputNum =
    "w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-right tabular-nums text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500";

  return (
    <div className="space-y-5 pb-16">
      <ToastContainer toasts={toasts} />
      <GuiaModulo modulo="cuadre-pollo" />

      {/* Barra de fecha y acciones */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFecha(hoy)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              fecha === hoy ? "bg-red-600 text-white shadow" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            HOY
          </button>
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
            className="rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800 outline-none focus:border-red-500 cursor-pointer"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={exportarPDF}
            disabled={!data || exportando}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer active:scale-95 flex items-center gap-1.5"
          >
            {exportando ? <FiLoader className="animate-spin" size={14} /> : <FiFileText size={14} />}
            Descargar PDF
          </button>
          <button
            type="button"
            onClick={copiarResumen}
            disabled={!data}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl font-bold text-xs shadow-sm transition-all cursor-pointer active:scale-95 flex items-center gap-1.5"
          >
            <FiCopy size={14} /> Copiar Resumen
          </button>
        </div>
      </div>

      {cargando && (
        <div className="text-center py-16 text-gray-400 animate-pulse font-medium">
          Cargando el cuadre del día…
        </div>
      )}

      {!cargando && data && (
        <>
          {data.guiasCompra === 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
              <FiAlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
              <div className="text-sm text-amber-900">
                <p className="font-bold">
                  No hay guías de compra registradas para {fechaLarga(data.fecha)}.
                </p>
                <p className="mt-0.5 text-amber-800">
                  Sin la compra del día no se puede calcular la merma: no sabemos cuántos kilos
                  entraron.{" "}
                  <Link href="/dashboard/compras" className="font-bold underline">
                    Registrar la compra
                  </Link>
                  .
                </p>
              </div>
            </div>
          )}

          {/* 1. ENTRÓ */}
          <section className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">1. Entró — compra del día</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Sale solo de las guías de compra. Para corregirlo, edita la guía en Compras.
              </p>
            </div>

            {data.proveedores.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-6 py-2.5 text-left font-semibold">Proveedor</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Jabas</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Bruto</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Tara</th>
                      <th className="px-6 py-2.5 text-right font-semibold">Neto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.proveedores.map((p, i) => (
                      <tr
                        key={`${p.proveedor}-${i}`}
                        className={`hover:bg-gray-50/60 ${p.esDevolucion ? "bg-amber-50/40" : ""}`}
                      >
                        <td className="px-6 py-2.5 font-semibold text-gray-800">
                          {p.proveedor}
                          {p.esDevolucion && (
                            <span className="ml-2 text-[10px] font-bold uppercase text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                              devolución
                            </span>
                          )}
                          {!p.esVivo && !p.esDevolucion && (
                            <span className="ml-2 text-[10px] font-bold uppercase text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                              corte comprado
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">
                          {p.jabas || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">
                          {p.bruto ? kg(p.bruto) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">
                          {p.tara ? kg(p.tara) : "—"}
                        </td>
                        <td
                          className={`px-6 py-2.5 text-right tabular-nums font-bold ${
                            p.esDevolucion ? "text-amber-700" : "text-gray-900"
                          }`}
                        >
                          {kg(p.neto)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-bold">
                      <td className="px-6 py-3 text-gray-900">TOTAL</td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-700">{data.jabas}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-700">
                        {kg(data.kgBruto)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-700">
                        {kg(data.kgTara)}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums text-gray-900 text-base">
                        {kg(data.kgNetoIngresado)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-6 py-8 text-center text-sm text-gray-400">
                Sin compras de pollo registradas este día.
              </p>
            )}

            {/* Aves */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">
                    Machos
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    disabled={!data.avesManuales && data.avesTotal > 0}
                    value={
                      !data.avesManuales && data.avesTotal > 0 ? data.avesMacho : manual.aves_macho
                    }
                    onChange={setCampo("aves_macho")}
                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    placeholder="0"
                    className={`${inputNum} w-28 disabled:bg-gray-100 disabled:text-gray-500`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">
                    Hembras
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    disabled={!data.avesManuales && data.avesTotal > 0}
                    value={
                      !data.avesManuales && data.avesTotal > 0 ? data.avesHembra : manual.aves_hembra
                    }
                    onChange={setCampo("aves_hembra")}
                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    placeholder="0"
                    className={`${inputNum} w-28 disabled:bg-gray-100 disabled:text-gray-500`}
                  />
                </div>
                <div className="pb-2">
                  <span className="text-xs text-gray-500">Total de aves: </span>
                  <span className="text-lg font-bold text-gray-900 tabular-nums">
                    {data.avesTotal || Number(manual.aves_macho || 0) + Number(manual.aves_hembra || 0)}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-gray-500 mt-2 flex items-start gap-1.5">
                <FiInfo className="shrink-0 mt-0.5" size={12} />
                {!data.avesManuales && data.avesTotal > 0
                  ? "Las aves vienen del desglose macho/hembra de la guía de compra."
                  : "La guía de compra no trae el desglose macho/hembra, así que se digita aquí. Sin aves no se puede saber cuánta merma era normal."}
              </p>
            </div>
          </section>

          {/* 2. SALIÓ */}
          <section className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">2. Salió — todo lo despachado</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Campo y Planta salen solos del sistema. Los kilos que salieron a picar para delivery
                se digitan del parte de Antonio.
              </p>
            </div>
            <div className="divide-y divide-gray-50">
              <div className="px-6 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">🏪 Venta en Campo</span>
                <span className="text-sm font-bold tabular-nums text-gray-900">{kg(data.kgCampo)}</span>
              </div>
              <div className="px-6 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">🏭 Venta en Planta</span>
                <span className="text-sm font-bold tabular-nums text-gray-900">{kg(data.kgPlanta)}</span>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50/50 border-t border-gray-100 space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                🛵 Lo que salió a picar para delivery
              </p>
              {(
                [
                  ["kg_corte", "Corte"],
                  ["kg_corte_especial", "Corte especial"],
                  ["kg_pollo_entero", "Pollo entero"],
                ] as const
              ).map(([campo, etiqueta]) => (
                <div key={campo} className="flex items-center justify-between gap-4">
                  <label className="text-sm font-semibold text-gray-700">{etiqueta}</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={manual[campo]}
                      onChange={setCampo(campo)}
                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                      placeholder="0.00"
                      className={`${inputNum} w-32`}
                    />
                    <span className="text-xs font-semibold text-gray-500 w-4">kg</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1 border-t border-gray-200">
                <span className="text-sm font-bold text-gray-800">Subtotal a delivery</span>
                <span className="text-sm font-bold tabular-nums text-gray-900 pr-6">
                  {kg(
                    (Number(manual.kg_corte) || 0) +
                      (Number(manual.kg_corte_especial) || 0) +
                      (Number(manual.kg_pollo_entero) || 0)
                  )}
                </span>
              </div>
            </div>

            <div className="px-6 py-3 bg-gray-100 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-900">TOTAL SALIDA</span>
              <span className="text-base font-bold tabular-nums text-gray-900">
                {kg(data.kgTotalSalida)}
              </span>
            </div>

            {data.usoFacturadoComoSalida && (
              <p className="px-6 py-3 text-xs text-amber-800 bg-amber-50 border-t border-amber-100 flex items-start gap-1.5">
                <FiAlertTriangle className="shrink-0 mt-0.5" size={13} />
                Todavía no digitas los kilos que salieron a picar, así que el cuadre está usando lo
                que las asesoras facturaron ({kg(data.kgFacturadoAsesoras)}) como aproximación.
              </p>
            )}
          </section>

          {/* 3. CUADRE */}
          <section
            className={`rounded-3xl border shadow-sm overflow-hidden ${
              data.kgNetoIngresado === 0
                ? "border-gray-100 bg-white"
                : data.cuadra
                  ? "border-green-200 bg-green-50/40"
                  : "border-red-200 bg-red-50/40"
            }`}
          >
            <div className="px-6 py-4 border-b border-gray-100 bg-white">
              <h2 className="text-base font-bold text-gray-900">3. Cuadre de la merma</h2>
            </div>
            <div className="px-6 py-5 space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Entró (neto)</span>
                <span className="font-bold tabular-nums text-gray-900">
                  {kg(data.kgNetoIngresado)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Salió (total)</span>
                <span className="font-bold tabular-nums text-gray-900">{kg(data.kgTotalSalida)}</span>
              </div>
              <div className="border-t border-gray-200 pt-2.5 flex items-center justify-between text-sm">
                <span className="text-gray-700 font-semibold">
                  Merma real{" "}
                  {data.mermaPorAve !== null && (
                    <span className="text-gray-400 font-normal">
                      ({data.mermaPorAve.toFixed(2)} kg por ave)
                    </span>
                  )}
                </span>
                <span
                  className={`font-bold tabular-nums ${
                    data.kgNetoIngresado === 0
                      ? "text-gray-300"
                      : data.mermaAlta
                        ? "text-red-600"
                        : "text-gray-900"
                  }`}
                >
                  {/* Sin compra registrada, "merma real" sería -(todo lo que salió): un
                      número grande y sin sentido. Mejor no mostrarlo. */}
                  {data.kgNetoIngresado === 0
                    ? "—"
                    : `${kg(data.mermaReal)} · ${data.mermaPct.toFixed(1)}%`}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700 font-semibold">
                  Merma esperada{" "}
                  <span className="text-gray-400 font-normal">
                    ({data.avesTotal} aves × {data.parametros.merma_estandar_ave_kg} kg)
                  </span>
                </span>
                <span className="font-bold tabular-nums text-gray-900">{kg(data.mermaEsperada)}</span>
              </div>

              <div className="border-t-2 border-gray-300 pt-3 flex items-center justify-between">
                <span className="text-base font-bold text-gray-900">DIFERENCIA</span>
                <span
                  className={`text-2xl font-bold tabular-nums ${
                    data.kgNetoIngresado === 0
                      ? "text-gray-400"
                      : data.cuadra
                        ? "text-green-700"
                        : "text-red-600"
                  }`}
                >
                  {data.kgNetoIngresado === 0
                    ? "—"
                    : `${data.diferencia >= 0 ? "+" : ""}${kg(data.diferencia)}`}
                </span>
              </div>
              {data.kgNetoIngresado === 0 ? (
                <p className="text-xs font-semibold text-gray-400">
                  Falta registrar la compra del día para poder cuadrar.
                </p>
              ) : data.avesTotal === 0 ? (
                <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                  <FiAlertTriangle size={13} /> Falta ingresar cuántas aves entraron: sin ese dato no
                  se sabe cuánta merma era normal.
                </p>
              ) : (
                <p
                  className={`text-xs font-semibold flex items-center gap-1.5 ${
                    data.cuadra ? "text-green-700" : "text-red-600"
                  }`}
                >
                  {data.cuadra ? (
                    <>
                      <FiCheckCircle size={13} /> La merma estuvo dentro de lo normal (margen de ±
                      {kg(data.tolerancia)}).
                    </>
                  ) : (
                    <>
                      <FiAlertTriangle size={13} /> Se perdió más peso del esperado. Conviene revisar.
                    </>
                  )}
                </p>
              )}
            </div>
          </section>

          {/* 4. CONTROL DE DELIVERY */}
          <section className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <FiTruck size={16} className="text-blue-600" /> 4. Control de delivery
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Compara los kilos que salieron a picar contra los que las asesoras realmente
                facturaron. No entra en el cálculo de la merma.
              </p>
            </div>
            <div className="px-6 py-4 space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Salió a picar (planta)</span>
                <span className="font-bold tabular-nums text-gray-900">{kg(data.kgSalidaCorte)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Facturado por las asesoras</span>
                <span className="font-bold tabular-nums text-gray-900">
                  {kg(data.kgFacturadoAsesoras)}
                </span>
              </div>
              <div className="border-t border-gray-200 pt-2.5 flex items-center justify-between text-sm">
                <span className="font-bold text-gray-800">Diferencia</span>
                <span
                  className={`font-bold tabular-nums ${
                    Math.abs(data.diferenciaDelivery) < 0.01 ? "text-green-700" : "text-gray-900"
                  }`}
                >
                  {data.diferenciaDelivery >= 0 ? "+" : ""}
                  {kg(data.diferenciaDelivery)}
                </span>
              </div>
            </div>
          </section>

          {/* Observaciones + guardar */}
          <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">
                Observaciones del día (opcional)
              </label>
              <textarea
                value={manual.observaciones}
                onChange={(e) => setManual((m) => ({ ...m, observaciones: e.target.value }))}
                rows={2}
                maxLength={1000}
                placeholder="Ej. Llegó una jaba con pollo muerto de Renato."
                className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 resize-none"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={guardar}
                disabled={guardando}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer active:scale-95 flex items-center gap-2"
              >
                {guardando ? <FiLoader className="animate-spin" size={16} /> : <FiSave size={16} />}
                {guardando ? "Guardando…" : "Guardar cuadre del día"}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
