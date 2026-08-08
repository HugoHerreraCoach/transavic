// src/lib/planta/types.ts
// Tipos de la operación 3 "Venta en Planta" (POS): clientes y cobranzas PROPIOS,
// aislados de `clientes`/`facturas` de ejecutivas. El POS sigue escribiendo la
// venta en `pedidos` (conserva orden imprimible + comprobante SUNAT); solo su
// directorio de clientes y su cobranza a crédito ("saldito") viven aquí.
// Ver scripts/migrate-planta-clientes-cobranzas-2026-07-08.sql.

export const MEDIOS_PAGO_PLANTA = [
  "efectivo",
  "transferencia",
  "yape",
  "plin",
  "otro",
] as const;
export type MedioPagoPlanta = (typeof MEDIOS_PAGO_PLANTA)[number];

export const ETIQUETA_MEDIO_PAGO_PLANTA: Record<MedioPagoPlanta, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  yape: "Yape",
  plin: "Plin",
  otro: "Otro",
};

export const EMPRESAS_PLANTA = ["Transavic", "Avícola de Tony"] as const;
export type EmpresaPlanta = (typeof EMPRESAS_PLANTA)[number];

export type EstadoCobranzaPlanta =
  | "Pendiente"
  | "Parcial"
  | "Vencida"
  | "Pagada"
  | "Anulada";

export interface ClientePlanta {
  id: string;
  nombre: string;
  razon_social: string | null;
  ruc_dni: string | null;
  telefono: string | null;
  direccion: string | null;
  plazo_pago_dias: number;
  activo: boolean;
  empresa: EmpresaPlanta;
  /** Deuda que el cliente traía de ANTES del sistema (default 0). */
  saldo_anterior: number;
  created_at: string;
  updated_at: string;
}

/** Cliente + su deuda total (saldo pendiente) calculada al vuelo. */
export interface ClientePlantaConSaldo extends ClientePlanta {
  /** saldo_anterior + total_deuda − total_abonado. Negativo = a favor. */
  saldo_actual: number;
  total_deuda: number; // Σ monto de cobranzas no anuladas (solo CRÉDITO)
  total_abonado: number; // Σ abonos no anulados
  /** Σ de sus ventas al CONTADO. Suma a lo comprado, NO a la deuda. */
  total_contado: number;
  /** La más reciente entre una compra a crédito y una al contado. */
  ultima_compra: string | null;
  ultimo_pago: string | null;
}

/** Un movimiento del historial del cliente de planta (compras + abonos). */
export interface MovimientoPlanta {
  tipo: "venta" | "abono";
  id: string;
  /** YYYY-MM-DD */
  fecha: string;
  created_at: string;
  /** Total de la compra o monto del abono. */
  monto: number;
  /** Solo en ventas: si generó deuda o se pagó en el acto. */
  tipo_pago: "Contado" | "Credito" | null;
  medio_pago: MedioPagoPlanta | null;
  observaciones: string | null;
  anulado: boolean;
  anulacion_motivo: string | null;
  tiene_comprobante: boolean;
  /** Serie-número del comprobante SUNAT vivo, si la venta lo tiene. */
  comprobante_serie_numero: string | null;
  creado_por_nombre: string | null;
  /** Solo para ventas: las líneas de producto. */
  items?: ItemMovimientoPlanta[];
}

export interface ItemMovimientoPlanta {
  pedido_id: string;
  producto_nombre: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  subtotal: number;
}

/** Respuesta de GET /api/clientes-planta/[id] (ficha 360). */
export interface FichaClientePlanta {
  cliente: ClientePlantaConSaldo;
  cobranzas: CobranzaPlanta[];
  historial: MovimientoPlanta[];
}

export interface CobranzaPlanta {
  id: string;
  pedido_id: string | null;
  cliente_planta_id: string;
  cliente_nombre: string;
  monto: number;
  plazo_dias: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: EstadoCobranzaPlanta;
  comprobante_id: string | null;
  empresa: EmpresaPlanta;
  notas: string | null;
  anulada: boolean;
  anulacion_motivo: string | null;
  created_at: string;
  /** Derivados: saldo = monto − Σ abonos (NOT anulado). */
  total_abonado: number;
  saldo: number;
}

export interface AbonoPlanta {
  id: string;
  cobranza_id: string;
  monto: number;
  medio_pago: MedioPagoPlanta;
  fecha: string;
  observaciones: string | null;
  tiene_comprobante: boolean;
  anulado: boolean;
  anulacion_motivo: string | null;
  created_at: string;
}
