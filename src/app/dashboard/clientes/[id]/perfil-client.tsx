// src/app/dashboard/clientes/[id]/perfil-client.tsx
// Perfil 360° del cliente. Muestra en una sola pantalla:
//   - Header con datos clave + acciones rápidas (WhatsApp, nuevo pedido)
//   - 4 KPIs: facturado / cobrado / pendiente / vencido
//   - Pestañas con histórico: Pedidos · Comprobantes · Cobranzas · Productos
//
// Diseño "No me hagas pensar": cada acción importante está a 1 clic,
// los datos críticos (deuda) se ven sin scroll, y cada fila del histórico
// linkea al detalle correspondiente (perfil ↔ pedido ↔ comprobante).
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FiUser,
  FiMessageCircle,
  FiPlusCircle,
  FiDollarSign,
  FiAlertCircle,
  FiCheckCircle,
  FiFileText,
  FiPackage,
  FiArrowLeft,
  FiMapPin,
  FiTag,
  FiClock,
} from "react-icons/fi";

type Tab = "pedidos" | "comprobantes" | "cobranzas" | "productos";

interface Cliente {
  id: string;
  nombre: string;
  razon_social?: string | null;
  ruc_dni?: string | null;
  whatsapp?: string | null;
  direccion?: string | null;
  distrito?: string | null;
  tipo_cliente?: string | null;
  empresa?: string | null;
  notas?: string | null;
  asesor_name?: string | null;
  plazo_pago_dias?: number | null;
  created_at?: string | null;
}
interface Stats {
  totalFacturado: number;
  totalCobrado: number;
  totalPendiente: number;
  totalVencido: number;
  numPedidos: number;
  ultimoPedido: string | null;
  ticketPromedio: number;
}
interface PedidoItem {
  id: string;
  cliente: string;
  detalle: string;
  empresa: string;
  distrito: string;
  estado: string;
  fecha_pedido: string;
  created_at: string;
  subtotal_pedido: string | number;
}
interface ComprobanteItem {
  id: string;
  serie_numero: string;
  tipo: string;
  empresa: string;
  estado: string;
  monto_total: string | number;
  created_at: string;
  cliente_razon_social: string | null;
  mensaje_sunat: string | null;
}
interface CobranzaItem {
  id: string;
  cliente_nombre: string;
  monto: string | number;
  estado: "Pendiente" | "Pagada" | "Vencida";
  numero_comprobante: string | null;
  fecha_emision: string;
  fecha_vencimiento: string;
  fecha_pago: string | null;
}
interface ProductoTop {
  producto: string;
  categoria: string;
  veces_pedido: string | number;
  cantidad_total: string | number;
  subtotal_total: string | number;
}
interface Perfil {
  cliente: Cliente;
  stats: Stats;
  pedidos: PedidoItem[];
  comprobantes: ComprobanteItem[];
  cobranzas: CobranzaItem[];
  topProductos: ProductoTop[];
}

function toNum(v: string | number | undefined | null): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "string" ? parseFloat(v) || 0 : v;
}

const TIPO_LABEL: Record<string, string> = {
  "01": "Factura",
  "03": "Boleta",
  "07": "N. Crédito",
  "08": "N. Débito",
};

const ESTADO_PEDIDO_COLOR: Record<string, string> = {
  Pendiente: "bg-gray-100 text-gray-700",
  En_Produccion: "bg-blue-100 text-blue-700",
  Listo_Para_Despacho: "bg-indigo-100 text-indigo-700",
  Asignado: "bg-purple-100 text-purple-700",
  En_Camino: "bg-amber-100 text-amber-700",
  Entregado: "bg-green-100 text-green-700",
  Fallido: "bg-red-100 text-red-700",
};

const ESTADO_COMPROBANTE_COLOR: Record<string, string> = {
  ACEPTADA: "bg-green-100 text-green-700",
  ACEPTADA_CON_OBSERVACIONES: "bg-amber-100 text-amber-700",
  PENDIENTE: "bg-gray-100 text-gray-700",
  RECHAZADA: "bg-red-100 text-red-700",
  ERROR: "bg-red-100 text-red-700",
};

