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
  created_at: string;
  updated_at: string;
}

/** Cliente + su deuda total (saldo pendiente) calculada al vuelo. */
export interface ClientePlantaConSaldo extends ClientePlanta {
  /** Σ (monto − abonos) de sus cobranzas NO anuladas. Negativo = a favor. */
  saldo_actual: number;
  total_deuda: number; // Σ monto de cobranzas no anuladas
  total_abonado: number; // Σ abonos no anulados
  ultima_compra: string | null;
  ultimo_pago: string | null;
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
