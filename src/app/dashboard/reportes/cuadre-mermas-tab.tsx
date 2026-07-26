// src/app/dashboard/reportes/cuadre-mermas-tab.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { FiLoader, FiBox, FiCopy, FiFileText, FiEdit, FiX, FiCheck, FiInfo } from "react-icons/fi";
import { toLocalDateString } from "@/lib/utils";

interface ProductoCuadre {
  producto_id: string;
  producto_nombre: string;
  producto_categoria: string;
  jabas_compradas: number;
  kg_comprados: number;
  jabas_macho: number;
  jabas_hembra: number;
  sueltos_macho: number;
  sueltos_hembra: number;
  total_pollos: number;
  kg_merma_estimada: number;
  kg_ejecutivas: number;
  kg_planta: number;
  kg_campo: number;
  kg_ajuste: number;
  kg_vendidos: number;
  diferencia: number;
}

interface CuadreFisicoResponse {
  fecha: string;
  productos: ProductoCuadre[];
}

interface DetalleItem {
  compra_id?: string;
  venta_id?: string;
  pedido_id?: string;
  ajuste_id?: string;
  fecha: string;
  proveedor_nombre?: string;
  cliente_nombre?: string;
  nro_doc?: string;
  nro_guia?: string;
  nro_pedido?: string;
  item_id: string;
  jabas?: number;
  peso_bruto?: number;
  peso_tara?: number;
  kilos: number;
  precio_unitario?: number;
  costo_unitario?: number;
  precio_kg?: number;
  motivo?: string;
  usuario_nombre?: string;
  jabas_macho?: number;
  jabas_hembra?: number;
  sueltos_macho?: number;
  sueltos_hembra?: number;
  total_pollos?: number;
  created_at?: string;
}

