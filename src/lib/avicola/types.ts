// src/lib/avicola/types.ts
// Tipos del módulo "Clientes Avícola" (venta en campo del Gerente General).
// Módulo INDEPENDIENTE de pedidos/clientes/facturas — tablas propias:
// clientes_avicola, ventas_avicola, venta_avicola_items, abonos_avicola.
// Ver scripts/migrate-clientes-avicola-2026-07-07.sql.

export const MEDIOS_PAGO_AVICOLA = [
  "efectivo",
  "transferencia",
  "yape",
  "plin",
  "otro",
] as const;
export type MedioPagoAvicola = (typeof MEDIOS_PAGO_AVICOLA)[number];

export const ETIQUETA_MEDIO_PAGO: Record<MedioPagoAvicola, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  yape: "Yape",
  plin: "Plin",
  otro: "Otro",
};

export const EMPRESAS_AVICOLA = ["Transavic", "Avícola de Tony"] as const;
export type EmpresaAvicola = (typeof EMPRESAS_AVICOLA)[number];

export interface ClienteAvicola {
  id: string;
  nombre: string;
  mercado: string;
  numero_puesto: string | null;
  telefono: string | null;
  direccion: string | null;
  observaciones: string | null;
  empresa: EmpresaAvicola;
  saldo_anterior: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

/** Cliente + estado de cuenta calculado al vuelo (src/lib/avicola/saldos.ts). */
export interface ClienteAvicolaConSaldo extends ClienteAvicola {
  total_vendido: number;
  total_abonado: number;
  /** saldo_anterior + total_vendido − total_abonado. Negativo = a favor del cliente. */
  saldo_actual: number;
  ultima_compra: string | null; // YYYY-MM-DD
  ultimo_pago: string | null; // YYYY-MM-DD
}

export interface VentaAvicolaItem {
  id: string;
  venta_id: string;
  producto_id: string | null;
  producto_nombre: string;
  peso_kg: number;
  precio_kg: number;
  subtotal: number;
}

export interface VentaAvicola {
  id: string;
  cliente_id: string;
  numero_guia: number;
  fecha: string; // YYYY-MM-DD
  total: number;
  observaciones: string | null;
  anulada: boolean;
  anulacion_motivo: string | null;
  created_at: string;
}

export interface AbonoAvicola {
  id: string;
  cliente_id: string;
  fecha: string; // YYYY-MM-DD
  monto: number;
  medio_pago: MedioPagoAvicola;
  observaciones: string | null;
  tiene_comprobante: boolean;
  anulado: boolean;
  anulacion_motivo: string | null;
  created_at: string;
}

/**
 * Bloque de estado de cuenta que va impreso en la guía (req. §9).
 * Anclado por created_at (ver estadoCuentaParaGuia en saldos.ts):
 *   saldo_previo       = saldo_anterior + ventas − abonos ANTERIORES a la venta
 *   abonos_aplicados   = abonos posteriores a la venta y anteriores a la siguiente
 *   saldo_actualizado  = saldo_previo + total_venta − abonos_aplicados
 */
export interface EstadoCuentaGuia {
  saldo_previo: number;
  total_venta: number;
  /** Abonos aplicados tras esta venta y antes de la siguiente (pueden ser de otro día). */
  abonos_aplicados: number;
  saldo_actualizado: number;
}

/** Todo lo que necesita el ticket de la guía para renderizarse/compartirse. */
export interface GuiaAvicolaData {
  venta_id: string;
  numero_guia: number;
  fecha: string;
  cliente: {
    nombre: string;
    mercado: string;
    numero_puesto: string | null;
    telefono: string | null;
    empresa: EmpresaAvicola;
  };
  items: Array<{
    producto_nombre: string;
    peso_kg: number;
    precio_kg: number;
    subtotal: number;
  }>;
  total: number;
  estado_cuenta: EstadoCuentaGuia;
  anulada: boolean;
  observaciones: string | null;
}

/** Movimiento del historial del cliente (ventas + abonos intercalados). */
export interface MovimientoAvicola {
  tipo: "venta" | "abono";
  id: string;
  fecha: string;
  created_at: string;
  /** Total de la venta o monto del abono. */
  monto: number;
  numero_guia: number | null;
  medio_pago: MedioPagoAvicola | null;
  observaciones: string | null;
  anulado: boolean;
  anulacion_motivo: string | null;
  tiene_comprobante: boolean;
  /** Solo para ventas: líneas con peso y precio usados (req. §6). */
  items?: VentaAvicolaItem[];
}

/** Respuesta de GET /api/avicola/clientes/[id] (ficha 360). */
export interface FichaClienteAvicola {
  cliente: ClienteAvicolaConSaldo;
  historial: MovimientoAvicola[];
}

/** Respuesta de GET /api/avicola/liquidacion (req. §11). */
export interface LiquidacionAvicola {
  fecha: string;
  ventas: {
    total_vendido: number;
    total_kg: number;
    clientes_atendidos: number;
    por_cliente: Array<{
      cliente_id: string;
      nombre: string;
      mercado: string;
      vendido: number;
      abonado: number;
      saldo_actual: number;
      medios: MedioPagoAvicola[];
    }>;
    por_producto: Array<{
      producto_nombre: string;
      total_kg: number;
      total_monto: number;
    }>;
  };
  cobranza: {
    total_cobrado: number;
    pendiente_del_dia: number;
    cartera_total: number;
    por_medio: Array<{ medio_pago: MedioPagoAvicola; total: number }>;
  };
  clientes: {
    visitados: number;
    con_pago: number;
    sin_pago: number;
    con_deuda: number;
  };
}

/** Respuesta de GET /api/avicola/dashboard (req. §14). */
export interface DashboardAvicola {
  total_clientes: number;
  clientes_activos: number;
  clientes_con_deuda: number;
  cartera_total: number;
  ventas: { dia: number; semana: number; mes: number };
  cobranza: { dia: number; mes: number };
  ticket_promedio_mes: number;
  kg_vendidos_mes: number;
  ranking_volumen: Array<{
    cliente_id: string;
    nombre: string;
    mercado: string;
    total: number;
  }>;
  ranking_deuda: Array<{
    cliente_id: string;
    nombre: string;
    mercado: string;
    saldo_actual: number;
  }>;
  sin_comprar: {
    d7: Array<{ cliente_id: string; nombre: string; mercado: string; dias: number }>;
    d15: Array<{ cliente_id: string; nombre: string; mercado: string; dias: number }>;
    d30: Array<{ cliente_id: string; nombre: string; mercado: string; dias: number }>;
  };
}
