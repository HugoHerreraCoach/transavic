// src/app/dashboard/clientes-avicola/[id]/venta/venta-client.tsx
// UI de la VENTA RÁPIDA en campo (móvil primero, objetivo: <1 minuto).
// Flujo: tocar producto → escribir peso (precio ya precargado) → Guardar →
// modal de la guía para compartir por WhatsApp.
// Idempotencia: el id de la venta se genera UNA vez al montar (crypto.randomUUID)
// y se reusa en cada reintento — el server devuelve la misma venta si ya existe.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ClienteAvicolaConSaldo,
  GuiaAvicolaData,
} from "@/lib/avicola/types";
import { UMBRAL_DEUDA } from "@/lib/avicola/saldos";
import GuiaAvicolaModal from "../../guia-avicola-modal";
import {
  FiArrowLeft,
  FiTrash2,
  FiAlertTriangle,
  FiChevronDown,
  FiChevronUp,
  FiLoader,
  FiCalendar,
  FiEdit2,
  FiSearch,
  FiX,
  FiStar,
  FiRotateCcw,
} from "react-icons/fi";

/** Productos que el GG fija a mano para verlos siempre arriba (por dispositivo). */
const CLAVE_FAVORITOS = "transavic_avicola_favoritos";

/** Producto del catálogo tal como lo precarga page.tsx (precio ya numérico). */
export interface ProductoVentaAvicola {
  id: string;
  nombre: string;
  categoria: string;
  precio_venta: number | null;
}

export interface VentaExistenteProps {
  id: string;
  numero_guia: number;
  fecha: string;
  observaciones: string | null;
  items: Array<{
    producto_id: string | null;
    producto_nombre: string;
    peso: string;
    precio: string;
  }>;
}

/** Ítem de la última venta del cliente (alimenta "Repetir última venta"). */
export interface ItemUltimaVenta {
  producto_id: string;
  producto_nombre: string;
  precio: number;
}

interface VentaAvicolaClientProps {
  cliente: ClienteAvicolaConSaldo;
  productos: ProductoVentaAvicola[];
  /** producto_id → último precio/kg pactado con ESTE cliente. */
  ultimosPrecios: Record<string, number>;
  /** "Lo de siempre": ids que ESTE cliente ya compró, ordenados por frecuencia. */
  historialIds: string[];
  /** Top del módulo; solo se muestra si el cliente aún no tiene historial. */
  masVendidosIds: string[];
  /** Ítems de la última venta del cliente (vacío si nunca compró). */
  ultimaVentaItems: ItemUltimaVenta[];
  ventaExistente?: VentaExistenteProps | null;
}

/** Línea de la venta en edición. Peso y precio quedan como texto crudo. */
interface LineaVenta {
  producto_id: string;
  producto_nombre: string;
  peso: string;
  precio: string;
}

interface ErrorEnvio {
  mensaje: string;
  /** true = error de red/500 → se ofrece "Reintentar" con el MISMO id. */
  reintentable: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Number() tolerando coma decimal (teclados móviles en es-PE la ofrecen). */
function aNumero(valor: string): number {
  return Number(valor.trim().replace(",", "."));
}

/** Solo dígitos y separador decimal — evita basura en inputs de campo. */
function limpiarDecimal(valor: string): string {
  return valor.replace(/[^\d.,]/g, "");
}

/** Encabezado fino de sección (no debe robarle altura a los productos). */
function TituloSeccion({
  icono,
  children,
}: {
  icono: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">
      {icono}
      {children}
    </h2>
  );
}

/** Tarjeta de producto: tocar el cuerpo lo agrega; la estrella lo fija arriba. */
function TarjetaProducto({
  producto,
  ultimo,
  enVenta,
  esFavorito,
  onAdd,
  onToggleFavorito,
}: {
  producto: ProductoVentaAvicola;
  ultimo?: number;
  enVenta: boolean;
  esFavorito: boolean;
  onAdd: (p: ProductoVentaAvicola) => void;
  onToggleFavorito: (id: string) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onAdd(producto)}
        className={`w-full rounded-2xl border bg-white p-3 pr-9 text-left transition-transform active:scale-95 cursor-pointer ${
          enVenta
            ? "border-red-400 ring-1 ring-red-400"
            : "border-gray-200 hover:border-red-300"
        }`}
      >
        <span className="block font-semibold leading-tight text-gray-900">
          {producto.nombre}
        </span>
        <span className="mt-1 block text-sm font-bold text-red-600">
          S/ {(ultimo ?? producto.precio_venta ?? 0).toFixed(2)}/kg{" "}
          <span className="font-medium text-gray-400">
            · {ultimo !== undefined ? "último" : "catálogo"}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onToggleFavorito(producto.id)}
        aria-label={
          esFavorito
            ? `Quitar ${producto.nombre} de los fijados`
            : `Fijar ${producto.nombre} arriba`
        }
        className="absolute right-0.5 top-0.5 p-2 rounded-full transition-transform active:scale-90"
      >
        <FiStar
          size={16}
          className={
            esFavorito ? "fill-amber-400 text-amber-500" : "text-gray-300"
          }
        />
      </button>
    </div>
  );
}

