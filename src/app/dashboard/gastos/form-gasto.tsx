// src/app/dashboard/gastos/form-gasto.tsx
//
// El formulario de gasto, compartido por la pantalla de Gastos y la de Caja
// Diaria. Una sola fuente: las reglas de la fecha se cambian en un solo lugar.
//
// Por qué existe (6 ago 2026): la administradora tenía que ABRIR una caja de
// S/ 10,000 que no correspondía a ningún día real solo para poder escribir
// gastos, y como no había campo de fecha, escribía la fecha DENTRO de la
// descripción ("Gasto: Otros - PETER CON 13-07").
//
// Decisiones de diseño (No me hagas pensar):
//   - La FECHA va primera y siempre visible: acá se cargan meses atrasados, no
//     un gasto suelto. Cuando no es hoy se pinta en ámbar, para que se note.
//   - La fecha NO se limpia al guardar. Cargar 20 gastos del 13 de julio es
//     escribir 20 montos, no 20 montos y 20 fechas.
//   - Debajo del botón se dice qué va a pasar ANTES de pulsarlo, incluido que un
//     gasto de otro día no toca la caja de hoy.
"use client";

import React, { useMemo, useState } from "react";
import { FiPlus, FiSettings, FiX } from "react-icons/fi";
import { fechaBonita, hoyLimaCliente } from "@/lib/gastos/fecha-gasto";
import { MAX_LARGO_OPCION } from "@/lib/parametros-negocio";

/** Valor centinela del `<select>` que abre el campo "nueva categoría". */
const NUEVA_CATEGORIA = "__nueva__";

export interface CuentaSimple {
  id: string;
  nombre: string;
}

interface FormGastoProps {
  cuentas: CuentaSimple[];
  categorias: string[];
  /** Cuenta preseleccionada (en la caja, la de efectivo). */
  cuentaPorDefecto?: string;
  /** Se llama tras registrar con éxito, para refrescar la lista de quien lo use. */
  onRegistrado?: (info: { fecha: string; esRetroactivo: boolean }) => void;
  onError?: (mensaje: string) => void;
  /**
   * Se llama cuando se crea (o se reencuentra) una categoría desde el propio
   * formulario, para que el padre refresque su lista y avise a su manera.
   */
  onCategoriaAgregada?: (info: { lista: string[]; valor: string; yaExistia: boolean }) => void;
  /** Solo el admin ve el enlace a Configuración (quitar/renombrar vive ahí). */
  esAdmin?: boolean;
  /** Texto del encabezado; en la caja dice "Egreso de Caja". */
  titulo?: string;
  compacto?: boolean;
}

