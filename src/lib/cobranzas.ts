// src/lib/cobranzas.ts
// Helpers para gestión de cobranzas: cálculo de vencimiento, urgencia, creación de factura desde pedido.
import { neon } from "@neondatabase/serverless";

export type EstadoFactura = "Pendiente" | "Pagada" | "Vencida";
export type Urgencia = "vencida" | "urgente" | "proxima" | "holgada";

/**
 * Calcula la fecha de vencimiento sumando días al día de emisión.
 * Si plazo=0, vence el mismo día (pago al momento).
 */
export function calcularVencimiento(fechaEmision: Date, plazoDias: number): Date {
  const v = new Date(fechaEmision);
  v.setDate(v.getDate() + plazoDias);
  return v;
}

/**
 * Determina la urgencia de cobranza según días hasta vencimiento:
 *   vencida   = ya pasó la fecha
 *   urgente   = vence hoy o mañana
 *   proxima   = vence en 2-3 días
 *   holgada   = vence en 4+ días
 */
export function urgenciaCobranza(fechaVencimiento: Date | string): Urgencia {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const v = new Date(fechaVencimiento);
  v.setHours(0, 0, 0, 0);
  const diff = Math.round((v.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return "vencida";
  if (diff <= 1) return "urgente";
  if (diff <= 3) return "proxima";
  return "holgada";
}

/**
 * Crea una factura asociada a un pedido. Lee el plazo del cliente automáticamente.
 * Retorna el id de la factura + la fecha de vencimiento calculada.
 * NO bloqueante: si falla, lanza error pero no rompe el flujo del pedido.
 */
export async function crearFacturaParaPedido(params: {
  pedidoId: string;
  monto: number;
}): Promise<{ id: string; vencimiento: Date }> {
  const sql = neon(process.env.DATABASE_URL!);

  // Cargar datos del pedido + cliente (joineado)
  const pedidoRows = (await sql`
    SELECT p.cliente, p.cliente_id, p.asesor_id,
      COALESCE(c.plazo_pago_dias, 0) AS plazo
    FROM pedidos p
    LEFT JOIN clientes c ON p.cliente_id = c.id
    WHERE p.id = ${params.pedidoId}
  `) as Array<{
    cliente: string;
    cliente_id: string | null;
    asesor_id: string | null;
    plazo: string | number;
  }>;

  if (pedidoRows.length === 0) {
    throw new Error("Pedido no encontrado");
  }
  const { cliente, cliente_id, asesor_id, plazo } = pedidoRows[0];
  const plazoNum = Number(plazo);
  const vencimiento = calcularVencimiento(new Date(), plazoNum);
  const venIso = `${vencimiento.getFullYear()}-${String(vencimiento.getMonth() + 1).padStart(2, "0")}-${String(vencimiento.getDate()).padStart(2, "0")}`;

  const res = (await sql`
    INSERT INTO facturas (pedido_id, cliente_id, cliente_nombre, asesor_id, monto, plazo_dias, fecha_vencimiento)
    VALUES (${params.pedidoId}, ${cliente_id ?? null}, ${cliente}, ${asesor_id ?? null}, ${params.monto}, ${plazoNum}, ${venIso}::date)
    RETURNING id
  `) as Array<{ id: string }>;

  return { id: res[0].id, vencimiento };
}

/**
 * Crea una factura (cobranza) NO asociada a un pedido — para ventas facturadas
 * de forma independiente (sin pedido) y a crédito. pedido_id queda NULL implícito.
 * Retorna el id de la factura insertada.
 */
export async function crearFacturaStandalone(params: {
  clienteNombre: string;
  clienteId?: string | null;
  asesorId?: string | null;
  monto: number;
  plazoDias: number;
  numeroComprobante?: string | null;
  pedidoId?: string | null;
}): Promise<string> {
  const sql = neon(process.env.DATABASE_URL!);

  const plazoNum = Number(params.plazoDias);
  const vencimiento = calcularVencimiento(new Date(), plazoNum);
  const venIso = `${vencimiento.getFullYear()}-${String(vencimiento.getMonth() + 1).padStart(2, "0")}-${String(vencimiento.getDate()).padStart(2, "0")}`;

  const res = (await sql`
    INSERT INTO facturas (cliente_nombre, cliente_id, asesor_id, monto, plazo_dias, fecha_vencimiento, numero_comprobante, pedido_id)
    VALUES (${params.clienteNombre}, ${params.clienteId ?? null}, ${params.asesorId ?? null}, ${params.monto}, ${plazoNum}, ${venIso}::date, ${params.numeroComprobante ?? null}, ${params.pedidoId ?? null})
    RETURNING id
  `) as Array<{ id: string }>;

  return res[0].id;
}

/**
 * Calcula el monto del pedido sumando los subtotales reales (o estimados si no hay real).
 */
export async function calcularMontoPedido(pedidoId: string): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  const row = (await sql`
    SELECT COALESCE(SUM(COALESCE(subtotal_real, subtotal, 0)), 0)::numeric AS total
    FROM pedido_items WHERE pedido_id = ${pedidoId}
  `) as Array<{ total: string | number }>;
  return Number(row[0]?.total ?? 0);
}