export default function CuadreMermasTab() {
  const [fechaInicio, setFechaInicio] = useState<string>("");
  const [fechaFin, setFechaFin] = useState<string>("");
  const [tipoPeriodo, setTipoPeriodo] = useState<"hoy" | "ayer" | "7dias" | "personalizado">("hoy");
  const [data, setData] = useState<CuadreFisicoResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [exportandoPDF, setExportandoPDF] = useState<boolean>(false);
  const [copiando, setCopiando] = useState<boolean>(false);

  // Estados para Modal de Detalle y Edición
  const [modalAbierto, setModalAbierto] = useState<boolean>(false);
  const [modalCanal, setModalCanal] = useState<"compras" | "campo" | "ejecutivas" | "planta" | "ajuste" | null>(null);
  const [modalProducto, setModalProducto] = useState<{ id: string; nombre: string } | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState<boolean>(false);
  const [detalleItems, setDetalleItems] = useState<DetalleItem[]>([]);
  const [guardandoItem, setGuardandoItem] = useState<string | null>(null);

  // Estados para Edición Inline de Item (Compras/Ventas de Campo)
  const [editandoItemId, setEditandoItemId] = useState<string | null>(null);
  const [editKilos, setEditKilos] = useState<string>("");
  const [editJabas, setEditJabas] = useState<string>("");

  // Estados para Registro de Ajuste Manual
  const [ajusteKilos, setAjusteKilos] = useState<string>("");
  const [ajusteMotivo, setAjusteMotivo] = useState<string>("");
  const [guardandoAjuste, setGuardandoAjuste] = useState<boolean>(false);

  // Sincronizar fechas según el tipo de período
  useEffect(() => {
    const hoy = toLocalDateString(new Date());
    if (tipoPeriodo === "hoy") {
      setFechaInicio(hoy);
      setFechaFin(hoy);
    } else if (tipoPeriodo === "ayer") {
      const ayer = new Date();
      ayer.setDate(ayer.getDate() - 1);
      const ayerStr = toLocalDateString(ayer);
      setFechaInicio(ayerStr);
      setFechaFin(ayerStr);
    } else if (tipoPeriodo === "7dias") {
      const sieteDiasAgo = new Date();
      sieteDiasAgo.setDate(sieteDiasAgo.getDate() - 6);
      setFechaInicio(toLocalDateString(sieteDiasAgo));
      setFechaFin(hoy);
    } else if (tipoPeriodo === "personalizado") {
      // Dejar los que ya están o poner hoy
      if (!fechaInicio) {
        setFechaInicio(hoy);
        setFechaFin(hoy);
      }
    }
  }, [tipoPeriodo]);

  const cargarCuadre = useCallback(async () => {
    if (!fechaInicio || !fechaFin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reportes/cuadre-fisico?desde=${fechaInicio}&hasta=${fechaFin}`);
      if (!res.ok) {
        throw new Error("No se pudo cargar el cuadre físico");
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Error cargando cuadre físico:", err);
      setError("Error al calcular el cuadre de mermas físicas.");
    } finally {
      setLoading(false);
    }
  }, [fechaInicio, fechaFin]);

  // Cargar datos al cambiar las fechas
  useEffect(() => {
    cargarCuadre();
  }, [cargarCuadre]);

  // Aritmética de Totales
  const totalJabasCompra = data?.productos.reduce((acc, p) => acc + p.jabas_compradas, 0) ?? 0;
  const totalCompra = data?.productos.reduce((acc, p) => acc + p.kg_comprados, 0) ?? 0;
  const totalJabasMacho = data?.productos.reduce((acc, p) => acc + (p.jabas_macho ?? 0), 0) ?? 0;
  const totalJabasHembra = data?.productos.reduce((acc, p) => acc + (p.jabas_hembra ?? 0), 0) ?? 0;
  const totalSueltosMacho = data?.productos.reduce((acc, p) => acc + (p.sueltos_macho ?? 0), 0) ?? 0;
  const totalSueltosHembra = data?.productos.reduce((acc, p) => acc + (p.sueltos_hembra ?? 0), 0) ?? 0;
  const totalPollos = data?.productos.reduce((acc, p) => acc + (p.total_pollos ?? 0), 0) ?? 0;
  const totalMermaEstimada = data?.productos.reduce((acc, p) => acc + (p.kg_merma_estimada ?? 0), 0) ?? 0;
  const totalEjecutivas = data?.productos.reduce((acc, p) => acc + p.kg_ejecutivas, 0) ?? 0;
  const totalPlanta = data?.productos.reduce((acc, p) => acc + p.kg_planta, 0) ?? 0;
  const totalCampo = data?.productos.reduce((acc, p) => acc + p.kg_campo, 0) ?? 0;
  const totalAjuste = data?.productos.reduce((acc, p) => acc + (p.kg_ajuste ?? 0), 0) ?? 0;
  const totalVenta = data?.productos.reduce((acc, p) => acc + p.kg_vendidos, 0) ?? 0;
  const totalDiferencia = data?.productos.reduce((acc, p) => acc + p.diferencia, 0) ?? 0;

  // Cargar detalles transaccionales del canal para el modal
  const obtenerDetalles = useCallback(async (productoId: string, canal: "compras" | "campo" | "ejecutivas" | "planta" | "ajuste") => {
    setCargandoDetalle(true);
    setDetalleItems([]);
    setEditandoItemId(null);
    try {
      const res = await fetch(`/api/reportes/cuadre-fisico/detalle?desde=${fechaInicio}&hasta=${fechaFin}&producto_id=${productoId}&canal=${canal}`);
      if (res.ok) {
        const json = await res.json();
        setDetalleItems(json.items || []);
        if (canal === "ajuste" && json.items && json.items.length > 0) {
          const primerAjuste = json.items[0];
          setAjusteKilos(primerAjuste.kilos.toString());
          setAjusteMotivo(primerAjuste.motivo);
        } else if (canal === "ajuste") {
          setAjusteKilos("");
          setAjusteMotivo("");
        }
      }
    } catch (err) {
      console.error("Error al cargar detalle transaccional:", err);
    } finally {
      setCargandoDetalle(false);
    }
  }, [fechaInicio, fechaFin]);

  // Abrir Modal de Detalle/Edición
  const abrirModal = (producto: { id: string; nombre: string }, canal: "compras" | "campo" | "ejecutivas" | "planta" | "ajuste") => {
    setModalProducto(producto);
    setModalCanal(canal);
    setModalAbierto(true);
    obtenerDetalles(producto.id, canal);
  };

  // Guardar Edición Inline de una compra o venta de campo
  const handleGuardarItem = async (itemId: string, originalItem: DetalleItem) => {
    setGuardandoItem(itemId);
    try {
      const kilos = parseFloat(editKilos);
      const jabas = parseInt(editJabas);
      if (isNaN(kilos) || kilos <= 0) {
        alert("Ingrese un peso válido mayor a 0");
        setGuardandoItem(null);
        return;
      }
      if (isNaN(jabas) || jabas < 0) {
        alert("Ingrese una cantidad de jabas válida (mínimo 0)");
        setGuardandoItem(null);
        return;
      }

      if (modalCanal === "compras") {
        // Para compras, necesitamos cargar la compra completa, modificar el item específico y guardar
        const resGet = await fetch(`/api/compras/${originalItem.compra_id}`);
        if (!resGet.ok) throw new Error("No se pudo obtener el detalle de la compra para editar");
        const compra = await resGet.json();

        // Modificar los datos del item correspondiente
        const itemsModificados = compra.items.map((it: { id: string; jabas?: number; peso_bruto?: number; peso_tara?: number }) => {
          if (it.id === itemId) {
            // El backend recalcula peso_neto y subtotal en base a peso_bruto, peso_tara y costo_unitario.
            // Para mantener la consistencia simplificada: peso_bruto = kilos, peso_tara = 0
            return {
              ...it,
              jabas,
              peso_bruto: kilos,
              peso_tara: 0,
            };
          }
          return it;
        });

        const resPut = await fetch(`/api/compras/${originalItem.compra_id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proveedor_id: compra.proveedor_id,
            fecha: compra.fecha.split("T")[0],
            tipo_doc: compra.tipo_doc,
            nro_doc: compra.nro_doc,
            items: itemsModificados,
          }),
        });

        if (!resPut.ok) {
          const errData = await resPut.json();
          throw new Error(errData.error || "No se pudo actualizar la compra");
        }
      } else if (modalCanal === "campo") {
        // Para ventas de campo, obtenemos la venta, modificamos el item y guardamos
        const resGet = await fetch(`/api/avicola/ventas/${originalItem.venta_id}`);
        if (!resGet.ok) throw new Error("No se pudo obtener el detalle de la venta");
        const venta = await resGet.json();

        const itemsModificados = venta.items.map((it: { id: string; jabas?: number; peso_kg?: number }) => {
          if (it.id === itemId) {
            return {
              ...it,
              jabas,
              peso_kg: kilos,
            };
          }
          return it;
        });

        const resPut = await fetch(`/api/avicola/ventas/${originalItem.venta_id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cliente_id: venta.cliente_id,
            fecha: venta.fecha.split("T")[0],
            nro_guia: venta.nro_guia,
            glosa: venta.glosa,
            items: itemsModificados,
          }),
        });

        if (!resPut.ok) {
          const errData = await resPut.json();
          throw new Error(errData.error || "No se pudo actualizar la venta de campo");
        }
      }

      setEditandoItemId(null);
      if (modalProducto && modalCanal) {
        await obtenerDetalles(modalProducto.id, modalCanal);
      }
      cargarCuadre();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Error al actualizar la transacción";
      alert(msg);
    } finally {
      setGuardandoItem(null);
    }
  };

  // Guardar Ajuste Manual de Merma
  const handleGuardarAjuste = async () => {
    if (!modalProducto) return;
    const kilos = parseFloat(ajusteKilos);
    if (isNaN(kilos)) {
      alert("Ingrese un valor numérico de kilos (puede ser negativo para mermas)");
      return;
    }
    if (!ajusteMotivo || ajusteMotivo.trim().length < 3) {
      alert("Ingrese una justificación de al menos 3 caracteres");
      return;
    }

    setGuardandoAjuste(true);
    try {
      const res = await fetch("/api/reportes/cuadre-fisico/ajuste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: fechaInicio, // Usamos fecha de inicio (del período/día)
          producto_id: modalProducto.id,
          kilos_ajuste: kilos,
          motivo: ajusteMotivo.trim(),
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "No se pudo registrar el ajuste");
      }

      alert("Ajuste físico guardado correctamente.");
      setModalAbierto(false);
      cargarCuadre();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Error al registrar ajuste";
      alert(msg);
    } finally {
      setGuardandoAjuste(false);
    }
  };

  // Eliminar Ajuste Manual
  const handleEliminarAjuste = async () => {
    if (!modalProducto) return;
    if (!confirm("¿Está seguro de eliminar este ajuste físico?")) return;

    setGuardandoAjuste(true);
    try {
      const res = await fetch(`/api/reportes/cuadre-fisico/ajuste?fecha=${fechaInicio}&producto_id=${modalProducto.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "No se pudo eliminar el ajuste");
      }

      alert("Ajuste físico eliminado.");
      setModalAbierto(false);
      cargarCuadre();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Error al eliminar ajuste";
      alert(msg);
    } finally {
      setGuardandoAjuste(false);
    }
  };

  // Formatear fecha para el encabezado
  const formatFechaEncabezado = (fechaStr: string) => {
    if (!fechaStr) return "";
    const [y, m, d] = fechaStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("es-PE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const formatFechaCorto = (fechaStr: string) => {
    if (!fechaStr) return "";
    const [y, m, d] = fechaStr.split("-");
    return `${d}/${m}/${y}`;
  };

  // Exportar a PDF vectorial usando jsPDF (Horizontal para que entren todas las columnas)
  const handleExportarPDF = async () => {
    if (!data) return;
    setExportandoPDF(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const periodoTexto =
        fechaInicio === fechaFin
          ? formatFechaEncabezado(fechaInicio)
          : `Del ${formatFechaCorto(fechaInicio)} al ${formatFechaCorto(fechaFin)}`;

      // Cabecera Corporativa
      doc.setFillColor(220, 38, 38); // Rojo
      doc.rect(0, 0, 297, 12, "F");

      doc.setTextColor(220, 38, 38);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("TRANSAVIC & LA AVÍCOLA DE TONY", 148.5, 24, { align: "center" });

      doc.setTextColor(31, 41, 55);
      doc.setFontSize(16);
      doc.text("Cuadración Física e Inventario Diario (Mermas)", 148.5, 32, { align: "center" });

      doc.setTextColor(107, 114, 128);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(periodoTexto, 148.5, 38, { align: "center" });

      // Línea divisoria
      doc.setDrawColor(229, 231, 235);
      doc.setLineWidth(0.5);
      doc.line(15, 43, 282, 43);

      let y = 50;

      // Cabecera de la tabla
      doc.setFillColor(243, 244, 246);
      doc.rect(15, y, 267, 10, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(55, 65, 81);
      doc.text("Producto", 18, y + 6.5);
      doc.text("Compra (kg)", 90, y + 6.5, { align: "right" });
      doc.text("Venta Ejec. (kg)", 125, y + 6.5, { align: "right" });
      doc.text("Venta Campo (kg)", 160, y + 6.5, { align: "right" });
      doc.text("Venta Planta (kg)", 195, y + 6.5, { align: "right" });
      doc.text("Total Venta (kg)", 230, y + 6.5, { align: "right" });
      doc.text("Merma (kg)", 277, y + 6.5, { align: "right" });

      y += 10;

      // Filas
      data.productos.forEach((p) => {
        if (y > 185) {
          doc.addPage();
          y = 20;
          doc.setFillColor(243, 244, 246);
          doc.rect(15, y, 267, 10, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(55, 65, 81);
          doc.text("Producto", 18, y + 6.5);
          doc.text("Compra (kg)", 90, y + 6.5, { align: "right" });
          doc.text("Venta Ejec. (kg)", 125, y + 6.5, { align: "right" });
          doc.text("Venta Campo (kg)", 160, y + 6.5, { align: "right" });
          doc.text("Venta Planta (kg)", 195, y + 6.5, { align: "right" });
          doc.text("Total Venta (kg)", 230, y + 6.5, { align: "right" });
          doc.text("Merma (kg)", 277, y + 6.5, { align: "right" });
          y += 10;
        }

        doc.setDrawColor(243, 244, 246);
        doc.line(15, y + 8, 282, y + 8);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(31, 41, 55);
        doc.text(p.producto_nombre, 18, y + 5);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(75, 85, 99);
        doc.text(p.kg_comprados > 0 ? p.kg_comprados.toFixed(2) : "—", 90, y + 5, { align: "right" });
        doc.text(p.kg_ejecutivas > 0 ? p.kg_ejecutivas.toFixed(2) : "—", 125, y + 5, { align: "right" });
        doc.text(p.kg_campo > 0 ? p.kg_campo.toFixed(2) : "—", 160, y + 5, { align: "right" });
        doc.text(p.kg_planta > 0 ? p.kg_planta.toFixed(2) : "—", 195, y + 5, { align: "right" });
        doc.text(p.kg_vendidos > 0 ? p.kg_vendidos.toFixed(2) : "—", 230, y + 5, { align: "right" });

        // Pintar la merma de color distintivo
        if (p.diferencia < 0) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(220, 38, 38); // Rojo
        } else if (p.diferencia > 0) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(37, 99, 235); // Azul
        } else {
          doc.setFont("helvetica", "normal");
          doc.setTextColor(107, 114, 128);
        }
        doc.text(`${p.diferencia.toFixed(2)} kg`, 277, y + 5, { align: "right" });

        y += 8;
      });

      // Fila de totales consolidado
      y += 2;
      doc.setFillColor(249, 250, 251);
      doc.rect(15, y, 267, 12, "F");
      doc.setDrawColor(209, 213, 219);
      doc.setLineWidth(0.5);
      doc.rect(15, y, 267, 12, "D");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(31, 41, 55);
      doc.text("TOTAL CONSOLIDADO", 18, y + 7.5);
      doc.text(totalCompra > 0 ? `${totalCompra.toFixed(2)} kg` : "—", 90, y + 7.5, { align: "right" });
      doc.text(totalEjecutivas > 0 ? `${totalEjecutivas.toFixed(2)} kg` : "—", 125, y + 7.5, { align: "right" });
      doc.text(totalCampo > 0 ? `${totalCampo.toFixed(2)} kg` : "—", 160, y + 7.5, { align: "right" });
      doc.text(totalPlanta > 0 ? `${totalPlanta.toFixed(2)} kg` : "—", 195, y + 7.5, { align: "right" });
      doc.text(totalVenta > 0 ? `${totalVenta.toFixed(2)} kg` : "—", 230, y + 7.5, { align: "right" });

      if (totalDiferencia < 0) {
        doc.setTextColor(220, 38, 38);
      } else if (totalDiferencia > 0) {
        doc.setTextColor(37, 99, 235);
      }
      doc.text(`${totalDiferencia.toFixed(2)} kg`, 277, y + 7.5, { align: "right" });

      // Footer
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175);
      doc.text("Transavic & La Avícola de Tony · Módulo de Control de Mermas de Carga", 148.5, 198, { align: "center" });

      doc.save(`cuadre-mermas-${fechaInicio}-a-${fechaFin}.pdf`);
    } catch (err) {
      console.error("Error al generar PDF:", err);
      alert("Error al generar el PDF.");
    } finally {
      setExportandoPDF(false);
    }
  };

  const handleCopiarTexto = useCallback(async () => {
    if (!data) return;
    setCopiando(true);

    const periodoTexto =
      fechaInicio === fechaFin
        ? formatFechaEncabezado(fechaInicio)
        : `Del ${formatFechaCorto(fechaInicio)} al ${formatFechaCorto(fechaFin)}`;

    let texto = `*CUADRE FÍSICO DE STOCK Y MERMAS* 📦\n`;
    texto += `📅 *Periodo:* ${periodoTexto}\n\n`;
    texto += `*Detalle por Producto:*\n`;
    texto += `-----------------------\n`;

    data.productos.forEach((p) => {
      texto += `• *${p.producto_nombre}*: Compra: ${p.kg_comprados.toFixed(2)} kg (${p.jabas_compradas} jabas) | Venta: ${p.kg_vendidos.toFixed(2)} kg | Dif: *${p.diferencia.toFixed(2)} kg*\n`;
    });

    texto += `\n🔥 *TOTAL CONSOLIDADO:*\n`;
    texto += `• Kilos Compra: ${totalCompra.toFixed(2)} kg (${totalJabasCompra} jabas)\n`;
    texto += `• Kilos Venta: ${totalVenta.toFixed(2)} kg\n`;
    texto += `• *MERMA / DIFERENCIA:* *${totalDiferencia.toFixed(2)} kg*`;

    try {
      await navigator.clipboard.writeText(texto);
      alert("Resumen de texto copiado al portapapeles. Listo para pegar en WhatsApp.");
    } catch (err) {
      console.error("Error al copiar texto:", err);
    } finally {
      setCopiando(false);
    }
  }, [data, totalCompra, totalJabasCompra, totalVenta, totalDiferencia, fechaInicio, fechaFin]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Controles de Vista */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 shadow-xs flex flex-col md:flex-row md:items-end justify-between gap-5">
        <div className="flex flex-col gap-3 w-full md:w-auto">
          <div className="flex flex-wrap items-center gap-2">
            {(["hoy", "ayer", "7dias", "personalizado"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setTipoPeriodo(mode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider border transition-all cursor-pointer ${
                  tipoPeriodo === mode
                    ? "bg-red-600 text-white border-red-600 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                {mode === "hoy" && "Hoy"}
                {mode === "ayer" && "Ayer"}
                {mode === "7dias" && "Últimos 7 días"}
                {mode === "personalizado" && "Personalizado"}
              </button>
            ))}
          </div>

          {tipoPeriodo === "personalizado" && (
            <div className="flex flex-col sm:flex-row items-center gap-3 border-t border-gray-100 pt-3">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-gray-500 font-semibold">Desde:</span>
                <input
                  type="date"
                  value={fechaInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-red-200"
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-gray-500 font-semibold">Hasta:</span>
                <input
                  type="date"
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-red-200"
                />
              </div>
            </div>
          )}
        </div>

        {data && data.productos.length > 0 && (
          <div className="flex gap-2 w-full md:w-auto">
            <button
              onClick={handleExportarPDF}
              disabled={exportandoPDF}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {exportandoPDF ? <FiLoader className="animate-spin" /> : <FiFileText />}
              <span>Descargar PDF</span>
            </button>
            <button
              onClick={handleCopiarTexto}
              disabled={copiando}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {copiando ? <FiLoader className="animate-spin" /> : <FiCopy />}
              <span>Copiar Resumen</span>
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <FiLoader className="h-8 w-8 text-red-600 animate-spin mb-2" />
          <span className="text-sm text-gray-500">Calculando cuadre de stock y mermas...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 p-4 rounded-xl text-sm text-center">
          {error}
        </div>
      )}

      {/* Resultados de la Consulta */}
      {!loading && !error && data && (
        <>
          {data.productos.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500 text-sm shadow-xs">
              No se registraron movimientos de compra ni venta de carnes para el período seleccionado.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-xs bg-white">
              <div
                className="bg-white p-6 flex flex-col gap-6 select-none overflow-x-auto"
                style={{ width: "100%", minWidth: "900px" }}
              >
                {/* Cabecera del Reporte */}
                <div className="flex justify-between items-end border-b border-gray-100 pb-4">
                  <div>
                    <h2 className="text-xs font-bold text-red-600 tracking-widest uppercase mb-1">
                      TRANSAVIC & LA AVÍCOLA DE TONY
                    </h2>
                    <h1 className="text-lg font-black text-gray-900 tracking-tight">
                      Cuadración Física e Inventario Diario
                    </h1>
                    <p className="text-[11px] font-semibold text-gray-500 mt-1 capitalize">
                      {fechaInicio === fechaFin
                        ? formatFechaEncabezado(fechaInicio)
                        : `Del ${formatFechaCorto(fechaInicio)} al ${formatFechaCorto(fechaFin)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      <FiBox /> Control de Mermas Físicas
                    </span>
                  </div>
                </div>

                {/* Tabla de Balances */}
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 w-1/4">
                        Producto / Categoría
                      </th>
                      <th colSpan={2} className="py-1 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-center bg-amber-50/10 border-b border-amber-100">
                        Carga (Compra)
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Venta Ejecutivas
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Venta Campo
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Venta Planta
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right bg-gray-50/50">
                        Total Vendido
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Ajuste Manual
                      </th>
                      <th rowSpan={2} className="py-2.5 text-[9px] uppercase font-bold tracking-wider text-gray-400 text-right">
                        Diferencia (Merma)
                      </th>
                    </tr>
                    <tr className="border-b border-gray-200">
                      <th className="py-1 text-[8px] uppercase font-bold tracking-wider text-gray-400 text-right bg-amber-50/5 pr-2">
                        Jabas
                      </th>
                      <th className="py-1 text-[8px] uppercase font-bold tracking-wider text-gray-400 text-right bg-amber-50/10 pr-2">
                        Kilos
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs text-gray-800">
                    {data.productos.map((p, i) => (
                      <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 pr-2">
                          <div className="font-bold text-gray-900">{p.producto_nombre}</div>
                          <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-gray-400 mt-0.5 capitalize font-medium">
                            <span>{p.producto_categoria}</span>
                            {p.total_pollos > 0 && (
                              <span className="text-indigo-600 font-bold bg-indigo-50 px-1 py-0.5 rounded-sm flex items-center gap-0.5">
                                🐤 {p.total_pollos} aves (♂{((p.jabas_macho || 0) * 7) + (p.sueltos_macho || 0)} | ♀{((p.jabas_hembra || 0) * 9) + (p.sueltos_hembra || 0)})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-right font-medium tabular-nums text-gray-500 bg-amber-50/5 pr-2">
                          {p.jabas_compradas > 0 ? `${p.jabas_compradas} jab.` : "—"}
                        </td>
                        <td 
                          onClick={() => abrirModal({ id: p.producto_id, nombre: p.producto_nombre }, "compras")}
                          className="py-3 text-right font-bold tabular-nums text-gray-900 bg-amber-50/10 pr-2 cursor-pointer hover:bg-amber-100/50 transition-colors group relative"
                          title="Haga clic para auditar o editar compras"
                        >
                          <span className="border-b border-dashed border-amber-400 pb-0.5 group-hover:text-amber-800">
                            {p.kg_comprados > 0 ? `${p.kg_comprados.toFixed(2)} kg` : "—"}
                          </span>
                        </td>
                        <td 
                          onClick={() => abrirModal({ id: p.producto_id, nombre: p.producto_nombre }, "ejecutivas")}
                          className="py-3 text-right font-medium tabular-nums text-blue-600/80 cursor-pointer hover:bg-blue-50/40 transition-colors group relative"
                          title="Haga clic para ver detalle de ventas ejecutivas"
                        >
                          <span className="border-b border-dashed border-blue-300 pb-0.5 group-hover:text-blue-800">
                            {p.kg_ejecutivas > 0 ? `${p.kg_ejecutivas.toFixed(2)} kg` : "—"}
                          </span>
                        </td>
                        <td 
                          onClick={() => abrirModal({ id: p.producto_id, nombre: p.producto_nombre }, "campo")}
                          className="py-3 text-right font-medium tabular-nums text-amber-600/80 cursor-pointer hover:bg-amber-50/30 transition-colors group relative"
                          title="Haga clic para auditar o editar ventas de campo"
                        >
                          <span className="border-b border-dashed border-amber-400 pb-0.5 group-hover:text-amber-800">
                            {p.kg_campo > 0 ? `${p.kg_campo.toFixed(2)} kg` : "—"}
                          </span>
                        </td>
                        <td 
                          onClick={() => abrirModal({ id: p.producto_id, nombre: p.producto_nombre }, "planta")}
                          className="py-3 text-right font-medium tabular-nums text-violet-600/80 cursor-pointer hover:bg-violet-50/30 transition-colors group relative"
                          title="Haga clic para ver detalle de ventas en planta"
                        >
                          <span className="border-b border-dashed border-violet-400 pb-0.5 group-hover:text-violet-800">
                            {p.kg_planta > 0 ? `${p.kg_planta.toFixed(2)} kg` : "—"}
                          </span>
                        </td>
                        <td className="py-3 text-right font-bold tabular-nums text-gray-900 bg-gray-50/50">
                          {p.kg_vendidos > 0 ? `${p.kg_vendidos.toFixed(2)} kg` : "—"}
                        </td>
                        <td 
                          onClick={() => abrirModal({ id: p.producto_id, nombre: p.producto_nombre }, "ajuste")}
                          className="py-3 text-right font-semibold tabular-nums text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                          title="Haga clic para registrar ajuste manual"
                        >
                          {p.kg_ajuste !== 0 ? (
                            <span className={`border-b border-dashed pb-0.5 ${p.kg_ajuste > 0 ? "text-emerald-600 border-emerald-400 font-bold" : "text-rose-600 border-rose-400 font-bold"}`}>
                              {p.kg_ajuste > 0 ? `+${p.kg_ajuste.toFixed(2)}` : p.kg_ajuste.toFixed(2)} kg
                            </span>
                          ) : (
                            <span className="text-gray-300 hover:text-gray-500 border-b border-dashed border-gray-200 pb-0.5 font-normal">
                              + Ajuste
                            </span>
                          )}
                        </td>
                        <td className={`py-3 text-right font-black tabular-nums ${
                          p.diferencia < 0 
                            ? "text-red-600 bg-red-50/20" 
                            : p.diferencia > 0 
                            ? "text-blue-600 bg-blue-50/10" 
                            : "text-gray-500"
                        }`}>
                          <div>{p.diferencia !== 0 ? `${p.diferencia.toFixed(2)} kg` : "0.00 kg"}</div>
                          {p.kg_merma_estimada > 0 && (
                            <div className="text-[9px] font-bold text-gray-400 mt-0.5" title="Merma teórica estimada de beneficio">
                              Est: {p.kg_merma_estimada.toFixed(2)} kg
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}

                    {/* Fila de Totales */}
                    <tr className="bg-gray-50/70 font-bold border-t-2 border-gray-200">
                      <td className="py-3.5 pl-2 text-xs uppercase font-bold text-gray-600">
                        <div>TOTAL CONSOLIDADO</div>
                        {totalPollos > 0 && (
                          <div className="text-[9px] text-indigo-600 font-bold mt-0.5 capitalize Normal flex items-center gap-0.5">
                            🐤 {totalPollos} aves (♂{((totalJabasMacho * 7) + totalSueltosMacho)} | ♀{((totalJabasHembra * 9) + totalSueltosHembra)})
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-gray-600 bg-amber-50/10 pr-2">
                        {totalJabasCompra > 0 ? `${totalJabasCompra} jab.` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-gray-900 bg-amber-50/20 pr-2">
                        {totalCompra > 0 ? `${totalCompra.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-blue-700">
                        {totalEjecutivas > 0 ? `${totalEjecutivas.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-amber-700">
                        {totalCampo > 0 ? `${totalCampo.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-violet-700">
                        {totalPlanta > 0 ? `${totalPlanta.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-gray-900 bg-gray-50">
                        {totalVenta > 0 ? `${totalVenta.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-3.5 text-right tabular-nums text-gray-700">
                        {totalAjuste !== 0 ? `${totalAjuste > 0 ? "+" : ""}${totalAjuste.toFixed(2)} kg` : "—"}
                      </td>
                      <td className={`py-3.5 text-right tabular-nums text-sm font-black ${
                        totalDiferencia < 0 ? "text-red-700 bg-red-50/40" : "text-blue-700 bg-blue-50/20"
                      }`}>
                        <div>{totalDiferencia.toFixed(2)} kg</div>
                        {totalMermaEstimada > 0 && (
                          <div className="text-[9px] font-bold text-gray-400 mt-0.5">
                            Est: {totalMermaEstimada.toFixed(2)} kg
                          </div>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Pie de Página */}
                <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                  <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">
                    Transavic & La Avícola de Tony · Módulo de Control de Mermas de Carga
                  </span>
                  <span className="text-[9px] text-gray-400">
                    Generado el {new Date().toLocaleDateString("es-PE")} a las{" "}
                    {new Date().toLocaleTimeString("es-PE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Slide-over de Auditoría y Ajustes */}
      {modalAbierto && modalProducto && modalCanal && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex justify-end transition-opacity duration-300">
          <div className="bg-white w-full max-w-lg h-full shadow-2xl flex flex-col p-6 overflow-y-auto relative animate-in slide-in-from-right duration-200">
            {/* Cabecera */}
            <div className="flex justify-between items-start border-b border-gray-100 pb-4 mb-5">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-red-600 block mb-1">
                  {modalCanal === "compras" && "Carga y Compras"}
                  {modalCanal === "campo" && "Ventas de Campo"}
                  {modalCanal === "ejecutivas" && "Ventas Ejecutivas"}
                  {modalCanal === "planta" && "Ventas de Planta"}
                  {modalCanal === "ajuste" && "Ajuste de Auditoría"}
                </span>
                <h3 className="text-base font-black text-gray-900 leading-tight">
                  {modalProducto.nombre}
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  {fechaInicio === fechaFin 
                    ? `Período: ${formatFechaCorto(fechaInicio)}`
                    : `Período: ${formatFechaCorto(fechaInicio)} al ${formatFechaCorto(fechaFin)}`}
                </p>
              </div>
              <button 
                onClick={() => setModalAbierto(false)}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-900 transition-colors cursor-pointer"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>

            {/* Contenido principal */}
            <div className="flex-1 flex flex-col">
              {cargandoDetalle ? (
                <div className="flex flex-col items-center justify-center py-20 flex-1">
                  <FiLoader className="h-8 w-8 text-red-600 animate-spin mb-2" />
                  <span className="text-xs text-gray-500 font-medium">Cargando registros...</span>
                </div>
              ) : modalCanal === "ajuste" ? (
                /* VISTA AJUSTE MANUAL */
                <div className="flex flex-col gap-5 flex-1">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-amber-800 text-xs leading-relaxed">
                    <FiInfo className="h-5 w-5 shrink-0 mt-0.5" />
                    <div>
                      Los ajustes manuales modifican el cuadre físico final sumando o restando kilos directos al balance. 
                      Úsalo para registrar mermas extraordinarias, mermas por traslado o corrección de balanza.
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-gray-700">Ajuste Neto (kg):</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      value={ajusteKilos} 
                      onChange={(e) => setAjusteKilos(e.target.value)} 
                      placeholder="Ej: -5.50 o 10.00"
                      className="px-3.5 py-2 border border-gray-200 rounded-xl text-sm bg-white text-gray-900 focus:ring-2 focus:ring-red-200 outline-none w-full"
                    />
                    <span className="text-[10px] text-gray-400">Usa números negativos (-) para mermas o pérdidas, y positivos (+) para excedentes.</span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-gray-700">Justificación / Motivo:</label>
                    <textarea 
                      rows={3}
                      value={ajusteMotivo} 
                      onChange={(e) => setAjusteMotivo(e.target.value)} 
                      placeholder="Indique el motivo detallado del ajuste..."
                      className="px-3.5 py-2 border border-gray-200 rounded-xl text-sm bg-white text-gray-900 focus:ring-2 focus:ring-red-200 outline-none w-full resize-none"
                    />
                  </div>

                  <div className="mt-auto pt-4 border-t border-gray-100 flex gap-2">
                    {detalleItems.length > 0 && (
                      <button 
                        onClick={handleEliminarAjuste}
                        disabled={guardandoAjuste}
                        className="px-4 py-2 border border-red-200 hover:bg-red-50 text-red-700 text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Eliminar Ajuste
                      </button>
                    )}
                    <button 
                      onClick={handleGuardarAjuste}
                      disabled={guardandoAjuste}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-700 hover:bg-red-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {guardandoAjuste ? <FiLoader className="animate-spin" /> : <FiCheck />}
                      <span>Guardar Ajuste Físico</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* VISTA DESGLOSE DE DOCUMENTOS */
                <div className="flex flex-col gap-4 flex-1">
                  {detalleItems.length === 0 ? (
                    <div className="text-center py-20 text-xs text-gray-400 font-medium">
                      No se encontraron transacciones registradas para este canal.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {detalleItems.map((item, index) => {
                        const esEdicion = editandoItemId === item.item_id;
                        const esEditable = ["compras", "campo"].includes(modalCanal);

                        return (
                          <div 
                            key={index} 
                            className={`border rounded-xl p-4 transition-all ${
                              esEdicion 
                                ? "border-red-500 bg-red-50/10 shadow-sm" 
                                : "border-gray-100 bg-gray-50/30 hover:border-gray-200"
                            }`}
                          >
                            <div className="flex justify-between items-start gap-2 mb-2.5">
                              <div>
                                <span className="text-[10px] text-gray-400 font-medium">{formatFechaCorto(item.fecha)}</span>
                                <h4 className="text-xs font-bold text-gray-900 mt-0.5">
                                  {item.proveedor_nombre || item.cliente_nombre || "Cliente General"}
                                </h4>
                                <span className="text-[10px] text-gray-500 mt-1 block">
                                  Doc: <strong className="text-gray-700">{item.nro_doc || item.nro_guia || item.nro_pedido || "Sin Nro"}</strong>
                                </span>
                              </div>

                              {esEditable && !esEdicion && (
                                <button 
                                  onClick={() => {
                                    setEditandoItemId(item.item_id);
                                    setEditKilos(item.kilos.toString());
                                    setEditJabas(item.jabas?.toString() || "0");
                                  }}
                                  className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                                  title="Editar transacción"
                                >
                                  <FiEdit className="h-4 w-4" />
                                </button>
                              )}
                            </div>

                            {esEdicion ? (
                              /* FORMULARIO EDICIÓN INLINE */
                              <div className="flex flex-col gap-3 border-t border-red-100 pt-3 mt-1.5">
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-gray-500">Jabas:</label>
                                    <input 
                                      type="number" 
                                      value={editJabas} 
                                      onChange={(e) => setEditJabas(e.target.value)} 
                                      className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-gray-900 focus:ring-1 focus:ring-red-200 outline-none w-full"
                                    />
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-gray-500">Kilos Netos:</label>
                                    <input 
                                      type="number" 
                                      step="0.01"
                                      value={editKilos} 
                                      onChange={(e) => setEditKilos(e.target.value)} 
                                      className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-gray-900 focus:ring-1 focus:ring-red-200 outline-none w-full"
                                    />
                                  </div>
                                </div>

                                <div className="flex justify-end gap-2 pt-1">
                                  <button 
                                    onClick={() => setEditandoItemId(null)}
                                    className="px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                                  >
                                    Cancelar
                                  </button>
                                  <button 
                                    onClick={() => handleGuardarItem(item.item_id, item)}
                                    disabled={guardandoItem === item.item_id}
                                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-red-700 hover:bg-red-800 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                                  >
                                    {guardandoItem === item.item_id ? <FiLoader className="animate-spin" /> : <FiCheck />}
                                    <span>Guardar</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              /* VISTA DE VALORES */
                              <div className="flex items-center gap-4 text-xs mt-1 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                                {item.jabas !== undefined && (
                                  <div>
                                    <span className="text-[10px] text-gray-400 font-semibold block uppercase">Jabas</span>
                                    <span className="font-bold text-gray-700">{item.jabas} jab.</span>
                                  </div>
                                )}
                                <div>
                                  <span className="text-[10px] text-gray-400 font-semibold block uppercase font-mono">Kilos</span>
                                  <span className="font-extrabold text-red-600">{item.kilos.toFixed(2)} kg</span>
                                </div>
                                {item.total_pollos !== undefined && item.total_pollos > 0 && (
                                   <div className="border-l border-gray-200 pl-3">
                                     <span className="text-[10px] text-gray-400 font-semibold block uppercase">Aves (♂|♀)</span>
                                     <span className="font-bold text-indigo-600">
                                       🐤 {item.total_pollos} (♂{((item.jabas_macho || 0) * 7) + (item.sueltos_macho || 0)}|♀{((item.jabas_hembra || 0) * 9) + (item.sueltos_hembra || 0)})
                                     </span>
                                   </div>
                                 )}
                                {item.precio_unitario !== undefined && (
                                  <div className="ml-auto text-right">
                                    <span className="text-[10px] text-gray-400 block uppercase">P. Unitario</span>
                                    <span className="font-semibold text-gray-600">S/ {item.precio_unitario.toFixed(2)}</span>
                                  </div>
                                )}
                                {item.costo_unitario !== undefined && (
                                  <div className="ml-auto text-right">
                                    <span className="text-[10px] text-gray-400 block uppercase">Costo Unit.</span>
                                    <span className="font-semibold text-gray-600">S/ {item.costo_unitario.toFixed(2)}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
