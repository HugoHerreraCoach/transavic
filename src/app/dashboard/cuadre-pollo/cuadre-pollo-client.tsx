// src/app/dashboard/cuadre-pollo/cuadre-pollo-client.tsx
//
// La pantalla imita la HOJA de Excel que Marianela cuadraba a mano: mismo orden,
// mismas etiquetas y misma densidad. Usa el lenguaje visual ya establecido en
// cuadre-mermas-tab.tsx / cartera-asesoras-tab.tsx (membrete, tabla border-collapse,
// tabular-nums, fila de totales, pie "Generado el…").
//
// Su narrativa, respetada al pie de la letra:
//     VENTA + MERMA POLLO = lo que DEBIÓ ENTRAR
//     vs ENTRÓ (proveedores)  →  DIFERENCIA
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  FiLoader,
  FiSave,
  FiFileText,
  FiCopy,
  FiAlertTriangle,
  FiCheckCircle,
  FiInfo,
  FiBox,
} from "react-icons/fi";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";
import { toLocalDateString, formatFechaLarga } from "@/lib/utils";
import { evaluarExpresion } from "@/lib/expresion-numerica";

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
  expresiones: {
    corte: string | null;
    corteEspecial: string | null;
    polloEntero: string | null;
    avesMacho: string | null;
    avesHembra: string | null;
  };
  observaciones: string | null;
  parametros: { merma_estandar_ave_kg: number; merma_alta_pct: number };
}

const nf = (n: number, dec = 2): string =>
  n.toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const kg = (n: number): string => `${nf(n)} kg`;

/** Los campos que la usuaria teclea, como TEXTO (puede ser "62+62.2+62.5"). */
type Manual = {
  corte: string;
  corteEspecial: string;
  polloEntero: string;
  avesMacho: string;
  avesHembra: string;
  observaciones: string;
};

const MANUAL_VACIO: Manual = {
  corte: "",
  corteEspecial: "",
  polloEntero: "",
  avesMacho: "",
  avesHembra: "",
  observaciones: "",
};

/**
 * Celda de captura: acepta el desglose tal como llega el parte de pesos
 * ("62+62.2+62.5…") y muestra el total al costado, como haría Excel.
 */
function CeldaExpresion({
  valor,
  onChange,
  placeholder,
  ancho = "w-56",
  decimales = 2,
  disabled,
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ancho?: string;
  decimales?: number;
  disabled?: boolean;
}) {
  const { valor: total, valida } = evaluarExpresion(valor);
  const hayDesglose = /[+\-*/]/.test(valor.trim());

  return (
    <div className="flex items-center justify-end gap-2">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        title="Puedes escribir las pesadas una por una: 62+62.2+62.5"
        className={`${ancho} rounded-md border px-2 py-1 text-xs text-right tabular-nums outline-none transition-colors disabled:bg-gray-100 disabled:text-gray-400 ${
          valida
            ? "border-amber-300 bg-amber-50/40 text-gray-800 focus:border-amber-500 focus:bg-white"
            : "border-red-400 bg-red-50 text-red-700 focus:border-red-500"
        }`}
      />
      <span
        className={`w-24 text-right text-xs tabular-nums ${
          !valida
            ? "text-red-500 font-semibold"
            : hayDesglose
              ? "text-gray-900 font-bold"
              : "text-gray-300"
        }`}
      >
        {valida ? (hayDesglose ? nf(total, decimales) : "") : "revisar"}
      </span>
    </div>
  );
}