export default function FormGasto({
  cuentas,
  categorias,
  cuentaPorDefecto,
  onRegistrado,
  onError,
  onCategoriaAgregada,
  esAdmin = false,
  titulo = "Registrar gasto",
  compacto = false,
}: FormGastoProps) {
  const hoy = hoyLimaCliente();
  const [fecha, setFecha] = useState(hoy);
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState(categorias[0] ?? "Otros");
  const [cuentaId, setCuentaId] = useState(cuentaPorDefecto ?? "");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Categorías creadas acá mismo. Se guardan aparte de la prop para que la
  // recién creada NO desaparezca si el padre todavía no refrescó su lista.
  const [agregadas, setAgregadas] = useState<string[]>([]);
  const [creandoCategoria, setCreandoCategoria] = useState(false);
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [guardandoCategoria, setGuardandoCategoria] = useState(false);

  const opciones = useMemo(
    () => Array.from(new Set([...categorias, ...agregadas])),
    [categorias, agregadas]
  );

  // La cuenta por defecto llega después del fetch: se adopta la primera vez.
  React.useEffect(() => {
    if (!cuentaId && cuentaPorDefecto) setCuentaId(cuentaPorDefecto);
  }, [cuentaPorDefecto, cuentaId]);
  React.useEffect(() => {
    if (opciones.length && !opciones.includes(categoria)) setCategoria(opciones[0]);
  }, [opciones, categoria]);

  const esRetroactiva = fecha !== hoy;

  const cancelarNuevaCategoria = () => {
    setCreandoCategoria(false);
    setNuevaCategoria("");
  };

  const crearCategoria = async () => {
    const valor = nuevaCategoria.trim();
    if (!valor) return onError?.("Escribe el nombre de la categoría.");

    setGuardandoCategoria(true);
    try {
      const res = await fetch("/api/parametros-negocio/lista", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lista: "categorias_gasto", valor }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Se conserva lo escrito: que no tenga que teclearlo de nuevo.
        onError?.(typeof data?.error === "string" ? data.error : "No se pudo crear la categoría.");
        return;
      }
      const lista: string[] = Array.isArray(data?.lista) ? data.lista : [];
      setAgregadas(lista);
      setCategoria(data.valor);
      cancelarNuevaCategoria();
      onCategoriaAgregada?.({ lista, valor: data.valor, yaExistia: Boolean(data.ya_existia) });
    } catch {
      onError?.("Error de red al crear la categoría.");
    } finally {
      setGuardandoCategoria(false);
    }
  };

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!monto || Number(monto) <= 0) return onError?.("Ingresa un monto mayor a 0.");
    if (!cuentaId) return onError?.("Elige de qué cuenta o caja sale el dinero.");

    setGuardando(true);
    try {
      const res = await fetch("/api/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha,
          categoria,
          descripcion: descripcion.trim() || null,
          monto: Number(monto),
          cuenta_id: cuentaId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError?.(data.error || "No se pudo registrar el gasto.");
        return;
      }
      // Se limpian monto y descripción, NUNCA la fecha: lo normal es seguir
      // cargando gastos del mismo día.
      setMonto("");
      setDescripcion("");
      onRegistrado?.({ fecha, esRetroactivo: Boolean(data.es_retroactivo) });
    } catch {
      onError?.("Error de red al registrar el gasto.");
    } finally {
      setGuardando(false);
    }
  };

  const inputBase =
    "block w-full rounded-xl border-gray-300 px-3 py-2.5 text-xs text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-gray-50";

  return (
    <div
      className={`bg-white rounded-3xl border border-gray-100 shadow-sm space-y-4 ${
        compacto ? "p-4" : "p-6"
      }`}
    >
      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
        <FiPlus className="text-indigo-600" /> {titulo}
      </h3>

      <form onSubmit={registrar} className="space-y-4">
        {/* La fecha PRIMERO: es el dato que se estaba perdiendo. */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-700">
            Fecha del gasto (el día en que se gastó):
          </label>
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => setFecha(e.target.value || hoy)}
            className={`${inputBase} ${
              esRetroactiva ? "border-amber-300 bg-amber-50 text-amber-900 font-bold" : ""
            }`}
          />
          {esRetroactiva && (
            <p className="text-[11px] font-semibold text-amber-700">
              Gasto del {fechaBonita(fecha)} — no afectará el arqueo de la caja de hoy.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700">Monto (S/):</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0.00"
              className={inputBase}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700">Categoría:</label>
            <select
              value={creandoCategoria ? NUEVA_CATEGORIA : categoria}
              onChange={(e) => {
                if (e.target.value === NUEVA_CATEGORIA) {
                  setCreandoCategoria(true);
                  setNuevaCategoria("");
                  return;
                }
                setCategoria(e.target.value);
              }}
              className={`${inputBase} bg-white`}
            >
              {opciones.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
              {/* Crear la que falta sin salir de la pantalla ni saber que existe
                  una página de Configuración (pedido de Marianela, 6 ago 2026). */}
              <option value={NUEVA_CATEGORIA}>➕ Nueva categoría…</option>
            </select>

            {creandoCategoria && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  autoFocus
                  value={nuevaCategoria}
                  maxLength={MAX_LARGO_OPCION}
                  onChange={(e) => setNuevaCategoria(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter agrega la categoría, NO envía el gasto.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!guardandoCategoria) crearCategoria();
                    }
                    if (e.key === "Escape") cancelarNuevaCategoria();
                  }}
                  placeholder="Ej: Delivery"
                  className={`${inputBase} flex-1`}
                />
                <button
                  type="button"
                  onClick={crearCategoria}
                  disabled={guardandoCategoria}
                  className="shrink-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl px-3 py-2.5 font-bold text-xs transition-all cursor-pointer active:scale-95"
                >
                  {guardandoCategoria ? "…" : "Agregar"}
                </button>
                <button
                  type="button"
                  onClick={cancelarNuevaCategoria}
                  disabled={guardandoCategoria}
                  title="Cancelar"
                  className="shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 transition-all cursor-pointer"
                >
                  <FiX size={16} />
                </button>
              </div>
            )}

            {/* Quitar o renombrar afecta el catálogo entero: eso vive en
                Configuración, y este enlace es cómo se descubre que existe. */}
            {esAdmin && !creandoCategoria && (
              <a
                href="/dashboard/configuracion"
                className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-indigo-600 transition-colors"
              >
                <FiSettings size={10} /> Administrar categorías
              </a>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-700">
            Pagar con (cuenta o caja):
          </label>
          <select
            value={cuentaId}
            onChange={(e) => setCuentaId(e.target.value)}
            className={`${inputBase} bg-white`}
          >
            {cuentas.length === 0 && <option value="">Sin cuentas disponibles</option>}
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-700">
            Descripción <span className="font-normal text-gray-400">(opcional)</span>:
          </label>
          <input
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: almuerzo del personal de producción"
            className={inputBase}
          />
          <p className="text-[10px] text-gray-400">
            Ya no hace falta escribir la fecha aquí: se guarda arriba.
          </p>
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl py-3 font-bold text-xs shadow-md transition-all active:scale-98 cursor-pointer"
        >
          {guardando ? "Registrando…" : `Registrar gasto del ${fechaBonita(fecha)}`}
        </button>
      </form>
    </div>
  );
}