export default function VentaAvicolaClient({
  cliente,
  productos,
  ultimosPrecios,
  historialIds,
  masVendidosIds,
  ultimaVentaItems,
  ventaExistente,
}: VentaAvicolaClientProps) {
  const router = useRouter();

  // Hoy en zona Lima (YYYY-MM-DD)
  const hoyLima = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date()),
    []
  );

  const [lineas, setLineas] = useState<LineaVenta[]>(() => {
    if (ventaExistente) {
      return ventaExistente.items.map((it) => ({
        producto_id: it.producto_id || "",
        producto_nombre: it.producto_nombre,
        peso: it.peso,
        precio: it.precio,
      }));
    }
    return [];
  });

  const [fecha, setFecha] = useState(() => ventaExistente?.fecha ?? hoyLima);
  const [observaciones, setObservaciones] = useState(() => ventaExistente?.observaciones ?? "");
  const [mostrarObservaciones, setMostrarObservaciones] = useState(() => !!ventaExistente?.observaciones);
  // Fecha compacta: por defecto "Hoy" (el ~99% de las ventas). El selector se abre
  // solo para registrar/corregir una venta de un día pasado (domingos, feriados).
  const [mostrarFecha, setMostrarFecha] = useState(false);
  const esRetroactiva = fecha !== hoyLima;
  const fechaCorta = useMemo(
    () =>
      new Intl.DateTimeFormat("es-PE", {
        day: "numeric",
        month: "short",
        timeZone: "America/Lima",
      }).format(new Date(`${fecha}T12:00:00`)),
    [fecha]
  );
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  /** Productos fijados a mano (estrella). Se guardan por dispositivo. */
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [errorEnvio, setErrorEnvio] = useState<ErrorEnvio | null>(null);
  const [guia, setGuia] = useState<GuiaAvicolaData | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  // Id de la venta: se genera UNA sola vez al montar (o se usa el de la venta a editar)
  // y NO cambia en reintentos (clave de idempotencia contra doble-tap).
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) {
    idRef.current = ventaExistente?.id ?? crypto.randomUUID();
  }

  // Refs a los inputs de peso por producto, para el autofocus de la línea nueva.
  const pesoRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!focusId) return;
    const input = pesoRefs.current[focusId];
    if (input) {
      input.focus();
      input.select();
    }
    setFocusId(null);
  }, [focusId]);

  // Favoritos fijados a mano (persisten por dispositivo, no por cliente).
  useEffect(() => {
    try {
      const crudo = window.localStorage.getItem(CLAVE_FAVORITOS);
      if (!crudo) return;
      const ids: unknown = JSON.parse(crudo);
      if (Array.isArray(ids)) {
        setFavoritos(ids.filter((i): i is string => typeof i === "string"));
      }
    } catch {
      // localStorage corrupto o no disponible: se ignora, no es crítico.
    }
  }, []);

  const toggleFavorito = (productoId: string) => {
    setFavoritos((prev) => {
      const nuevos = prev.includes(productoId)
        ? prev.filter((i) => i !== productoId)
        : [...prev, productoId];
      try {
        window.localStorage.setItem(CLAVE_FAVORITOS, JSON.stringify(nuevos));
      } catch {
        // Sin espacio/modo privado: el fijado queda solo en memoria.
      }
      return nuevos;
    });
  };

  // Validación + total. Peso: > 0. Precio: >= 0. Vacío = inválido.
  const analisis = useMemo(() => {
    let total = 0;
    let hayPesoInvalido = false;
    let hayPrecioInvalido = false;
    const subtotales: Record<string, number | null> = {};
    for (const linea of lineas) {
      const peso = aNumero(linea.peso);
      const precio = aNumero(linea.precio);
      const pesoValido =
        linea.peso.trim() !== "" && Number.isFinite(peso) && peso > 0;
      const precioValido =
        linea.precio.trim() !== "" && Number.isFinite(precio) && precio >= 0;
      if (!pesoValido) hayPesoInvalido = true;
      if (!precioValido) hayPrecioInvalido = true;
      if (pesoValido && precioValido) {
        const subtotal = round2(peso * precio);
        subtotales[linea.producto_id] = subtotal;
        total = round2(total + subtotal);
      } else {
        subtotales[linea.producto_id] = null;
      }
    }
    return { total, hayPesoInvalido, hayPrecioInvalido, subtotales };
  }, [lineas]);

  const puedeGuardar =
    lineas.length > 0 &&
    !analisis.hayPesoInvalido &&
    !analisis.hayPrecioInvalido;

  let motivoBloqueo: string | null = null;
  if (lineas.length === 0) {
    motivoBloqueo = "Toca un producto para agregarlo a la venta.";
  } else if (analisis.hayPesoInvalido) {
    motivoBloqueo = "Ingresa el peso para continuar.";
  } else if (analisis.hayPrecioInvalido) {
    motivoBloqueo = "Revisa el precio para continuar.";
  }

  // En modo edición el saldo actual YA incluye esta venta con su total original;
  // para proyectar bien hay que descontar ese total antes de sumar el nuevo (si no,
  // la venta se contaría dos veces y el "saldo quedará en…" saldría inflado).
  const totalOriginal = useMemo(() => {
    if (!ventaExistente) return 0;
    return ventaExistente.items.reduce((acc, it) => {
      const p = aNumero(it.peso);
      const pr = aNumero(it.precio);
      return Number.isFinite(p) && Number.isFinite(pr)
        ? round2(acc + round2(p * pr))
        : acc;
    }, 0);
  }, [ventaExistente]);

  const saldoProyectado = round2(cliente.saldo_actual - totalOriginal + analisis.total);
  const tieneDeuda = cliente.saldo_actual > UMBRAL_DEUDA;

  // Buscador del catálogo: filtra por nombre o categoría para no scrollear ~90 ítems.
  const hayBusqueda = busqueda.trim() !== "";
  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        p.categoria.toLowerCase().includes(q)
    );
  }, [productos, busqueda]);

  // Secciones del catálogo (sin buscar): primero lo fijado a mano, luego lo que ESTE
  // cliente compra siempre (por frecuencia), y para clientes nuevos el top del módulo.
  // Cada producto aparece UNA sola vez: el resto cae en "Todo el catálogo".
  const { fijados, loDeSiempre, masVendidos, resto } = useMemo(() => {
    const porId = new Map(productos.map((p) => [p.id, p]));
    const usados = new Set<string>();
    const tomar = (ids: string[]) => {
      const lista: ProductoVentaAvicola[] = [];
      for (const id of ids) {
        const p = porId.get(id);
        if (p && !usados.has(id)) {
          lista.push(p);
          usados.add(id);
        }
      }
      return lista;
    };

    const fijadosLista = tomar(favoritos);
    const siempreLista = tomar(historialIds);
    // El top global solo tiene sentido si el cliente todavía no compró nada.
    const topLista = historialIds.length === 0 ? tomar(masVendidosIds) : [];
    const restoLista = productos.filter((p) => !usados.has(p.id));

    return {
      fijados: fijadosLista,
      loDeSiempre: siempreLista,
      masVendidos: topLista,
      resto: restoLista,
    };
  }, [productos, favoritos, historialIds, masVendidosIds]);

  // "Repetir última venta": siembra los mismos productos con su precio; los pesos
  // quedan vacíos porque son los que cambian cada día. Solo con el carrito vacío
  // (nunca pisa lo que el usuario ya cargó).
  const puedeRepetir =
    !ventaExistente && ultimaVentaItems.length > 0 && lineas.length === 0;

  // Vista previa de QUÉ trae el botón: hasta 2 nombres (truncados, porque los del
  // catálogo son larguísimos: "Corazón de res para anticucho por entero…") + una
  // píldora con el TOTAL. Se muestra el total y no "+N restantes" a propósito: con
  // el texto truncado, un "+1 más" haría creer que son 2 cuando son 3. El total
  // nunca miente, y la píldora no se recorta (`shrink-0`).
  const resumenUltimaVenta = useMemo(
    () => ({
      texto: ultimaVentaItems
        .slice(0, 2)
        .map((it) => it.producto_nombre)
        .join(" · "),
      total: ultimaVentaItems.length,
    }),
    [ultimaVentaItems]
  );

  // Lectura completa para lectores de pantalla (la línea visible va truncada).
  const etiquetaRepetir = `Repetir última venta: ${ultimaVentaItems
    .map((it) => it.producto_nombre)
    .join(", ")} — ${ultimaVentaItems.length} ${
    ultimaVentaItems.length === 1 ? "producto" : "productos"
  }`;

  const repetirUltimaVenta = () => {
    if (ultimaVentaItems.length === 0) return;
    setLineas(
      ultimaVentaItems.map((it) => ({
        producto_id: it.producto_id,
        producto_nombre: it.producto_nombre,
        peso: "",
        precio: it.precio.toFixed(2),
      }))
    );
    setFocusId(ultimaVentaItems[0].producto_id);
  };

  const agregarProducto = (producto: ProductoVentaAvicola) => {
    const existente = lineas.find((l) => l.producto_id === producto.id);
    if (existente) {
      // Ya está en la venta: NO duplicar, solo llevar el foco a su peso.
      setFocusId(producto.id);
      return;
    }
    const precioPrecargado =
      ultimosPrecios[producto.id] ?? producto.precio_venta ?? 0;
    setLineas((prev) => [
      ...prev,
      {
        producto_id: producto.id,
        producto_nombre: producto.nombre,
        peso: "",
        precio: precioPrecargado.toFixed(2),
      },
    ]);
    setFocusId(producto.id);
  };

  const quitarLinea = (productoId: string) => {
    setLineas((prev) => prev.filter((l) => l.producto_id !== productoId));
    delete pesoRefs.current[productoId];
  };

  const actualizarLinea = (
    productoId: string,
    campo: "peso" | "precio",
    valor: string
  ) => {
    const limpio = limpiarDecimal(valor);
    setLineas((prev) =>
      prev.map((l) =>
        l.producto_id === productoId ? { ...l, [campo]: limpio } : l
      )
    );
  };

  const enviarVenta = async () => {
    if (guardando || !puedeGuardar) return;
    setGuardando(true);
    setErrorEnvio(null);
    try {
      const url = ventaExistente ? `/api/avicola/ventas/${idRef.current}` : "/api/avicola/ventas";
      const method = ventaExistente ? "PATCH" : "POST";
      
      const payload: Record<string, unknown> = {
        items: lineas.map((l) => ({
          producto_id: l.producto_id || null,
          producto_nombre: l.producto_nombre,
          peso_kg: aNumero(l.peso),
          precio_kg: aNumero(l.precio),
        })),
        observaciones: observaciones.trim() || null,
      };

      if (!ventaExistente) {
        payload.id = idRef.current;
        payload.cliente_id = cliente.id;
      }
      if (fecha && fecha !== hoyLima) {
        payload.fecha = fecha;
      } else if (ventaExistente && fecha) {
        payload.fecha = fecha; // Siempre mandar en edición para actualizarla
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        // En ambos casos hay guía devuelta
        const data = (await res.json()) as { guia: GuiaAvicolaData };
        setGuia(data.guia);
        return;
      }

      if (res.status === 400 || res.status === 404 || res.status === 409) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErrorEnvio({
          mensaje: data?.error ?? "No se pudo registrar la venta.",
          reintentable: false,
        });
        return;
      }

      setErrorEnvio({
        mensaje: "No se pudo guardar. Revisa tu señal e inténtalo de nuevo.",
        reintentable: true,
      });
    } catch (error) {
      console.error("Error al enviar la venta avícola:", error);
      setErrorEnvio({
        mensaje: "No se pudo guardar. Revisa tu señal e inténtalo de nuevo.",
        reintentable: true,
      });
    } finally {
      setGuardando(false);
    }
  };

  /** Grilla de tarjetas, reusada por todas las secciones y por la búsqueda. */
  const renderGrid = (lista: ProductoVentaAvicola[]) => (
    <div className="grid grid-cols-2 gap-3">
      {lista.map((producto) => (
        <TarjetaProducto
          key={producto.id}
          producto={producto}
          ultimo={ultimosPrecios[producto.id]}
          enVenta={lineas.some((l) => l.producto_id === producto.id)}
          esFavorito={favoritos.includes(producto.id)}
          onAdd={agregarProducto}
          onToggleFavorito={toggleFavorito}
        />
      ))}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-lg px-4">
      {/* Header fino sticky: volver + cliente + saldo. En móvil queda debajo
          del header fijo del DashboardLayout (64px), en desktop pega arriba. */}
      <header className="sticky top-16 lg:top-0 z-30 -mx-4 space-y-2 border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
        <Link
          href={`/dashboard/clientes-avicola/${cliente.id}`}
          aria-label="Volver a la ficha del cliente"
          className="-ml-2 p-2 text-gray-600 hover:text-gray-900"
        >
          <FiArrowLeft size={22} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold leading-tight text-gray-900">
            {ventaExistente ? `Editar Venta - ${cliente.nombre}` : cliente.nombre}
          </p>
          <p
            className={`text-xs font-semibold ${
              tieneDeuda ? "text-red-600" : "text-gray-500"
            }`}
          >
            Saldo actual: S/ {cliente.saldo_actual.toFixed(2)}
          </p>
        </div>

        {/* Fecha compacta: "Hoy" por defecto; el selector se abre solo para retroceder. */}
        <div className="shrink-0">
          {mostrarFecha ? (
            <input
              type="date"
              value={fecha}
              max={hoyLima}
              autoFocus
              aria-label="Fecha de la venta"
              onChange={(e) => setFecha(e.target.value)}
              onBlur={() => {
                if (fecha === hoyLima) setMostrarFecha(false);
              }}
              className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-800 outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setMostrarFecha(true)}
              aria-label="Cambiar la fecha de la venta"
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${
                esRetroactiva
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-gray-200 bg-gray-50 text-gray-600"
              }`}
            >
              <FiCalendar
                size={14}
                className={esRetroactiva ? "text-amber-600" : "text-gray-400"}
              />
              {esRetroactiva ? fechaCorta : "Hoy"}
            </button>
          )}
        </div>
        </div>

        {/* Buscador de productos: filtra el catálogo (queda fijo mientras scrolleas). */}
        <div className="relative">
          <FiSearch
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            size={16}
          />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto (pollo, alas, res…)"
            aria-label="Buscar producto"
            className="w-full rounded-xl border border-gray-300 bg-gray-50 py-2 pl-9 pr-9 text-base text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
            >
              <FiX size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Banner de modo edición: deja claro que corrige una venta ya registrada. */}
      {ventaExistente && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <FiEdit2 size={15} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-xs font-semibold leading-snug text-amber-800">
            Editando la guía N.º {String(ventaExistente.numero_guia).padStart(8, "0")}.
            Al guardar se reenvía la guía corregida.
          </p>
        </div>
      )}

      {/* Atajo: repite los productos de la última venta (los pesos cambian a diario). */}
      {puedeRepetir && (
        <section className="pt-4">
          <button
            type="button"
            onClick={repetirUltimaVenta}
            aria-label={etiquetaRepetir}
            className="flex w-full flex-col items-center gap-0.5 rounded-2xl border-2 border-dashed border-red-300 bg-red-50 px-3 py-2.5 transition-transform active:scale-[0.99]"
          >
            <span className="flex items-center gap-2 text-sm font-bold text-red-700">
              <FiRotateCcw size={16} />
              Repetir última venta
            </span>
            <span className="flex w-full items-center justify-center gap-1.5 text-xs font-medium text-red-600/80">
              <span className="min-w-0 truncate">{resumenUltimaVenta.texto}</span>
              {resumenUltimaVenta.total > 1 && (
                <span className="shrink-0 whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 font-bold text-red-700">
                  {resumenUltimaVenta.total} productos
                </span>
              )}
            </span>
          </button>
        </section>
      )}

      {/* Productos. Al BUSCAR se aplanan las secciones en una sola lista filtrada:
          el buscador manda y no hay que pensar en secciones. */}
      <section className="pt-4">
        {productos.length === 0 ? (
          <p className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-500">
            No hay productos activos en el catálogo.
          </p>
        ) : hayBusqueda ? (
          productosFiltrados.length === 0 ? (
            <div className="rounded-xl bg-gray-50 p-4 text-center">
              <p className="text-sm text-gray-500">
                No se encontró “{busqueda.trim()}”.
              </p>
              <button
                type="button"
                onClick={() => setBusqueda("")}
                className="mt-1 text-sm font-bold text-red-600 hover:underline"
              >
                Limpiar búsqueda
              </button>
            </div>
          ) : (
            renderGrid(productosFiltrados)
          )
        ) : (
          <div className="space-y-5">
            {fijados.length > 0 && (
              <div>
                <TituloSeccion
                  icono={
                    <FiStar size={12} className="fill-amber-400 text-amber-500" />
                  }
                >
                  Fijados
                </TituloSeccion>
                {renderGrid(fijados)}
              </div>
            )}

            {loDeSiempre.length > 0 && (
              <div>
                <TituloSeccion
                  icono={<FiRotateCcw size={12} className="text-red-500" />}
                >
                  Lo de siempre
                </TituloSeccion>
                {renderGrid(loDeSiempre)}
              </div>
            )}

            {masVendidos.length > 0 && (
              <div>
                <TituloSeccion
                  icono={<FiStar size={12} className="text-gray-400" />}
                >
                  Más vendidos
                </TituloSeccion>
                {renderGrid(masVendidos)}
              </div>
            )}

            {resto.length > 0 && (
              <div>
                {(fijados.length > 0 ||
                  loDeSiempre.length > 0 ||
                  masVendidos.length > 0) && (
                  <TituloSeccion icono={null}>Todo el catálogo</TituloSeccion>
                )}
                {renderGrid(resto)}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Su pedido: líneas con peso × precio = subtotal */}
      <section className="pt-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
          Su pedido
        </h2>
        {lineas.length === 0 ? (
          <p className="mt-2 rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-500">
            Aún no hay productos. Toca uno arriba para empezar.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {lineas.map((linea) => {
              const subtotal = analisis.subtotales[linea.producto_id];
              return (
                <div
                  key={linea.producto_id}
                  className="rounded-2xl border border-gray-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold leading-tight text-gray-900">
                      {linea.producto_nombre}
                    </p>
                    <button
                      type="button"
                      onClick={() => quitarLinea(linea.producto_id)}
                      aria-label={`Quitar ${linea.producto_nombre}`}
                      className="p-1 text-gray-400 hover:text-red-500"
                    >
                      <FiTrash2 size={18} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
                    <input
                      ref={(el) => {
                        pesoRefs.current[linea.producto_id] = el;
                      }}
                      type="text"
                      inputMode="decimal"
                      value={linea.peso}
                      onChange={(e) =>
                        actualizarLinea(
                          linea.producto_id,
                          "peso",
                          e.target.value
                        )
                      }
                      onFocus={(e) => e.target.select()}
                      placeholder="Peso"
                      aria-label={`Peso en kilos de ${linea.producto_nombre}`}
                      className="w-24 rounded-xl border border-gray-300 py-3 px-2 text-center text-lg font-semibold tabular-nums text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                    />
                    <span className="text-xs font-semibold text-gray-500">
                      kg
                    </span>
                    <span className="text-xs font-bold text-gray-400">×</span>
                    <span className="text-xs font-semibold text-gray-500">
                      S/
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={linea.precio}
                      onChange={(e) =>
                        actualizarLinea(
                          linea.producto_id,
                          "precio",
                          e.target.value
                        )
                      }
                      onFocus={(e) => e.target.select()}
                      placeholder="Precio"
                      aria-label={`Precio por kilo de ${linea.producto_nombre}`}
                      className="w-24 rounded-xl border border-gray-300 py-3 px-2 text-center text-lg font-semibold tabular-nums text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                    />
                    <span className="ml-auto text-right font-extrabold tabular-nums text-gray-900">
                      {subtotal !== null && subtotal !== undefined
                        ? `= S/ ${subtotal.toFixed(2)}`
                        : "= —"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Observaciones (opcional), colapsable */}
      <section className="pt-4 pb-4">
        <button
          type="button"
          onClick={() => setMostrarObservaciones((v) => !v)}
          className="flex items-center gap-1 text-sm font-semibold text-gray-600 hover:text-gray-900"
        >
          {mostrarObservaciones ? (
            <FiChevronUp size={16} />
          ) : (
            <FiChevronDown size={16} />
          )}
          Observaciones (opcional)
        </button>
        {mostrarObservaciones && (
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            placeholder="Ej. dejó adelanto, entregar en el puesto 14…"
            className="mt-2 w-full rounded-xl border border-gray-300 p-3 text-base text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
          />
        )}
      </section>

      {/* Footer sticky: total + saldo proyectado + guardar */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-gray-200 bg-white px-4 pt-3 pb-4">
        {errorEnvio && (
          <div
            role="alert"
            className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3"
          >
            <p className="flex items-start gap-2 text-sm font-semibold text-red-700">
              <FiAlertTriangle size={18} className="mt-0.5 shrink-0" />
              {errorEnvio.mensaje}
            </p>
            {errorEnvio.reintentable && (
              <button
                type="button"
                onClick={enviarVenta}
                disabled={guardando}
                className="mt-2 w-full rounded-lg bg-red-600 py-2.5 font-bold text-white hover:bg-red-700 disabled:bg-gray-300"
              >
                Reintentar
              </button>
            )}
          </div>
        )}

        {!puedeGuardar && motivoBloqueo && (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
            {motivoBloqueo}
          </p>
        )}

        <div className="flex items-end justify-between">
          <span className="pb-1 text-sm font-bold uppercase tracking-wider text-gray-500">
            Total
          </span>
          <span className="text-2xl font-black text-gray-900">
            S/ {analisis.total.toFixed(2)}
          </span>
        </div>
        <p className="mt-0.5 text-right text-xs text-gray-500">
          El saldo quedará en{" "}
          <span className="font-bold">S/ {saldoProyectado.toFixed(2)}</span>
        </p>

        <button
          type="button"
          onClick={enviarVenta}
          disabled={!puedeGuardar || guardando}
          className="mt-3 flex h-14 w-full items-center justify-center rounded-xl bg-red-600 text-lg font-bold text-white transition-colors hover:bg-red-700 active:scale-[0.99] disabled:bg-gray-300 disabled:text-gray-500"
        >
          {guardando ? (
            <>
              <FiLoader className="mr-2 animate-spin" size={22} /> Guardando…
            </>
          ) : ventaExistente ? (
            "Actualizar y enviar guía"
          ) : (
            "Guardar y enviar guía"
          )}
        </button>
      </div>

      {/* Éxito: modal de la guía para compartir; al cerrar vuelve a la lista */}
      {guia && (
        <GuiaAvicolaModal
          data={guia}
          onClose={() => router.push("/dashboard/clientes-avicola")}
        />
      )}
    </div>
  );
}
