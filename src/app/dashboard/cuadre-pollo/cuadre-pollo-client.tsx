// src/app/dashboard/cuadre-pollo/cuadre-pollo-client.tsx
//
// La pantalla imita la HOJA de Excel que Marianela cuadraba a mano: mismo orden,
// mismas etiquetas y misma densidad, con el lenguaje visual de cuadre-mermas-tab.
//
// Su narrativa, respetada al pie de la letra:
//     VENTA + MERMA POLLO = lo que DEBIÓ ENTRAR
//     vs ENTRÓ (proveedores)  →  DIFERENCIA
//
// FLEXIBILIDAD: en su Excel ella controla el 100% del input. Acá el sistema aporta
// la mayor parte, así que la hoja le deja intervenir sin salirse:
//   · desplegar cada total automático para ver quién lo compone;
//   · corregir el total de Campo o Planta (con motivo obligatorio);
//   · agregar sus propias líneas, de salida o de entrada.
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
  FiPlus,
  FiTrash2,
  FiChevronRight,
  FiChevronDown,
} from "react-icons/fi";
import { useToast, ToastContainer } from "@/components/Toast";
import GuiaModulo from "@/components/GuiaModulo";
import { toLocalDateString, formatFechaLarga } from "@/lib/utils";
import { evaluarExpresion } from "@/lib/expresion-numerica";
// El tipo se importa del módulo que lo produce: si el backend cambia el contrato,
// esta pantalla deja de compilar en vez de fallar en silencio.
import type { CuadrePollo, LineaDesglose } from "@/lib/cuadre-pollo";

type Cuadre = CuadrePollo;
type Canal = "campo" | "planta" | "ejecutivas";

const nf = (n: number, dec = 2): string =>
  n.toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const kg = (n: number): string => `${nf(n)} kg`;

/** Fila editable en la UI. Los kilos se derivan de la expresión en cada render. */
interface LineaUI {
  seccion: "entrada" | "salida";
  concepto: string;
  expresion: string;
  jabas: string;
  pendienteRegistrar: boolean;
}

/** Las tres que ella ya tiene en su Excel; se siembran en un día nuevo. */
const LINEAS_POR_DEFECTO: LineaUI[] = [
  { seccion: "salida", concepto: "Corte", expresion: "", jabas: "", pendienteRegistrar: false },
  { seccion: "salida", concepto: "Corte especial", expresion: "", jabas: "", pendienteRegistrar: false },
  { seccion: "salida", concepto: "Pollo entero", expresion: "", jabas: "", pendienteRegistrar: false },
];

/**
 * Celda de captura: acepta el desglose tal como llega el parte de pesos
 * ("62+62.2+62.5…") y muestra el total al costado, como haría Excel.
 */
