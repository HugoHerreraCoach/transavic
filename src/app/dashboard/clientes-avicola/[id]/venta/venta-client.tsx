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
} from "react-icons/fi";

/** Producto del catálogo tal como lo precarga page.tsx (precio ya numérico). */
export interface ProductoVentaAvicola {
  id: string;
  nombre: string;
  categoria: string;
  precio_venta: number | null;
}

interface VentaAvicolaClientProps {
  cliente: ClienteAvicolaConSaldo;
  productos: ProductoVentaAvicola[];
  /** producto_id → último precio/kg pactado con ESTE cliente. */
  ultimosPrecios: Record<string, number>;
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

export default function VentaAvicolaClient({
  cliente,
  productos,
  ultimosPrecios,
}: VentaAvicolaClientProps) {
  const router = useRouter();

  const [lineas, setLineas] = useState<LineaVenta[]>([]);
  const [observaciones, setObservaciones] = useState("");
  const [mostrarObservaciones, setMostrarObservaciones] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<ErrorEnvio | null>(null);
  const [guia, setGuia] = useState<GuiaAvicolaData | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  // Id de la venta: se genera UNA sola vez al montar y NO cambia en reintentos
  // (clave de idempotencia contra doble-tap / señal intermitente en campo).
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) {
    idRef.current = crypto.randomUUID();
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

  const saldoProyectado = round2(cliente.saldo_actual + analisis.total);
  const tieneDeuda = cliente.saldo_actual > UMBRAL_DEUDA;

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
      const res = await fetch("/api/avicola/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: idRef.current,
          cliente_id: cliente.id,
          items: lineas.map((l) => ({
            producto_id: l.producto_id,
            producto_nombre: l.producto_nombre,
            peso_kg: aNumero(l.peso),
            precio_kg: aNumero(l.precio),
          })),
          observaciones: observaciones.trim() || null,
        }),
      });

      if (res.ok) {
        // 201 creada o 200 ya existía (reintento) — en ambos casos hay guía.
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

  return (
    <div className="mx-auto w-full max-w-lg px-4">
      {/* Header fino sticky: volver + cliente + saldo. En móvil queda debajo
          del header fijo del DashboardLayout (64px), en desktop pega arriba. */}
      <header className="sticky top-16 lg:top-0 z-30 -mx-4 flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
        <Link
          href="/dashboard/clientes-avicola"
          aria-label="Volver a clientes avícola"
          className="-ml-2 p-2 text-gray-600 hover:text-gray-900"
        >
          <FiArrowLeft size={22} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold leading-tight text-gray-900">
            {cliente.nombre}
          </p>
          <p
            className={`text-xs font-semibold ${
              tieneDeuda ? "text-red-600" : "text-gray-500"
            }`}
          >
            Saldo: S/ {cliente.saldo_actual.toFixed(2)}
          </p>
        </div>
      </header>

      {/* Grid de productos: tap = agrega línea con el precio precargado */}
      <section className="pt-4">
        <div className="grid grid-cols-2 gap-3">
          {productos.map((producto) => {
            const ultimo = ultimosPrecios[producto.id];
            const enVenta = lineas.some(
              (l) => l.producto_id === producto.id
            );
            return (
              <button
                key={producto.id}
                type="button"
                onClick={() => agregarProducto(producto)}
                className={`rounded-2xl border bg-white p-3 text-left transition-transform active:scale-95 cursor-pointer ${
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
            );
          })}
        </div>
        {productos.length === 0 && (
          <p className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-500">
            No hay productos activos en el catálogo.
          </p>
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
                      className="w-24 rounded-xl border border-gray-300 py-3 px-2 text-center text-lg font-semibold text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
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
                      className="w-24 rounded-xl border border-gray-300 py-3 px-2 text-center text-lg font-semibold text-gray-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                    />
                    <span className="ml-auto text-right font-extrabold text-gray-900">
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