export default function PerfilClienteClient({
  clienteId,
  userRole,
}: {
  clienteId: string;
  userRole: string;
}) {
  const [data, setData] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pedidos");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/clientes/${clienteId}/perfil`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(typeof j.error === "string" ? j.error : "Error al cargar perfil");
        }
        const json = (await res.json()) as Perfil;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clienteId]);

  const stats = data?.stats;
  const cliente = data?.cliente;

  const whatsappLink = useMemo(() => {
    if (!cliente?.whatsapp) return null;
    const clean = cliente.whatsapp.replace(/\D/g, "");
    if (!clean) return null;
    const numero = clean.startsWith("51") ? clean : `51${clean}`;
    return `https://wa.me/${numero}`;
  }, [cliente?.whatsapp]);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Cargando perfil…</div>;
  }
  if (error || !data || !cliente || !stats) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <Link
          href="/dashboard/clientes"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mb-4"
        >
          <FiArrowLeft /> Volver a clientes
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
          {error || "No se pudo cargar el perfil"}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link
        href="/dashboard/clientes"
        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
      >
        <FiArrowLeft /> Volver a clientes
      </Link>

      {/* HEADER: identidad + acciones rápidas */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <FiUser className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-800 truncate">
                {cliente.nombre}
              </h1>
              {cliente.razon_social && cliente.razon_social !== cliente.nombre && (
                <div className="text-sm text-gray-600 truncate">{cliente.razon_social}</div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                {cliente.ruc_dni && (
                  <span className="font-mono">{cliente.ruc_dni}</span>
                )}
                {cliente.tipo_cliente && (
                  <span className="inline-flex items-center gap-1">
                    <FiTag className="h-3 w-3" /> {cliente.tipo_cliente}
                  </span>
                )}
                {cliente.distrito && (
                  <span className="inline-flex items-center gap-1">
                    <FiMapPin className="h-3 w-3" /> {cliente.distrito}
                  </span>
                )}
                {cliente.plazo_pago_dias != null && cliente.plazo_pago_dias > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <FiClock className="h-3 w-3" /> Crédito {cliente.plazo_pago_dias} d
                  </span>
                )}
                {userRole === "admin" && cliente.asesor_name && (
                  <span>Asesor: <strong>{cliente.asesor_name}</strong></span>
                )}
              </div>
              {cliente.direccion && (
                <div className="text-xs text-gray-500 mt-1 truncate">{cliente.direccion}</div>
              )}
              {cliente.notas && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded mt-2 px-2 py-1">
                  📝 {cliente.notas}
                </div>
              )}
            </div>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap gap-2">
            {whatsappLink && (
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600"
              >
                <FiMessageCircle /> WhatsApp
              </a>
            )}
            <Link
              href={`/dashboard/nuevo-pedido?cliente=${clienteId}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              <FiPlusCircle /> Nuevo pedido
            </Link>
            <Link
              href={`/dashboard/comprobantes/nuevo?cliente_doc=${cliente.ruc_dni ?? ""}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
            >
              <FiFileText /> Emitir comprobante
            </Link>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<FiFileText />}
          color="indigo"
          label="Facturado total"
          value={`S/ ${stats.totalFacturado.toFixed(2)}`}
          hint={`${stats.numPedidos} pedidos · Ticket S/ ${stats.ticketPromedio.toFixed(2)}`}
        />
        <KpiCard
          icon={<FiCheckCircle />}
          color="green"
          label="Cobrado"
          value={`S/ ${stats.totalCobrado.toFixed(2)}`}
          hint={data.cobranzas.filter((c) => c.estado === "Pagada").length + " pagos"}
        />
        <KpiCard
          icon={<FiDollarSign />}
          color="amber"
          label="Pendiente"
          value={`S/ ${stats.totalPendiente.toFixed(2)}`}
          hint={data.cobranzas.filter(
            (c) => c.estado === "Pendiente" || c.estado === "Vencida"
          ).length + " facturas"}
        />
        <KpiCard
          icon={<FiAlertCircle />}
          color="red"
          label="Vencido"
          value={`S/ ${stats.totalVencido.toFixed(2)}`}
          hint={data.cobranzas.filter((c) => c.estado === "Vencida").length + " vencidas"}
        />
      </div>

      {/* TABS */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          <TabBtn
            active={tab === "pedidos"}
            onClick={() => setTab("pedidos")}
            icon={<FiPackage />}
            label={`Pedidos (${data.pedidos.length})`}
          />
          <TabBtn
            active={tab === "comprobantes"}
            onClick={() => setTab("comprobantes")}
            icon={<FiFileText />}
            label={`Comprobantes (${data.comprobantes.length})`}
          />
          <TabBtn
            active={tab === "cobranzas"}
            onClick={() => setTab("cobranzas")}
            icon={<FiDollarSign />}
            label={`Cobranzas (${data.cobranzas.length})`}
          />
          <TabBtn
            active={tab === "productos"}
            onClick={() => setTab("productos")}
            icon={<FiTag />}
            label={`Productos (${data.topProductos.length})`}
          />
        </div>

        <div className="p-4 overflow-x-auto">
          {tab === "pedidos" && <TablaPedidos rows={data.pedidos} />}
          {tab === "comprobantes" && <TablaComprobantes rows={data.comprobantes} />}
          {tab === "cobranzas" && <TablaCobranzas rows={data.cobranzas} />}
          {tab === "productos" && <TablaProductos rows={data.topProductos} />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Sub-componentes ------------------------------ */

function KpiCard({
  icon,
  color,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  color: "indigo" | "green" | "amber" | "red";
  label: string;
  value: string;
  hint?: string;
}) {
  const palette: Record<typeof color, { bg: string; text: string }> = {
    indigo: { bg: "bg-indigo-100", text: "text-indigo-700" },
    green: { bg: "bg-green-100", text: "text-green-700" },
    amber: { bg: "bg-amber-100", text: "text-amber-700" },
    red: { bg: "bg-red-100", text: "text-red-700" },
  };
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${palette[color].bg} ${palette[color].text}`}>
          {icon}
        </div>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-xl font-bold text-gray-800">{value}</div>
      {hint && <div className="text-[11px] text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
        active
          ? "border-indigo-500 text-indigo-700 bg-indigo-50/30"
          : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
      }`}
    >
      {icon} {label}
    </button>
  );
}

function TablaPedidos({ rows }: { rows: PedidoItem[] }) {
  if (rows.length === 0) {
    return <div className="text-center text-gray-400 py-8">Sin pedidos registrados</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase">
          <th className="py-2 px-2">Fecha entrega</th>
          <th className="py-2 px-2">Detalle</th>
          <th className="py-2 px-2 text-center">Estado</th>
          <th className="py-2 px-2 text-right">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
            <td className="py-2 px-2 text-gray-600 whitespace-nowrap">{p.fecha_pedido}</td>
            <td className="py-2 px-2">
              <div className="text-gray-800 line-clamp-2">{p.detalle}</div>
              <div className="text-[10px] text-gray-400">{p.empresa} · {p.distrito}</div>
            </td>
            <td className="py-2 px-2 text-center">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ESTADO_PEDIDO_COLOR[p.estado] ?? "bg-gray-100 text-gray-700"}`}>
                {p.estado.replace(/_/g, " ")}
              </span>
            </td>
            <td className="py-2 px-2 text-right font-mono font-semibold text-gray-700">
              S/ {toNum(p.subtotal_pedido).toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TablaComprobantes({ rows }: { rows: ComprobanteItem[] }) {
  if (rows.length === 0) {
    return <div className="text-center text-gray-400 py-8">Sin comprobantes emitidos</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase">
          <th className="py-2 px-2">Fecha</th>
          <th className="py-2 px-2">N°</th>
          <th className="py-2 px-2">Tipo</th>
          <th className="py-2 px-2">Empresa</th>
          <th className="py-2 px-2 text-center">Estado</th>
          <th className="py-2 px-2 text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
            <td className="py-2 px-2 text-gray-600 whitespace-nowrap">
              {new Date(c.created_at).toLocaleDateString("es-PE")}
            </td>
            <td className="py-2 px-2 font-mono">
              <Link href={`/dashboard/comprobantes?pedido_id=`} className="text-indigo-600 hover:underline" title={c.serie_numero}>
                {c.serie_numero}
              </Link>
            </td>
            <td className="py-2 px-2">{TIPO_LABEL[c.tipo] ?? c.tipo}</td>
            <td className="py-2 px-2 text-xs text-gray-600">{c.empresa}</td>
            <td className="py-2 px-2 text-center">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ESTADO_COMPROBANTE_COLOR[c.estado] ?? "bg-gray-100 text-gray-700"}`}>
                {c.estado.replace(/_/g, " ")}
              </span>
            </td>
            <td className="py-2 px-2 text-right font-mono font-semibold text-gray-700">
              S/ {toNum(c.monto_total).toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TablaCobranzas({ rows }: { rows: CobranzaItem[] }) {
  if (rows.length === 0) {
    return <div className="text-center text-gray-400 py-8">Sin cobranzas registradas</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase">
          <th className="py-2 px-2">Emisión</th>
          <th className="py-2 px-2">Vencimiento</th>
          <th className="py-2 px-2">Comprobante</th>
          <th className="py-2 px-2 text-center">Estado</th>
          <th className="py-2 px-2 text-right">Monto</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => {
          const colorEstado =
            f.estado === "Pagada"
              ? "bg-green-100 text-green-700"
              : f.estado === "Vencida"
              ? "bg-red-100 text-red-700"
              : "bg-amber-100 text-amber-700";
          return (
            <tr key={f.id} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="py-2 px-2 text-gray-600 whitespace-nowrap">{f.fecha_emision}</td>
              <td className="py-2 px-2 text-gray-600 whitespace-nowrap">
                {f.fecha_vencimiento}
                {f.estado === "Pagada" && f.fecha_pago && (
                  <div className="text-[10px] text-green-600">Pagado {f.fecha_pago}</div>
                )}
              </td>
              <td className="py-2 px-2 font-mono text-xs">
                {f.numero_comprobante ?? <span className="text-gray-400">—</span>}
              </td>
              <td className="py-2 px-2 text-center">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${colorEstado}`}>
                  {f.estado}
                </span>
              </td>
              <td className="py-2 px-2 text-right font-mono font-semibold text-gray-700">
                S/ {toNum(f.monto).toFixed(2)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TablaProductos({ rows }: { rows: ProductoTop[] }) {
  if (rows.length === 0) {
    return <div className="text-center text-gray-400 py-8">Sin productos comprados aún</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 uppercase">
          <th className="py-2 px-2">Producto</th>
          <th className="py-2 px-2">Categoría</th>
          <th className="py-2 px-2 text-right">Veces pedido</th>
          <th className="py-2 px-2 text-right">Cantidad total</th>
          <th className="py-2 px-2 text-right">Facturado</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => (
          <tr key={`${p.producto}-${i}`} className="border-t border-gray-100 hover:bg-gray-50">
            <td className="py-2 px-2 font-medium text-gray-800">{p.producto}</td>
            <td className="py-2 px-2 text-xs text-gray-500">{p.categoria}</td>
            <td className="py-2 px-2 text-right font-mono">{toNum(p.veces_pedido).toFixed(0)}</td>
            <td className="py-2 px-2 text-right font-mono">{toNum(p.cantidad_total).toFixed(2)}</td>
            <td className="py-2 px-2 text-right font-mono font-semibold text-gray-700">
              S/ {toNum(p.subtotal_total).toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