function CeldaExpresion({
  valor,
  onChange,
  placeholder,
  ancho = "w-52",
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
        className={`w-20 text-right text-xs tabular-nums ${
          !valida ? "text-red-500 font-semibold" : hayDesglose ? "text-gray-900 font-bold" : "text-gray-300"
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
  const { mostrarToast, toasts } = useToast();

  // --- lo que la usuaria teclea ---
  const [lineas, setLineas] = useState<LineaUI[]>(LINEAS_POR_DEFECTO);
  const [avesMacho, setAvesMacho] = useState("");
  const [avesHembra, setAvesHembra] = useState("");
  const [observaciones, setObservaciones] = useState("");
  // Correcciones sobre los totales del sistema: texto vacío = sin corrección.
  const [ajusteCampo, setAjusteCampo] = useState("");
  const [motivoCampo, setMotivoCampo] = useState("");
  const [ajustePlanta, setAjustePlanta] = useState("");
  const [motivoPlanta, setMotivoPlanta] = useState("");
  const [expandido, setExpandido] = useState<Set<Canal>>(new Set());

  const toggle = (canal: Canal) =>
    setExpandido((prev) => {
      const s = new Set(prev);
      if (s.has(canal)) s.delete(canal);
      else s.add(canal);
      return s;
    });

  const evAves = useMemo(
    () => ({ macho: evaluarExpresion(avesMacho), hembra: evaluarExpresion(avesHembra) }),
    [avesMacho, avesHembra]
  );
  const evLineas = useMemo(() => lineas.map((l) => evaluarExpresion(l.expresion)), [lineas]);

  const hayExpresionRota =
    !evAves.macho.valida || !evAves.hembra.valida || evLineas.some((r) => !r.valida);

  // Un ajuste existe si el número tecleado difiere del que calculó el sistema.
  const ajuste = (texto: string, sistema: number) => {
    const t = texto.trim();
    if (t === "") return null;
    const { valor, valida } = evaluarExpresion(t);
    if (!valida) return null;
    return Math.abs(valor - sistema) < 0.005 ? null : valor;
  };
  const ajCampo = data ? ajuste(ajusteCampo, data.kgCampoSistema) : null;
  const ajPlanta = data ? ajuste(ajustePlanta, data.kgPlantaSistema) : null;
  const faltaMotivo =
    (ajCampo !== null && motivoCampo.trim().length < 3) ||
    (ajPlanta !== null && motivoPlanta.trim().length < 3);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/cuadre-pollo?fecha=${fecha}`);
      if (!res.ok) throw new Error("No se pudo cargar el cuadre.");
      const d: Cuadre = await res.json();
      setData(d);
      setLineas(
        d.lineas.length > 0
          ? d.lineas.map((l) => ({
              seccion: l.seccion,
              concepto: l.concepto,
              expresion: l.expresion ?? (l.kilos ? String(l.kilos) : ""),
              jabas: l.jabas ? String(l.jabas) : "",
              pendienteRegistrar: l.pendienteRegistrar,
            }))
          : LINEAS_POR_DEFECTO.map((l) => ({ ...l }))
      );
      const t = (expr: string | null, num: number) => expr ?? (num ? String(num) : "");
      setAvesMacho(d.avesManuales ? t(d.expresiones.avesMacho, d.avesMacho) : "");
      setAvesHembra(d.avesManuales ? t(d.expresiones.avesHembra, d.avesHembra) : "");
      setObservaciones(d.observaciones ?? "");
      setAjusteCampo(d.campoAjustado ? String(d.kgCampo) : "");
      setMotivoCampo(d.campoMotivo ?? "");
      setAjustePlanta(d.plantaAjustado ? String(d.kgPlanta) : "");
      setMotivoPlanta(d.plantaMotivo ?? "");
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

  // --- totales en vivo: lo tecleado manda sobre lo último guardado ---
  const kgCampoVivo = ajCampo ?? data?.kgCampoSistema ?? 0;
  const kgPlantaVivo = ajPlanta ?? data?.kgPlantaSistema ?? 0;
  const kilosDe = (i: number) => (evLineas[i]?.valida ? evLineas[i].valor : 0);
  const salidaLineas = lineas.reduce(
    (a, l, i) => a + (l.seccion === "salida" ? kilosDe(i) : 0),
    0
  );
  const entradaLineas = lineas.reduce(
    (a, l, i) => a + (l.seccion === "entrada" ? kilosDe(i) : 0),
    0
  );
  const jabasLineas = lineas.reduce(
    (a, l) => a + (l.seccion === "entrada" ? Number(l.jabas) || 0 : 0),
    0
  );
  const avesVivas = Math.trunc(evAves.macho.valor) + Math.trunc(evAves.hembra.valor);
  const avesEfectivas = data && !data.avesManuales && data.avesTotal > 0 ? data.avesTotal : avesVivas;
  const mermaPolloViva = avesEfectivas * (data?.parametros.merma_estandar_ave_kg ?? 0.32);
  const ventaViva = kgCampoVivo + kgPlantaVivo + salidaLineas;
  const debioEntrar = ventaViva + mermaPolloViva;
  const entroVivo = (data ? data.kgNetoIngresado - data.kgEntradaManual : 0) + entradaLineas;

  const setLinea = (i: number, campo: keyof LineaUI, v: string | boolean) =>
    setLineas((prev) => prev.map((l, k) => (k === i ? { ...l, [campo]: v } : l)));

  const agregarLinea = (seccion: "entrada" | "salida") =>
    setLineas((prev) => [
      ...prev,
      { seccion, concepto: "", expresion: "", jabas: "", pendienteRegistrar: seccion === "entrada" },
    ]);

  const quitarLinea = (i: number) => setLineas((prev) => prev.filter((_, k) => k !== i));

  const guardar = async () => {
    if (hayExpresionRota) {
      mostrarToast("Hay una operación mal escrita. Revisa las celdas en rojo.", "error");
      return;
    }
    if (faltaMotivo) {
      mostrarToast("Escribe por qué corriges el total (mínimo 3 letras).", "error");
      return;
    }
    const sinNombre = lineas.some((l, i) => l.concepto.trim() === "" && kilosDe(i) > 0);
    if (sinNombre) {
      mostrarToast("Hay una línea con kilos pero sin nombre.", "error");
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
          aves_macho: Math.trunc(evAves.macho.valor),
          aves_hembra: Math.trunc(evAves.hembra.valor),
          expr_aves_macho: limpio(avesMacho),
          expr_aves_hembra: limpio(avesHembra),
          observaciones: observaciones.trim() || null,
          // Se resuelven los kilos con el índice ORIGINAL antes de filtrar: después
          // del filter, el índice ya no corresponde a `evLineas`.
          lineas: lineas
            .map((l, i) => ({
              seccion: l.seccion,
              concepto: l.concepto.trim(),
              expresion: limpio(l.expresion),
              kilos: kilosDe(i),
              jabas: Math.trunc(Number(l.jabas) || 0),
              pendiente_registrar: l.pendienteRegistrar,
            }))
            .filter((l) => l.concepto !== "" || l.kilos > 0),
          ajuste_campo: ajCampo !== null ? { kilos: ajCampo, motivo: motivoCampo.trim() } : null,
          ajuste_planta: ajPlanta !== null ? { kilos: ajPlanta, motivo: motivoPlanta.trim() } : null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(typeof e?.error === "string" ? e.error : "No se pudo guardar.");
      }
      const d: Cuadre = await res.json();
      setData(d);
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
    const dif = mermaPolloViva - (entroVivo - ventaViva);
    const texto = [
      `*CUADRE DE POLLO* — ${formatFechaLarga(data.fecha)}`,
      "",
      `Venta (salida):   ${kg(ventaViva)}`,
      `Merma pollo:      ${kg(mermaPolloViva)}  (${avesEfectivas} aves × ${data.parametros.merma_estandar_ave_kg})`,
      `*Debió entrar:*   ${kg(debioEntrar)}`,
      "",
      `Entró (compras):  ${kg(entroVivo)}`,
      `*DIFERENCIA:*     ${signo(dif)}${kg(dif)}`,
      "",
      dif >= -data.tolerancia
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
      doc.text(formatFechaLarga(data.fecha), centro, 37, { align: "center" });
      doc.setDrawColor(229, 231, 235);
      doc.line(15, 42, W - 15, 42);

      let y = 51;
      const fila = (etiqueta: string, valor: string, negrita = false, detalle?: string) => {
        if (y > 265) {
          doc.addPage();
          y = 20;
        }
        doc.setFont("helvetica", negrita ? "bold" : "normal");
        doc.setFontSize(negrita ? 10.5 : 10);
        doc.setTextColor(negrita ? 31 : 75, negrita ? 41 : 85, negrita ? 55 : 99);
        doc.text(etiqueta, 18, y);
        doc.text(valor, W - 18, y, { align: "right" });
        if (detalle) {
          // El desglose va pegado a SU etiqueta y con aire antes de la siguiente fila.
          y += 3.4;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(156, 163, 175);
          const lineasTxt = doc.splitTextToSize(detalle, W - 70) as string[];
          doc.text(lineasTxt, 22, y);
          y += 3.4 * lineasTxt.length + 2.5;
        } else {
          y += 6;
        }
      };
      const titulo = (t: string) => {
        if (y > 258) {
          doc.addPage();
          y = 20;
        }
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
      fila(
        "Venta en Campo",
        kg(kgCampoVivo),
        false,
        ajCampo !== null
          ? `corregido a mano · el sistema calculó ${kg(data.kgCampoSistema)} · ${motivoCampo.trim()}`
          : undefined
      );
      fila(
        "Venta en Planta",
        kg(kgPlantaVivo),
        false,
        ajPlanta !== null
          ? `corregido a mano · el sistema calculó ${kg(data.kgPlantaSistema)} · ${motivoPlanta.trim()}`
          : undefined
      );
      lineas.forEach((l, i) => {
        if (l.seccion !== "salida" || (l.concepto.trim() === "" && kilosDe(i) === 0)) return;
        fila(
          l.concepto.trim() || "(sin nombre)",
          kg(kilosDe(i)),
          false,
          /[+\-*/]/.test(l.expresion) ? l.expresion : undefined
        );
      });
      raya();
      fila("VENTA", kg(ventaViva), true);
      fila(
        "MERMA POLLO",
        kg(mermaPolloViva),
        false,
        `${avesEfectivas} aves × ${data.parametros.merma_estandar_ave_kg} kg`
      );
      raya();
      fila("DEBIÓ ENTRAR", kg(debioEntrar), true);

      titulo("Proveedores");
      data.proveedores.forEach((p) => {
        const etiqueta = p.esDevolucion ? " · devolución" : p.esVivo ? "" : " · corte comprado";
        fila(`${p.proveedor}${p.jabas ? ` (${p.jabas} jabas)` : ""}${etiqueta}`, kg(p.neto));
      });
      lineas.forEach((l, i) => {
        if (l.seccion !== "entrada" || (l.concepto.trim() === "" && kilosDe(i) === 0)) return;
        fila(
          `${l.concepto.trim() || "(sin nombre)"}${l.jabas ? ` (${l.jabas} jabas)` : ""}`,
          kg(kilosDe(i)),
          false,
          l.pendienteRegistrar ? "PENDIENTE: esta compra todavía no está registrada en Compras" : undefined
        );
      });
      raya();
      fila("ENTRÓ (neto)", kg(entroVivo), true);

      titulo("Cuadre");
      const difPdf = mermaPolloViva - (entroVivo - ventaViva);
      const cuadraPdf = difPdf >= -data.tolerancia;
      fila("Debió entrar", kg(debioEntrar));
      fila("Entró", kg(entroVivo));
      if (cuadraPdf) doc.setTextColor(21, 128, 61);
      else doc.setTextColor(185, 28, 28);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("DIFERENCIA", 18, y);
      doc.text(`${difPdf >= 0 ? "+" : ""}${kg(difPdf)}`, W - 18, y, { align: "right" });
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(107, 114, 128);
      doc.text(
        cuadraPdf
          ? `La merma estuvo dentro de lo normal (margen de ±${kg(data.tolerancia)}).`
          : "Se perdió más peso del esperado. Conviene revisar.",
        18,
        y
      );
      y += 5;

      titulo("Control de delivery");
      fila("Salió a picar (planta)", kg(salidaLineas));
      fila("Facturado por las asesoras", kg(data.kgFacturadoAsesoras));
      fila(
        "Diferencia",
        `${data.kgFacturadoAsesoras - salidaLineas >= 0 ? "+" : ""}${kg(data.kgFacturadoAsesoras - salidaLineas)}`,
        true
      );

      if (observaciones.trim()) {
        titulo("Observaciones");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(75, 85, 99);
        doc.text(doc.splitTextToSize(observaciones.trim(), W - 36), 18, y);
      }

      doc.save(`cuadre-pollo-${data.fecha}.pdf`);
      mostrarToast("PDF descargado.", "exito");
    } catch {
      mostrarToast("No se pudo generar el PDF.", "error");
    } finally {
      setExportando(false);
    }
  };

  const thBase = "py-2 text-[9px] uppercase font-bold tracking-wider text-gray-400";
  const tdNum = "py-2 text-right tabular-nums";

  /** Filas del desglose de un canal, cuando está expandido. */
  const filasDesglose = (canal: Canal, items: LineaDesglose[]) =>
    expandido.has(canal) && items.length > 0
      ? items.map((it, i) => (
          <tr key={`${canal}-${i}`} className="bg-gray-50/40">
            <td className="py-1 pl-8 text-[11px] text-gray-500">{it.concepto}</td>
            <td />
            <td className={`${tdNum} py-1 text-[11px] text-gray-500`}>{nf(it.kilos)}</td>
          </tr>
        ))
      : null;

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
          {data.guiasCompra === 0 && entradaLineas === 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
              <FiAlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
              <div className="text-sm text-amber-900">
                <p className="font-bold">
                  Todavía no se registró la compra de pollo de {formatFechaLarga(data.fecha)}.
                </p>
                <p className="mt-0.5 text-amber-800">
                  Sin ella no se puede calcular la merma: no sabemos cuántos kilos entraron. Se
                  registra en{" "}
                  <Link href="/dashboard/compras" className="font-bold underline">
                    Compras → Nueva Compra
                  </Link>
                  , o puedes cargarla abajo a mano mientras tanto.
                </p>
              </div>
            </div>
          )}

          {/* ───────── LA HOJA ───────── */}
          <div className="border border-gray-200 rounded-2xl shadow-xs bg-white overflow-x-auto">
            <div className="bg-white p-6 flex flex-col gap-6" style={{ minWidth: "780px" }}>
              {/* Membrete */}
              <div className="flex justify-between items-end border-b border-gray-100 pb-4">
                <div>
                  <h2 className="text-xs font-bold text-red-600 tracking-widest uppercase mb-1">
                    TRANSAVIC &amp; LA AVÍCOLA DE TONY
                  </h2>
                  <h1 className="text-lg font-black text-gray-900 tracking-tight">Cuadre de Pollo</h1>
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
                    <th className={`${thBase} text-right w-28`}>Kilos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                  {/* Campo — automático, expandible y corregible */}
                  <tr>
                    <td className="py-2 font-semibold text-gray-700">
                      <button
                        type="button"
                        onClick={() => toggle("campo")}
                        className="inline-flex items-center gap-1 hover:text-red-600 cursor-pointer"
                        title="Ver qué clientes lo componen"
                      >
                        {expandido.has("campo") ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
                        🏪 Venta en Campo
                        <span className="text-[9px] font-normal text-gray-400">
                          ({data.desglose.campo.length})
                        </span>
                      </button>
                    </td>
                    <td className="py-1.5">
                      <CeldaExpresion
                        valor={ajusteCampo}
                        onChange={setAjusteCampo}
                        placeholder={nf(data.kgCampoSistema)}
                        ancho="w-32"
                      />
                    </td>
                    <td className={`${tdNum} font-semibold ${ajCampo !== null ? "text-amber-700" : ""}`}>
                      {nf(kgCampoVivo)}
                    </td>
                  </tr>
                  {ajCampo !== null && (
                    <tr className="bg-amber-50/40">
                      <td colSpan={3} className="py-1.5 pl-8 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-amber-800 shrink-0">
                            el sistema calculó {nf(data.kgCampoSistema)} ·{" "}
                            {ajCampo - data.kgCampoSistema >= 0 ? "+" : ""}
                            {nf(ajCampo - data.kgCampoSistema)} ·
                          </span>
                          <input
                            type="text"
                            value={motivoCampo}
                            onChange={(e) => setMotivoCampo(e.target.value)}
                            placeholder="¿Por qué lo corriges? (obligatorio)"
                            className={`flex-1 rounded-md border px-2 py-1 text-[11px] outline-none ${
                              motivoCampo.trim().length < 3
                                ? "border-red-400 bg-red-50"
                                : "border-amber-300 bg-white"
                            }`}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                  {filasDesglose("campo", data.desglose.campo)}

                  {/* Planta */}
                  <tr>
                    <td className="py-2 font-semibold text-gray-700">
                      <button
                        type="button"
                        onClick={() => toggle("planta")}
                        className="inline-flex items-center gap-1 hover:text-red-600 cursor-pointer"
                        title="Ver qué ventas lo componen"
                      >
                        {expandido.has("planta") ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
                        🏭 Venta en Planta
                        <span className="text-[9px] font-normal text-gray-400">
                          ({data.desglose.planta.length})
                        </span>
                      </button>
                    </td>
                    <td className="py-1.5">
                      <CeldaExpresion
                        valor={ajustePlanta}
                        onChange={setAjustePlanta}
                        placeholder={nf(data.kgPlantaSistema)}
                        ancho="w-32"
                      />
                    </td>
                    <td className={`${tdNum} font-semibold ${ajPlanta !== null ? "text-amber-700" : ""}`}>
                      {nf(kgPlantaVivo)}
                    </td>
                  </tr>
                  {ajPlanta !== null && (
                    <tr className="bg-amber-50/40">
                      <td colSpan={3} className="py-1.5 pl-8 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-amber-800 shrink-0">
                            el sistema calculó {nf(data.kgPlantaSistema)} ·{" "}
                            {ajPlanta - data.kgPlantaSistema >= 0 ? "+" : ""}
                            {nf(ajPlanta - data.kgPlantaSistema)} ·
                          </span>
                          <input
                            type="text"
                            value={motivoPlanta}
                            onChange={(e) => setMotivoPlanta(e.target.value)}
                            placeholder="¿Por qué lo corriges? (obligatorio)"
                            className={`flex-1 rounded-md border px-2 py-1 text-[11px] outline-none ${
                              motivoPlanta.trim().length < 3
                                ? "border-red-400 bg-red-50"
                                : "border-amber-300 bg-white"
                            }`}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                  {filasDesglose("planta", data.desglose.planta)}

                  {/* Líneas propias de salida */}
                  {lineas.map((l, i) =>
                    l.seccion !== "salida" ? null : (
                      <tr key={`salida-${i}`} className="bg-amber-50/20 group">
                        <td className="py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-400">🛵</span>
                            <input
                              type="text"
                              value={l.concepto}
                              onChange={(e) => setLinea(i, "concepto", e.target.value)}
                              placeholder="Concepto"
                              className="w-40 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold text-gray-700 outline-none hover:border-gray-200 focus:border-amber-400 focus:bg-white"
                            />
                            <button
                              type="button"
                              onClick={() => quitarLinea(i)}
                              title="Quitar esta línea"
                              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity cursor-pointer"
                            >
                              <FiTrash2 size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="py-1.5">
                          <CeldaExpresion
                            valor={l.expresion}
                            onChange={(v) => setLinea(i, "expresion", v)}
                            placeholder="62+62.2+62.5…"
                          />
                        </td>
                        <td className={`${tdNum} font-semibold`}>{nf(kilosDe(i))}</td>
                      </tr>
                    )
                  )}
                  <tr>
                    <td colSpan={3} className="py-1.5">
                      <button
                        type="button"
                        onClick={() => agregarLinea("salida")}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:text-amber-900 cursor-pointer"
                      >
                        <FiPlus size={12} /> Agregar línea de salida
                      </button>
                    </td>
                  </tr>

                  <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                    <td className="py-2.5 text-xs uppercase text-gray-600">VENTA</td>
                    <td className="py-2.5 text-right text-[10px] font-normal text-gray-400">
                      todo lo que salió
                    </td>
                    <td className={`${tdNum} text-sm text-gray-900`}>{nf(ventaViva)}</td>
                  </tr>
                  <tr className="bg-gray-50/70 font-bold">
                    <td className="py-2.5 text-xs uppercase text-gray-600">MERMA POLLO</td>
                    <td className="py-2.5 text-right text-[10px] font-normal text-gray-400">
                      {avesEfectivas} aves × {data.parametros.merma_estandar_ave_kg} kg
                    </td>
                    <td className={`${tdNum} text-sm text-gray-900`}>{nf(mermaPolloViva)}</td>
                  </tr>
                  <tr className="bg-blue-50/40 font-bold border-t-2 border-gray-300">
                    <td className="py-2.5 text-xs uppercase text-blue-900">DEBIÓ ENTRAR</td>
                    <td className="py-2.5 text-right text-[10px] font-normal text-blue-400">
                      venta + merma
                    </td>
                    <td className={`${tdNum} text-sm text-blue-900`}>{nf(debioEntrar)}</td>
                  </tr>
                </tbody>
              </table>

              {/* ── PROVEEDORES + AVES ── */}
              <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1 min-w-0">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className={`${thBase} text-right w-16`}>Jabas</th>
                        <th className={`${thBase} pl-3`}>Proveedor</th>
                        <th className={`${thBase} text-right`}>Bruto</th>
                        <th className={`${thBase} text-right`}>Tara</th>
                        <th className={`${thBase} text-right bg-amber-50/20 pr-2`}>P. Neto</th>
                        <th className="w-6" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                      {data.proveedores.length === 0 && entradaLineas === 0 && (
                        <tr>
                          <td colSpan={6} className="py-5 text-center text-gray-400">
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
                              <span className="ml-1.5 text-[9px] font-bold uppercase text-amber-700">dev.</span>
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
                          <td />
                        </tr>
                      ))}

                      {/* Entradas cargadas a mano */}
                      {lineas.map((l, i) =>
                        l.seccion !== "entrada" ? null : (
                          <tr key={`entrada-${i}`} className="bg-amber-50/30 group">
                            <td className="py-1.5 pr-1">
                              <input
                                type="text"
                                inputMode="numeric"
                                value={l.jabas}
                                onChange={(e) => setLinea(i, "jabas", e.target.value)}
                                placeholder="—"
                                className="w-14 rounded-md border border-amber-300 bg-white px-1 py-0.5 text-xs text-right tabular-nums outline-none focus:border-amber-500"
                              />
                            </td>
                            <td className="py-1.5 pl-3">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={l.concepto}
                                  onChange={(e) => setLinea(i, "concepto", e.target.value)}
                                  placeholder="Proveedor"
                                  className="w-36 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold text-gray-700 outline-none hover:border-gray-200 focus:border-amber-400 focus:bg-white"
                                />
                                {l.pendienteRegistrar && (
                                  <span
                                    className="text-[9px] font-bold uppercase text-amber-700"
                                    title="Esta compra todavía no está registrada en Compras"
                                  >
                                    pendiente
                                  </span>
                                )}
                              </div>
                            </td>
                            <td colSpan={2} className="py-1.5">
                              <CeldaExpresion
                                valor={l.expresion}
                                onChange={(v) => setLinea(i, "expresion", v)}
                                placeholder="peso neto"
                                ancho="w-28"
                              />
                            </td>
                            <td className={`${tdNum} pr-2 font-bold bg-amber-50/20 text-amber-800`}>
                              {nf(kilosDe(i))}
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => quitarLinea(i)}
                                title="Quitar esta entrada"
                                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity cursor-pointer"
                              >
                                <FiTrash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        )
                      )}
                      <tr>
                        <td colSpan={6} className="py-1.5 pl-3">
                          <button
                            type="button"
                            onClick={() => agregarLinea("entrada")}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:text-amber-900 cursor-pointer"
                            title="Para cuando la compra todavía no está digitada en Compras"
                          >
                            <FiPlus size={12} /> Agregar entrada a mano
                          </button>
                        </td>
                      </tr>

                      <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                        <td className={`${tdNum} py-2.5 text-gray-700`}>
                          {data.jabasCompras + jabasLineas || "—"}
                        </td>
                        <td className="py-2.5 pl-3 text-xs uppercase text-gray-600">TOTALES</td>
                        <td className={`${tdNum} py-2.5 text-gray-700`}>{nf(data.kgBruto)}</td>
                        <td className={`${tdNum} py-2.5 text-gray-700`}>{nf(data.kgTara)}</td>
                        <td className={`${tdNum} py-2.5 pr-2 text-sm text-gray-900 bg-amber-50/40`}>
                          {nf(entroVivo)}
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Aves del día */}
                <div className="lg:w-72 shrink-0">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className={`${thBase} w-16`}>Aves</th>
                        <th className={`${thBase} text-right`}>Cuenta</th>
                        <th className={`${thBase} text-right w-14`}>Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                      {(
                        [
                          ["macho", "Macho", "70+15+55*7", avesMacho, setAvesMacho, evAves.macho, data.avesMacho],
                          ["hembra", "Hembra", "15*9", avesHembra, setAvesHembra, evAves.hembra, data.avesHembra],
                        ] as const
                      ).map(([k, etiqueta, ph, val, set, ev, delSistema]) => (
                        <tr key={k} className={data.avesManuales ? "bg-amber-50/20" : ""}>
                          <td className="py-2 font-semibold text-gray-700">{etiqueta}</td>
                          <td className="py-1.5">
                            {data.avesManuales || data.avesTotal === 0 ? (
                              <CeldaExpresion
                                valor={val}
                                onChange={set}
                                placeholder={ph}
                                ancho="w-28"
                                decimales={0}
                              />
                            ) : (
                              <span className="block text-right text-[10px] text-gray-400 pr-2">
                                de la guía
                              </span>
                            )}
                          </td>
                          <td className={`${tdNum} font-semibold`}>
                            {data.avesManuales || data.avesTotal === 0
                              ? Math.trunc(ev.valida ? ev.valor : 0)
                              : delSistema}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                        <td className="py-2.5 text-xs uppercase text-gray-600" colSpan={2}>
                          Total de aves
                        </td>
                        <td className={`${tdNum} py-2.5 text-sm text-gray-900`}>{avesEfectivas}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-[10px] text-gray-400 mt-2 flex items-start gap-1">
                    <FiInfo className="shrink-0 mt-0.5" size={11} />
                    {data.avesManuales || data.avesTotal === 0
                      ? "Puedes contarlas como en tu cuadro: 70+15+55*7 (jabas × aves por jaba)."
                      : "Vienen del desglose macho/hembra de la guía de compra."}
                  </p>
                </div>
              </div>

              {/* ── EL CUADRE ── */}
              {(() => {
                const dif = mermaPolloViva - (entroVivo - ventaViva);
                const cuadraAhora = dif >= -(entroVivo * 0.01);
                const sinEntrada = entroVivo === 0;
                return (
                  <>
                    <div className="flex justify-end">
                      <table className="border-collapse w-full lg:w-[26rem]">
                        <tbody className="text-xs text-gray-800">
                          <tr>
                            <td className="py-2 font-semibold text-gray-600">Debió entrar</td>
                            <td className={`${tdNum} font-bold`}>{nf(debioEntrar)}</td>
                          </tr>
                          <tr>
                            <td className="py-2 font-semibold text-gray-600">
                              Entró (neto)
                              <span className="ml-1.5 text-[9px] uppercase text-gray-400">merma real</span>
                            </td>
                            <td className={`${tdNum} font-bold`}>{nf(entroVivo)}</td>
                          </tr>
                          <tr
                            className={`border-t-2 border-gray-300 ${
                              sinEntrada ? "" : cuadraAhora ? "bg-green-50/60" : "bg-red-50/60"
                            }`}
                          >
                            <td className="py-3 text-sm font-black uppercase text-gray-900">Diferencia</td>
                            <td
                              className={`${tdNum} py-3 text-xl font-black ${
                                sinEntrada ? "text-gray-300" : cuadraAhora ? "text-green-700" : "text-red-600"
                              }`}
                            >
                              {sinEntrada ? "—" : `${dif >= 0 ? "+" : ""}${nf(dif)}`}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-end -mt-4">
                      <div className="lg:w-[26rem] text-right">
                        {sinEntrada ? (
                          <p className="text-[11px] font-semibold text-gray-400">
                            Falta registrar la compra del día para poder cuadrar.
                          </p>
                        ) : avesEfectivas === 0 ? (
                          <p className="text-[11px] font-semibold text-amber-700 flex items-center justify-end gap-1.5">
                            <FiAlertTriangle size={12} /> Falta ingresar cuántas aves entraron.
                          </p>
                        ) : (
                          <p
                            className={`text-[11px] font-semibold flex items-center justify-end gap-1.5 ${
                              cuadraAhora ? "text-green-700" : "text-red-600"
                            }`}
                          >
                            {cuadraAhora ? (
                              <>
                                <FiCheckCircle size={12} /> Dentro de lo normal (margen ±
                                {nf(entroVivo * 0.01)} kg).
                              </>
                            ) : (
                              <>
                                <FiAlertTriangle size={12} /> Se perdió más peso del esperado. Conviene
                                revisar.
                              </>
                            )}
                          </p>
                        )}
                        {salidaLineas === 0 && data.kgFacturadoAsesoras > 0 && (
                          <p className="text-[10px] text-amber-700 mt-1">
                            Aún no cargas los kilos que salieron a picar; las asesoras facturaron{" "}
                            {nf(data.kgFacturadoAsesoras)} kg ese día.
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* ── CONTROL DE DELIVERY ── */}
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className={`${thBase} w-1/3`}>Control de delivery</th>
                    <th className={`${thBase} text-right`}>no entra en el cálculo de la merma</th>
                    <th className={`${thBase} text-right w-28`}>Kilos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                  <tr>
                    <td className="py-2 font-semibold text-gray-700">Salió a picar (planta)</td>
                    <td />
                    <td className={`${tdNum} font-semibold`}>{nf(salidaLineas)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 font-semibold text-gray-700">
                      <button
                        type="button"
                        onClick={() => toggle("ejecutivas")}
                        className="inline-flex items-center gap-1 hover:text-red-600 cursor-pointer"
                        title="Ver qué clientes lo componen"
                      >
                        {expandido.has("ejecutivas") ? (
                          <FiChevronDown size={12} />
                        ) : (
                          <FiChevronRight size={12} />
                        )}
                        Facturado por las asesoras
                        <span className="text-[9px] font-normal text-gray-400">
                          ({data.desglose.ejecutivas.length})
                        </span>
                      </button>
                    </td>
                    <td />
                    <td className={`${tdNum} font-semibold`}>{nf(data.kgFacturadoAsesoras)}</td>
                  </tr>
                  {filasDesglose("ejecutivas", data.desglose.ejecutivas)}
                  <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                    <td className="py-2.5 text-xs uppercase text-gray-600" colSpan={2}>
                      Diferencia
                    </td>
                    <td className={`${tdNum} py-2.5 text-sm text-gray-900`}>
                      {data.kgFacturadoAsesoras - salidaLineas >= 0 ? "+" : ""}
                      {nf(data.kgFacturadoAsesoras - salidaLineas)}
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
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Ej. Llegó una jaba con pollo muerto de Renato."
                className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 resize-none"
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              {hayExpresionRota && (
                <span className="text-xs font-semibold text-red-600 flex items-center gap-1.5">
                  <FiAlertTriangle size={13} /> Hay una operación mal escrita
                </span>
              )}
              {!hayExpresionRota && faltaMotivo && (
                <span className="text-xs font-semibold text-red-600 flex items-center gap-1.5">
                  <FiAlertTriangle size={13} /> Falta explicar la corrección
                </span>
              )}
              <button
                type="button"
                onClick={guardar}
                disabled={guardando || hayExpresionRota || faltaMotivo}
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