export default function CuadrePolloClient() {
  const hoy = toLocalDateString(new Date());
  const [fecha, setFecha] = useState(hoy);
  const [data, setData] = useState<Cuadre | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [manual, setManual] = useState<Manual>(MANUAL_VACIO);
  const { mostrarToast, toasts } = useToast();

  /** Lo tecleado, ya evaluado. Se recalcula en cada render: es barato. */
  const evaluado = useMemo(() => {
    const e = (t: string) => evaluarExpresion(t);
    return {
      corte: e(manual.corte),
      corteEspecial: e(manual.corteEspecial),
      polloEntero: e(manual.polloEntero),
      avesMacho: e(manual.avesMacho),
      avesHembra: e(manual.avesHembra),
    };
  }, [manual]);

  const hayErrores = Object.values(evaluado).some((r) => !r.valida);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/cuadre-pollo?fecha=${fecha}`);
      if (!res.ok) throw new Error("No se pudo cargar el cuadre.");
      const d: Cuadre = await res.json();
      setData(d);
      // Se precarga el desglose si existe; si no, el número suelto. 0 queda vacío.
      const t = (expr: string | null, num: number) => expr ?? (num ? String(num) : "");
      setManual({
        corte: t(d.expresiones.corte, d.kgCorte),
        corteEspecial: t(d.expresiones.corteEspecial, d.kgCorteEspecial),
        polloEntero: t(d.expresiones.polloEntero, d.kgPolloEntero),
        avesMacho: d.avesManuales ? t(d.expresiones.avesMacho, d.avesMacho) : "",
        avesHembra: d.avesManuales ? t(d.expresiones.avesHembra, d.avesHembra) : "",
        observaciones: d.observaciones ?? "",
      });
    } catch (error) {
      mostrarToast(error instanceof Error ? error.message : "Error al cargar.", "error");
      setData(null);
    } finally {
      setCargando(false);
    }
    // mostrarToast es estable; no se incluye para no re-disparar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const guardar = async () => {
    if (hayErrores) {
      mostrarToast("Hay una operación mal escrita. Revisa las celdas en rojo.", "error");
      return;
    }
    setGuardando(true);
    try {
      const limpio = (t: string) => (t.trim() === "" ? null : t.trim());
      const res = await fetch("/api/cuadre-pollo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha,
          aves_macho: Math.trunc(evaluado.avesMacho.valor),
          aves_hembra: Math.trunc(evaluado.avesHembra.valor),
          kg_corte: evaluado.corte.valor,
          kg_corte_especial: evaluado.corteEspecial.valor,
          kg_pollo_entero: evaluado.polloEntero.valor,
          expr_corte: limpio(manual.corte),
          expr_corte_especial: limpio(manual.corteEspecial),
          expr_pollo_entero: limpio(manual.polloEntero),
          expr_aves_macho: limpio(manual.avesMacho),
          expr_aves_hembra: limpio(manual.avesHembra),
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
      `*CUADRE DE POLLO* — ${formatFechaLarga(data.fecha)}`,
      "",
      `Venta (salida):   ${kg(data.kgTotalSalida)}`,
      `Merma pollo:      ${kg(data.mermaEsperada)}  (${data.avesTotal} aves × ${data.parametros.merma_estandar_ave_kg})`,
      `*Debió entrar:*   ${kg(data.kgTotalSalida + data.mermaEsperada)}`,
      "",
      `Entró (compras):  ${kg(data.kgNetoIngresado)}  (${data.jabas} jabas)`,
      `*DIFERENCIA:*     ${signo(data.diferencia)}${kg(data.diferencia)}`,
      "",
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
      const debioEntrar = data.kgTotalSalida + data.mermaEsperada;

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
      doc.text(formatFechaLarga(data.fecha), centro, 37, { align: "center" });
      doc.setDrawColor(229, 231, 235);
      doc.line(15, 42, W - 15, 42);

      let y = 51;
      const fila = (etiqueta: string, valor: string, negrita = false, detalle?: string) => {
        doc.setFont("helvetica", negrita ? "bold" : "normal");
        doc.setFontSize(negrita ? 10.5 : 10);
        doc.setTextColor(negrita ? 31 : 75, negrita ? 41 : 85, negrita ? 55 : 99);
        doc.text(etiqueta, 18, y);
        doc.text(valor, W - 18, y, { align: "right" });

        if (detalle) {
          // El desglose va PEGADO a su etiqueta y con aire antes de la siguiente
          // fila; al revés se lee como si perteneciera a la línea de abajo.
          y += 3.4;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(156, 163, 175);
          const lineas = doc.splitTextToSize(detalle, W - 70) as string[];
          doc.text(lineas, 22, y);
          y += 3.4 * lineas.length + 2.5;
        } else {
          y += 6;
        }
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
      const raya = () => {
        doc.setDrawColor(209, 213, 219);
        doc.line(120, y - 3, W - 18, y - 3);
        y += 1;
      };

      titulo("Salida del día");
      fila("Venta en Campo", kg(data.kgCampo));
      fila("Venta en Planta", kg(data.kgPlanta));
      if (data.usoFacturadoComoSalida) {
        fila("Delivery (facturado por asesoras)", kg(data.kgFacturadoAsesoras));
      } else {
        fila("Corte", kg(data.kgCorte), false, data.expresiones.corte ?? undefined);
        fila(
          "Corte especial",
          kg(data.kgCorteEspecial),
          false,
          data.expresiones.corteEspecial ?? undefined
        );
        fila("Pollo entero", kg(data.kgPolloEntero), false, data.expresiones.polloEntero ?? undefined);
      }
      raya();
      fila("VENTA", kg(data.kgTotalSalida), true);
      fila(
        "MERMA POLLO",
        kg(data.mermaEsperada),
        false,
        `${data.avesTotal} aves × ${data.parametros.merma_estandar_ave_kg} kg`
      );
      raya();
      fila("DEBIÓ ENTRAR", kg(debioEntrar), true);

      titulo("Proveedores");
      data.proveedores.forEach((p) => {
        const etiqueta = p.esDevolucion
          ? " · devolución"
          : p.esVivo
            ? ""
            : " · corte comprado";
        fila(`${p.proveedor}${p.jabas ? ` (${p.jabas} jabas)` : ""}${etiqueta}`, kg(p.neto));
      });
      raya();
      fila("ENTRÓ (neto)", kg(data.kgNetoIngresado), true);

      titulo("Cuadre");
      fila("Debió entrar", kg(debioEntrar));
      fila("Entró", kg(data.kgNetoIngresado));
      if (data.cuadra) doc.setTextColor(21, 128, 61);
      else doc.setTextColor(185, 28, 28);
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
          ? `La merma estuvo dentro de lo normal (margen de ±${kg(data.tolerancia)}).`
          : "Se perdió más peso del esperado. Conviene revisar.",
        18,
        y
      );
      y += 5;

      titulo("Control de delivery");
      fila("Salió a picar (planta)", kg(data.kgSalidaCorte));
      fila("Facturado por las asesoras", kg(data.kgFacturadoAsesoras));
      fila(
        "Diferencia",
        `${data.diferenciaDelivery >= 0 ? "+" : ""}${kg(data.diferenciaDelivery)}`,
        true
      );

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

  const set = (k: keyof Manual) => (v: string) => setManual((m) => ({ ...m, [k]: v }));

  // Totales en vivo: lo que la usuaria teclea manda sobre lo último guardado.
  const salidaCorteViva =
    evaluado.corte.valor + evaluado.corteEspecial.valor + evaluado.polloEntero.valor;
  const avesVivas = Math.trunc(evaluado.avesMacho.valor) + Math.trunc(evaluado.avesHembra.valor);

  // Clases del lenguaje visual de los otros reportes (cuadre-mermas-tab / cartera).
  const thBase =
    "py-2 text-[9px] uppercase font-bold tracking-wider text-gray-400";
  const tdNum = "py-2 text-right tabular-nums";

  return (
    <div className="space-y-4 pb-16">
      <ToastContainer toasts={toasts} />
      <GuiaModulo modulo="cuadre-pollo" />

      {/* Barra de fecha y acciones — fuera de la "hoja" */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-3">
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
        <div className="flex flex-col items-center justify-center py-20">
          <FiLoader className="h-8 w-8 text-red-600 animate-spin mb-2" />
          <span className="text-sm text-gray-500">Calculando el cuadre del día…</span>
        </div>
      )}

      {!cargando && data && (
        <>
          {data.guiasCompra === 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
              <FiAlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
              <div className="text-sm text-amber-900">
                <p className="font-bold">
                  No hay guías de compra registradas para {formatFechaLarga(data.fecha)}.
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

          {/* ───────── LA HOJA ───────── */}
          {/* El scroll horizontal vive en el CONTENEDOR y el ancho mínimo en el
              hijo: al revés, la hoja empuja el layout de toda la página. */}
          <div className="border border-gray-200 rounded-2xl shadow-xs bg-white overflow-x-auto">
            <div className="bg-white p-6 flex flex-col gap-6" style={{ minWidth: "780px" }}>
              {/* Membrete */}
              <div className="flex justify-between items-end border-b border-gray-100 pb-4">
                <div>
                  <h2 className="text-xs font-bold text-red-600 tracking-widest uppercase mb-1">
                    TRANSAVIC &amp; LA AVÍCOLA DE TONY
                  </h2>
                  <h1 className="text-lg font-black text-gray-900 tracking-tight">
                    Cuadre de Pollo
                  </h1>
                  <p className="text-[11px] font-semibold text-gray-500 mt-1 capitalize">
                    {formatFechaLarga(data.fecha)}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  <FiBox /> Cuadre de merma diaria
                </span>
              </div>

              {/* ── SALIDA DEL DÍA ── */}
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className={`${thBase} w-1/3`}>Salida del día</th>
                    <th className={`${thBase} text-right`}>Desglose de pesadas</th>
                    <th className={`${thBase} text-right w-32`}>Kilos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                  <tr>
                    <td className="py-2 font-semibold text-gray-700">🏪 Venta en Campo</td>
                    <td className="py-2 text-right text-[10px] text-gray-400">del sistema</td>
                    <td className={`${tdNum} font-semibold`}>{nf(data.kgCampo)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 font-semibold text-gray-700">🏭 Venta en Planta</td>
                    <td className="py-2 text-right text-[10px] text-gray-400">del sistema</td>
                    <td className={`${tdNum} font-semibold`}>{nf(data.kgPlanta)}</td>
                  </tr>
                  {(
                    [
                      ["corte", "Corte", "62+62.2+62.5…"],
                      ["corteEspecial", "Corte especial", "16+38.5"],
                      ["polloEntero", "Pollo entero", ""],
                    ] as const
                  ).map(([campo, etiqueta, ph]) => (
                    <tr key={campo} className="bg-amber-50/20">
                      <td className="py-2 font-semibold text-gray-700">
                        🛵 {etiqueta}
                        <span className="ml-1.5 text-[9px] font-normal text-gray-400 uppercase">
                          a picar
                        </span>
                      </td>
                      <td className="py-1.5">
                        <CeldaExpresion
                          valor={manual[campo]}
                          onChange={set(campo)}
                          placeholder={ph}
                        />
                      </td>
                      <td className={`${tdNum} font-semibold`}>
                        {nf(evaluado[campo].valida ? evaluado[campo].valor : 0)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                    <td className="py-2.5 text-xs uppercase text-gray-600">VENTA</td>
                    <td className="py-2.5 text-right text-[10px] font-normal text-gray-400">
                      todo lo que salió
                    </td>
                    <td className={`${tdNum} text-sm text-gray-900`}>
                      {nf(data.kgCampo + data.kgPlanta + salidaCorteViva)}
                    </td>
                  </tr>
                  <tr className="bg-gray-50/70 font-bold">
                    <td className="py-2.5 text-xs uppercase text-gray-600">MERMA POLLO</td>
                    <td className="py-2.5 text-right text-[10px] font-normal text-gray-400">
                      {avesVivas} aves × {data.parametros.merma_estandar_ave_kg} kg
                    </td>
                    <td className={`${tdNum} text-sm text-gray-900`}>
                      {nf(avesVivas * data.parametros.merma_estandar_ave_kg)}
                    </td>
                  </tr>
                  <tr className="bg-blue-50/40 font-bold border-t-2 border-gray-300">
                    <td className="py-2.5 text-xs uppercase text-blue-900">DEBIÓ ENTRAR</td>
                    <td className="py-2.5 text-right text-[10px] font-normal text-blue-400">
                      venta + merma
                    </td>
                    <td className={`${tdNum} text-sm text-blue-900`}>
                      {nf(
                        data.kgCampo +
                          data.kgPlanta +
                          salidaCorteViva +
                          avesVivas * data.parametros.merma_estandar_ave_kg
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* ── PROVEEDORES + AVES ── */}
              <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1 min-w-0">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className={`${thBase} text-right w-20`}>N° Jabas</th>
                        <th className={`${thBase} pl-3`}>Proveedor</th>
                        <th className={`${thBase} text-right`}>Bruto</th>
                        <th className={`${thBase} text-right`}>Tara</th>
                        <th className={`${thBase} text-right bg-amber-50/20 pr-2`}>P. Neto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                      {data.proveedores.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-gray-400">
                            Sin compras de pollo registradas este día.
                          </td>
                        </tr>
                      )}
                      {data.proveedores.map((p, i) => (
                        <tr
                          key={`${p.proveedor}-${i}`}
                          className={p.esDevolucion ? "bg-amber-50/40" : "hover:bg-gray-50/50"}
                        >
                          <td className={`${tdNum} text-gray-500`}>{p.jabas || "—"}</td>
                          <td className="py-2 pl-3 font-semibold text-gray-800">
                            {p.proveedor}
                            {p.esDevolucion && (
                              <span className="ml-1.5 text-[9px] font-bold uppercase text-amber-700">
                                dev.
                              </span>
                            )}
                            {!p.esVivo && !p.esDevolucion && (
                              <span className="ml-1.5 text-[9px] font-bold uppercase text-violet-600">
                                corte
                              </span>
                            )}
                          </td>
                          <td className={`${tdNum} text-gray-500`}>{p.bruto ? nf(p.bruto) : "—"}</td>
                          <td className={`${tdNum} text-gray-500`}>{p.tara ? nf(p.tara) : "—"}</td>
                          <td
                            className={`${tdNum} pr-2 font-bold bg-amber-50/20 ${
                              p.esDevolucion ? "text-amber-700" : "text-gray-900"
                            }`}
                          >
                            {nf(p.neto)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                        <td className={`${tdNum} py-2.5 text-gray-700`}>{data.jabas || "—"}</td>
                        <td className="py-2.5 pl-3 text-xs uppercase text-gray-600">TOTALES</td>
                        <td className={`${tdNum} py-2.5 text-gray-700`}>{nf(data.kgBruto)}</td>
                        <td className={`${tdNum} py-2.5 text-gray-700`}>{nf(data.kgTara)}</td>
                        <td className={`${tdNum} py-2.5 pr-2 text-sm text-gray-900 bg-amber-50/40`}>
                          {nf(data.kgNetoIngresado)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Aves del día */}
                <div className="lg:w-80 shrink-0">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className={`${thBase} w-20`}>Aves</th>
                        <th className={`${thBase} text-right`}>Cuenta</th>
                        <th className={`${thBase} text-right w-16`}>Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                      {(
                        [
                          ["avesMacho", "Macho", "70+15+55*7"],
                          ["avesHembra", "Hembra", "15*9"],
                        ] as const
                      ).map(([campo, etiqueta, ph]) => (
                        <tr key={campo} className={data.avesManuales ? "bg-amber-50/20" : ""}>
                          <td className="py-2 font-semibold text-gray-700">{etiqueta}</td>
                          <td className="py-1.5">
                            {data.avesManuales ? (
                              <CeldaExpresion
                                valor={manual[campo]}
                                onChange={set(campo)}
                                placeholder={ph}
                                ancho="w-32"
                                decimales={0}
                              />
                            ) : (
                              <span className="block text-right text-[10px] text-gray-400 pr-2">
                                de la guía
                              </span>
                            )}
                          </td>
                          <td className={`${tdNum} font-semibold`}>
                            {data.avesManuales
                              ? Math.trunc(evaluado[campo].valida ? evaluado[campo].valor : 0)
                              : campo === "avesMacho"
                                ? data.avesMacho
                                : data.avesHembra}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                        <td className="py-2.5 text-xs uppercase text-gray-600" colSpan={2}>
                          Total de aves
                        </td>
                        <td className={`${tdNum} py-2.5 text-sm text-gray-900`}>
                          {data.avesManuales ? avesVivas : data.avesTotal}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-[10px] text-gray-400 mt-2 flex items-start gap-1">
                    <FiInfo className="shrink-0 mt-0.5" size={11} />
                    {data.avesManuales
                      ? "Puedes contarlas como en tu cuadro: 70+15+55*7 (jabas × aves por jaba)."
                      : "Vienen del desglose macho/hembra de la guía de compra."}
                  </p>
                </div>
              </div>

              {/* ── EL CUADRE ── */}
              <div className="flex justify-end">
                <table className="border-collapse w-full lg:w-[26rem]">
                  <tbody className="text-xs text-gray-800">
                    <tr>
                      <td className="py-2 font-semibold text-gray-600">Debió entrar</td>
                      <td className={`${tdNum} font-bold`}>
                        {nf(
                          data.kgCampo +
                            data.kgPlanta +
                            salidaCorteViva +
                            avesVivas * data.parametros.merma_estandar_ave_kg
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 font-semibold text-gray-600">
                        Entró (neto)
                        <span className="ml-1.5 text-[9px] uppercase text-gray-400">
                          merma real
                        </span>
                      </td>
                      <td className={`${tdNum} font-bold`}>{nf(data.kgNetoIngresado)}</td>
                    </tr>
                    <tr
                      className={`border-t-2 border-gray-300 ${
                        data.kgNetoIngresado === 0
                          ? ""
                          : data.cuadra
                            ? "bg-green-50/60"
                            : "bg-red-50/60"
                      }`}
                    >
                      <td className="py-3 text-sm font-black uppercase text-gray-900">
                        Diferencia
                      </td>
                      <td
                        className={`${tdNum} py-3 text-xl font-black ${
                          data.kgNetoIngresado === 0
                            ? "text-gray-300"
                            : data.cuadra
                              ? "text-green-700"
                              : "text-red-600"
                        }`}
                      >
                        {data.kgNetoIngresado === 0
                          ? "—"
                          : `${data.diferencia >= 0 ? "+" : ""}${nf(data.diferencia)}`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end -mt-4">
                <div className="lg:w-[26rem] text-right">
                  {data.kgNetoIngresado === 0 ? (
                    <p className="text-[11px] font-semibold text-gray-400">
                      Falta registrar la compra del día para poder cuadrar.
                    </p>
                  ) : avesVivas === 0 && data.avesTotal === 0 ? (
                    <p className="text-[11px] font-semibold text-amber-700 flex items-center justify-end gap-1.5">
                      <FiAlertTriangle size={12} /> Falta ingresar cuántas aves entraron.
                    </p>
                  ) : (
                    <p
                      className={`text-[11px] font-semibold flex items-center justify-end gap-1.5 ${
                        data.cuadra ? "text-green-700" : "text-red-600"
                      }`}
                    >
                      {data.cuadra ? (
                        <>
                          <FiCheckCircle size={12} /> Dentro de lo normal (margen ±
                          {nf(data.tolerancia)} kg).
                        </>
                      ) : (
                        <>
                          <FiAlertTriangle size={12} /> Se perdió más peso del esperado. Conviene
                          revisar.
                        </>
                      )}
                    </p>
                  )}
                  {data.usoFacturadoComoSalida && (
                    <p className="text-[10px] text-amber-700 mt-1">
                      Aún no cargas los kilos que salieron a picar; se está usando lo facturado por
                      las asesoras ({nf(data.kgFacturadoAsesoras)} kg).
                    </p>
                  )}
                </div>
              </div>

              {/* ── CONTROL DE DELIVERY ── */}
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className={`${thBase} w-1/3`}>Control de delivery</th>
                    <th className={`${thBase} text-right`}>
                      no entra en el cálculo de la merma
                    </th>
                    <th className={`${thBase} text-right w-32`}>Kilos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                  <tr>
                    <td className="py-2 font-semibold text-gray-700">Salió a picar (planta)</td>
                    <td />
                    <td className={`${tdNum} font-semibold`}>{nf(salidaCorteViva)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 font-semibold text-gray-700">
                      Facturado por las asesoras
                    </td>
                    <td />
                    <td className={`${tdNum} font-semibold`}>{nf(data.kgFacturadoAsesoras)}</td>
                  </tr>
                  <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                    <td className="py-2.5 text-xs uppercase text-gray-600" colSpan={2}>
                      Diferencia
                    </td>
                    <td className={`${tdNum} py-2.5 text-sm text-gray-900`}>
                      {data.kgFacturadoAsesoras - salidaCorteViva >= 0 ? "+" : ""}
                      {nf(data.kgFacturadoAsesoras - salidaCorteViva)}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Pie de hoja */}
              <div className="pt-3 border-t border-gray-100 flex justify-between text-[9px] text-gray-400">
                <span>Cuadre de Pollo · Transavic</span>
                <span>
                  Generado el {new Date().toLocaleDateString("es-PE")} a las{" "}
                  {new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          </div>

          {/* Observaciones + guardar — fuera de la hoja */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
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
            <div className="flex items-center justify-end gap-3">
              {hayErrores && (
                <span className="text-xs font-semibold text-red-600 flex items-center gap-1.5">
                  <FiAlertTriangle size={13} /> Hay una operación mal escrita
                </span>
              )}
              <button
                type="button"
                onClick={guardar}
                disabled={guardando || hayErrores}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer active:scale-95 flex items-center gap-2"
              >
                {guardando ? <FiLoader className="animate-spin" size={16} /> : <FiSave size={16} />}
                {guardando ? "Guardando…" : "Guardar cuadre del día"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
