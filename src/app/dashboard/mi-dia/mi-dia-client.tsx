// src/app/dashboard/mi-dia/mi-dia-client.tsx
// Panel "Mi día" para la asesora. Reúne en una sola pantalla todo lo que
// necesita ver al arrancar el día:
//   - Saludo + métricas del día (pedidos / monto vendido).
//   - Pedidos para HOY (con estado y hora de entrega).
//   - Cobranzas vencidas o que vencen hoy.
//   - Clientes "dormidos" para volver a contactar.
//
// Diseño: "No me hagas pensar". Cada bloque con un CTA claro (Ver detalle,
// WhatsApp, ir al perfil). Si un bloque está vacío, mostramos un mensaje
// alentador en lugar de un cuadro hueco.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FiSun,
  FiPackage,
  FiDollarSign,
  FiMessageCircle,
  FiAlertCircle,
  FiUserX,
  FiArrowRight,
} from "react-icons/fi";

interface PedidoHoy {
  id: string;
  cliente: string;
  distrito: string | null;
  estado: string;
  empresa: string;
  detalle: string;
  hora_entrega: string | null;
  fecha_pedido: string;
}
interface CobranzaItem {
  id: string;
  cliente_nombre: string;
  monto: string | number;
  estado: string;
  fecha_vencimiento: string;
  dias_vencido: number;
  numero_comprobante: string | null;
}
interface ClienteDormido {
  id: string;
  nombre: string;
  ruc_dni: string | null;
  whatsapp: string | null;
  dias_sin_pedido: number;
}

interface MiDiaData {
  pedidosHoy: PedidoHoy[];
  cobranzas: CobranzaItem[];
  clientesDormidos: ClienteDormido[];
  ventasHoy: { pedidos: number; monto: number };
}

function toNum(v: string | number): number {
  return typeof v === "string" ? parseFloat(v) || 0 : v;
}

function whatsappLink(numero: string | null): string | null {
  if (!numero) return null;
  const clean = numero.replace(/\D/g, "");
  if (!clean) return null;
  return `https://wa.me/${clean.startsWith("51") ? clean : `51${clean}`}`;
}

const ESTADO_COLOR: Record<string, string> = {
  Pendiente: "bg-gray-100 text-gray-700",
  En_Produccion: "bg-blue-100 text-blue-700",
  Listo_Para_Despacho: "bg-indigo-100 text-indigo-700",
  Asignado: "bg-purple-100 text-purple-700",
  En_Camino: "bg-amber-100 text-amber-700",
  Entregado: "bg-green-100 text-green-700",
  Fallido: "bg-red-100 text-red-700",
};

