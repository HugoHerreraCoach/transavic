"use client";
// Lista + búsqueda del módulo Clientes Avícola (HOME).
// Mobile-first extremo: Antonio trabaja en el mercado con el celular.
// Búsqueda client-side (decenas de clientes precargados por el server component).
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FiBarChart2,
  FiDollarSign,
  FiPlus,
  FiSearch,
  FiShoppingCart,
  FiX,
} from "react-icons/fi";
import GuiaModulo from "@/components/GuiaModulo";
import type { ClienteAvicolaConSaldo } from "@/lib/avicola/types";
import AbonoModal from "./abono-modal";
import ClienteAvicolaForm from "./cliente-avicola-form";

/** Normaliza para búsqueda: minúsculas y sin tildes. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function soles(n: number): string {
  return `S/ ${n.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ListaClientesAvicola({
  clientesIniciales,
  mercados,
}: {
  clientesIniciales: ClienteAvicolaConSaldo[];
  mercados: string[];
}) {
  const router = useRouter();
  const [clientes, setClientes] = useState(clientesIniciales);
  const [busqueda, setBusqueda] = useState("");
  const [mercadoActivo, setMercadoActivo] = useState<string | null>(null);
  const [soloConDeuda, setSoloConDeuda] = useState(false);
  const [clienteAbono, setClienteAbono] = useState<ClienteAvicolaConSaldo | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  // Recarga la lista tras registrar un abono o crear/editar un cliente.
  const recargar = async () => {
    try {
      const res = await fetch("/api/avicola/clientes");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.clientes)) setClientes(data.clientes);
    } catch {
      // sin señal: la lista queda como está; el próximo load la refresca
    }
  };

  const filtrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const soloDigitos = q.replace(/\D/g, "");
    const esNumerico = q.length > 0 && soloDigitos.length === q.length;

    return clientes.filter((c) => {
      if (mercadoActivo && c.mercado !== mercadoActivo) return false;
      if (soloConDeuda && c.saldo_actual <= 0.01) return false;
      if (!q) return true;

      const enTexto =
        normalizar(c.nombre).includes(q) ||
        normalizar(c.mercado).includes(q) ||
        (c.numero_puesto ? normalizar(c.numero_puesto).includes(q) : false);
      if (enTexto) return true;

      if (esNumerico) {
        const tel = (c.telefono ?? "").replace(/\D/g, "");
        const puesto = (c.numero_puesto ?? "").replace(/\D/g, "");
        if (tel.includes(soloDigitos) || puesto === soloDigitos) return true;
      }
      return false;
    });
  }, [clientes, busqueda, mercadoActivo, soloConDeuda]);

  const carteraTotal = useMemo(
    () => clientes.reduce((acc, c) => acc + Math.max(c.saldo_actual, 0), 0),
    [clientes]
  );

  return (
    <div className="flex flex-col gap-3">
      <GuiaModulo modulo="clientes-avicola" />

      {/* Título + accesos */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          Clientes Avícola
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/clientes-avicola/liquidacion"
            className="flex items-center gap-1.5 px-3 h-10 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 active:scale-95 transition"
          >
            <FiDollarSign className="h-4 w-4 text-emerald-600" />
            Liquidación
          </Link>
          <Link
            href="/dashboard/clientes-avicola/panel"
            className="flex items-center gap-1.5 px-3 h-10 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 active:scale-95 transition"
          >
            <FiBarChart2 className="h-4 w-4 text-red-600" />
            Panel
          </Link>
        </div>
      </div>

      {/* Nuevo cliente */}
      <button
        type="button"
        onClick={() => setMostrarForm(true)}
        className="flex items-center justify-center gap-2 w-full h-12 rounded-2xl bg-red-600 text-white font-bold text-base active:scale-[0.98] transition shadow-sm"
      >
        <FiPlus className="h-5 w-5" />
        Nuevo cliente
      </button>

      {/* Buscador sticky */}
      <div className="sticky top-16 lg:top-2 z-10 bg-gray-50 pt-1 pb-2 -mx-1 px-1">
        <div className="relative">
          <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Busca por nombre, mercado, puesto o teléfono"
            className="w-full h-12 pl-11 pr-11 rounded-2xl border border-gray-200 bg-white text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-gray-100 text-gray-500 active:scale-90"
            >
              <FiX className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Chips: mercados + con deuda */}
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setMercadoActivo(null)}
            className={`flex-shrink-0 px-3.5 h-9 rounded-full text-sm font-semibold border transition active:scale-95 ${
              mercadoActivo === null
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200"
            }`}
          >
            Todos
          </button>
          {mercados.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMercadoActivo(mercadoActivo === m ? null : m)}
              className={`flex-shrink-0 px-3.5 h-9 rounded-full text-sm font-semibold border transition active:scale-95 ${
                mercadoActivo === m
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200"
              }`}
            >
              {m}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSoloConDeuda((v) => !v)}
            className={`flex-shrink-0 px-3.5 h-9 rounded-full text-sm font-semibold border transition active:scale-95 ${
              soloConDeuda
                ? "bg-red-600 text-white border-red-600"
                : "bg-white text-red-600 border-red-200"
            }`}
          >
            Con deuda
          </button>
        </div>
      </div>

      {/* Tarjetas de clientes */}
      {clientes.length === 0 ? (
        <div className="text-center py-16 px-6 text-gray-500">
          <p className="text-lg font-semibold text-gray-700 mb-1">
            Aún no tienes clientes.
          </p>
          <p className="text-sm">Toca “Nuevo cliente” para empezar.</p>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-12 px-6 text-gray-500 text-sm">
          No se encontró ningún cliente con ese dato.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtrados.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm active:scale-[0.99] transition"
            >
              <button
                type="button"
                onClick={() => router.push(`/dashboard/clientes-avicola/${c.id}`)}
                className="w-full text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-lg text-gray-900 leading-snug">
                    {c.nombre}
                  </p>
                  {c.saldo_actual > 0.01 ? (
                    <span className="flex-shrink-0 font-black text-red-600 text-base">
                      {soles(c.saldo_actual)}
                    </span>
                  ) : c.saldo_actual < -0.01 ? (
                    <span className="flex-shrink-0 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                      A favor {soles(Math.abs(c.saldo_actual))}
                    </span>
                  ) : (
                    <span className="flex-shrink-0 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                      Al día
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  {c.mercado}
                  {c.numero_puesto ? ` · Puesto ${c.numero_puesto}` : ""}
                  {!c.activo && (
                    <span className="ml-2 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold align-middle">
                      Inactivo
                    </span>
                  )}
                </p>
              </button>

              <div className="grid grid-cols-2 gap-2 mt-3">
                {c.activo ? (
                  <Link
                    href={`/dashboard/clientes-avicola/${c.id}/venta`}
                    className="flex items-center justify-center gap-2 h-12 rounded-xl bg-red-600 text-white font-bold active:scale-95 transition"
                  >
                    <FiShoppingCart className="h-5 w-5" />
                    Vender
                  </Link>
                ) : (
                  <span className="flex items-center justify-center gap-2 h-12 rounded-xl bg-red-600/40 text-white font-bold cursor-not-allowed">
                    <FiShoppingCart className="h-5 w-5" />
                    Vender
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setClienteAbono(c)}
                  className="flex items-center justify-center gap-2 h-12 rounded-xl bg-emerald-600 text-white font-bold active:scale-95 transition"
                >
                  <FiDollarSign className="h-5 w-5" />
                  Abonar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pie: resumen de cartera */}
      {clientes.length > 0 && (
        <p className="text-center text-xs text-gray-400 py-3">
          {clientes.length} cliente{clientes.length === 1 ? "" : "s"} · Cartera por
          cobrar: <span className="font-semibold text-gray-600">{soles(carteraTotal)}</span>
        </p>
      )}

      {/* Modales */}
      {clienteAbono && (
        <AbonoModal
          cliente={clienteAbono}
          onClose={() => setClienteAbono(null)}
          onGuardado={recargar}
        />
      )}
      {mostrarForm && (
        <ClienteAvicolaForm
          mercadosSugeridos={mercados}
          onClose={() => setMostrarForm(false)}
          onGuardado={recargar}
        />
      )}
    </div>
  );
}
