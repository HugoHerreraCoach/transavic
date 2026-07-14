export type EstadoPagoProveedor = "registrado" | "anulado";
export type EstadoDeudaProveedor = "Pendiente" | "Parcial" | "Pagado";

export interface ProveedorFichaBasica {
  id: string;
  razon_social: string;
  ruc: string | null;
  telefono: string | null;
  direccion: string | null;
  activo: boolean;
  plazo_pago_dias: number;
}

export interface ItemCompraProveedor {
  id: string;
  producto_nombre: string;
  peso_neto: number;
  jabas: number;
  costo_unitario: number;
  subtotal: number;
  tipo: "ingreso" | "devolucion";
}

export interface AplicacionPagoProveedor {
  id: string;
  pago_id: string;
  deuda_id: string;
  monto: number;
  origen: "pago" | "anticipo_posterior" | "migracion";
  fecha_aplicacion: string;
  documento: string | null;
}

export interface DeudaProveedorFicha {
  id: string;
  compra_id: string | null;
  fecha: string;
  fecha_vencimiento: string | null;
  tipo_doc: string | null;
  nro_doc: string | null;
  concepto: string | null;
  monto_deuda: number;
  monto_pagado: number;
  saldo_restante: number;
  estado: EstadoDeudaProveedor;
  created_at: string;
  items: ItemCompraProveedor[];
  aplicaciones: AplicacionPagoProveedor[];
}

export interface PagoProveedorFicha {
  id: string;
  fecha: string;
  monto: number;
  notas: string | null;
  estado: EstadoPagoProveedor;
  cuenta_nombre: string;
  registrado_por: string;
  created_at: string;
  motivo_anulacion: string | null;
  anulado_at: string | null;
  total_aplicado: number;
  saldo_anticipo: number;
  aplicaciones: AplicacionPagoProveedor[];
}

export interface MovimientoProveedorBase {
  id: string;
  tipo: "deuda" | "pago" | "contraasiento";
  fecha: string;
  created_at: string;
  monto: number;
  documento: string | null;
  concepto: string;
  cuenta_nombre: string | null;
  notas: string | null;
  items: ItemCompraProveedor[];
  aplicaciones: AplicacionPagoProveedor[];
}

export interface MovimientoEstadoCuentaProveedor extends MovimientoProveedorBase {
  saldo_anterior: number;
  saldo_posterior: number;
}

export interface EstadoCuentaProveedor {
  desde: string | null;
  hasta: string | null;
  saldo_inicial: number;
  total_comprado: number;
  total_pagado: number;
  saldo_final: number;
  deuda_pendiente: number;
  saldo_favor: number;
  movimientos: MovimientoEstadoCuentaProveedor[];
}

export interface ResumenProveedor {
  deuda_anterior: number;
  saldo_favor_anterior: number;
  total_comprado: number;
  total_pagado: number;
  deuda_pendiente: number;
  saldo_favor: number;
}

export interface FichaProveedorResponse {
  proveedor: ProveedorFichaBasica;
  resumen: ResumenProveedor;
  deudas: DeudaProveedorFicha[];
  pagos: PagoProveedorFicha[];
  movimientos: MovimientoProveedorBase[];
  estado_cuenta: EstadoCuentaProveedor;
}