export default function MiDiaClient({
  nombre,
  role,
}: {
  nombre: string;
  role: string;
}) {
  const [data, setData] = useState<MiDiaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/mi-dia");
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(typeof j.error === "string" ? j.error : "Error al cargar");
        }
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Saludo dependiendo de la hora local — Lima es UTC-5.
  const ahora = new Date();
  const horaLima = (ahora.getUTCHours() - 5 + 24) % 24;
  const saludo =
    horaLima < 12
      ? "Buenos días"
      : horaLima < 19
      ? "Buenas tardes"
      : "Buenas noches";

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Cargando…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
          {error ?? "Error al cargar"}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* Saludo + métricas del día */}
      <div className="bg-gradient-to-br from-red-600 via-red-700 to-amber-500 text-white rounded-2xl p-6 shadow-xl transition-all hover:shadow-2xl duration-350">
        <div className="flex items-center gap-2 mb-2">
          <FiSun className="h-5 w-5 animate-spin-slow" />
          <span className="text-sm font-medium opacity-90">{saludo}, {nombre}</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight mb-3">Mi día</h1>
        {role === "admin" && (
          <div className="mb-3 text-xs bg-white/20 backdrop-blur-sm border border-white/30 rounded-lg px-2 py-1.5 font-semibold">
            Vista previa (admin) — la asesora ve sus propios datos.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl p-3 hover:bg-white/15 transition-all">
            <div className="text-[10px] uppercase tracking-wider opacity-85 font-black">Pedidos registrados hoy</div>
            <div className="text-2xl font-black mt-1">{data.ventasHoy.pedidos}</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-xl p-3 hover:bg-white/15 transition-all">
            <div className="text-[10px] uppercase tracking-wider opacity-85 font-black">Vendido hoy</div>
            <div className="text-2xl font-black mt-1">S/ {data.ventasHoy.monto.toFixed(2)}</div>
          </div>
        </div>
        <div className="mt-4 flex">
          <Link
            href="/dashboard/mis-metas"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-white/15 hover:bg-white/20 px-3 py-1.5 rounded-lg border border-white/10 transition-all hover:scale-[1.02] active:scale-98 shadow-sm"
          >
            Ver mis metas e incentivos <FiArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Pedidos para hoy */}
      <Seccion
        titulo="Pedidos para entregar hoy"
        icono={<FiPackage className="text-amber-600" />}
        cnt={data.pedidosHoy.length}
        vacioMsg="🎉 No hay pedidos para entregar hoy."
      >
        {data.pedidosHoy.length > 0 && (
          <ul className="divide-y divide-gray-100/50">
            {data.pedidosHoy.map((p) => (
              <li key={p.id} className="py-2.5 flex items-center gap-3 hover:bg-gray-50/50 px-2 rounded-xl transition-all duration-200">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-800 truncate">{p.cliente}</div>
                  <div className="text-[11px] font-medium text-gray-400 truncate mt-0.5">
                    {p.distrito ?? "—"} · {p.hora_entrega ?? "sin hora"} · {p.empresa}
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${ESTADO_COLOR[p.estado] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                  {p.estado.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {/* Cobranzas que tocan hoy */}
      <Seccion
        titulo="Cobranzas que tocan hoy"
        icono={<FiDollarSign className="text-red-600" />}
        cnt={data.cobranzas.length}
        vacioMsg="✅ Sin cobranzas vencidas. ¡Bien!"
        ctaLabel="Ir a Cobranzas"
        ctaHref="/dashboard/cobranzas"
      >
        {data.cobranzas.length > 0 && (
          <ul className="divide-y divide-gray-100/50">
            {data.cobranzas.map((c) => {
              const venc = Number(c.dias_vencido);
              return (
                <li key={c.id} className="py-2.5 flex items-center gap-3 hover:bg-gray-50/50 px-2 rounded-xl transition-all duration-200">
                  <FiAlertCircle className={venc > 0 ? "text-red-500 shrink-0" : "text-amber-500 shrink-0"} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-gray-800 truncate">
                      {c.cliente_nombre}
                    </div>
                    <div className="text-[11px] font-medium text-gray-400 mt-0.5">
                      {venc > 0
                        ? `Vencida hace ${venc} día${venc === 1 ? "" : "s"}`
                        : "Vence HOY"}
                      {c.numero_comprobante && ` · ${c.numero_comprobante}`}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-red-600 whitespace-nowrap text-sm bg-red-50 px-2.5 py-1 rounded-lg border border-red-100">
                    S/ {toNum(c.monto).toFixed(2)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>

      {/* Clientes dormidos */}
      <Seccion
        titulo="Clientes que vale la pena recontactar"
        icono={<FiUserX className="text-purple-600" />}
        cnt={data.clientesDormidos.length}
        vacioMsg="Todos tus clientes están activos."
      >
        {data.clientesDormidos.length > 0 && (
          <ul className="divide-y divide-gray-100/50">
            {data.clientesDormidos.map((c) => {
              const w = whatsappLink(c.whatsapp);
              return (
                <li key={c.id} className="py-2.5 flex items-center gap-3 hover:bg-gray-50/50 px-2 rounded-xl transition-all duration-200">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/dashboard/clientes/${c.id}`}
                      className="text-sm font-bold text-gray-800 hover:text-red-600 transition-colors truncate block"
                    >
                      {c.nombre}
                    </Link>
                    <div className="text-[11px] font-medium text-gray-400 mt-0.5">
                      Sin pedido hace {c.dias_sin_pedido} días{c.ruc_dni ? ` · ${c.ruc_dni}` : ""}
                    </div>
                  </div>
                  {w && (
                    <a
                      href={w}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 bg-green-500 text-white rounded-lg text-xs font-bold hover:bg-green-600 flex items-center gap-1 transition-all hover:scale-105 shadow-sm"
                    >
                      <FiMessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>
    </div>
  );
}

function Seccion({
  titulo,
  icono,
  cnt,
  vacioMsg,
  ctaLabel,
  ctaHref,
  children,
}: {
  titulo: string;
  icono: React.ReactNode;
  cnt: number;
  vacioMsg: string;
  ctaLabel?: string;
  ctaHref?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-5 hover:shadow-lg transition-all duration-300">
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          {icono}
          <h2 className="text-sm font-black text-gray-800 tracking-tight">{titulo}</h2>
          {cnt > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-bold border border-gray-200">
              {cnt}
            </span>
          )}
        </div>
        {ctaLabel && ctaHref && cnt > 0 && (
          <Link
            href={ctaHref}
            className="text-xs font-bold text-red-600 hover:text-red-700 transition-colors inline-flex items-center gap-1"
          >
            {ctaLabel} <FiArrowRight className="h-3 w-3 animate-pulse" />
          </Link>
        )}
      </div>
      {cnt === 0 ? (
        <div className="text-sm text-gray-400 py-2.5 px-2 bg-gray-50/50 rounded-xl border border-dashed border-gray-200 text-center font-medium">{vacioMsg}</div>
      ) : (
        children
      )}
    </div>
  );
}
