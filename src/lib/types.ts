// src/lib/types.ts

export type EstadoPedido = 'Pendiente' | 'Asignado' | 'En_Camino' | 'Entregado' | 'Fallido';

export type Pedido = {
  id: string;
  cliente: string;
  whatsapp: string | null;
  direccion: string | null;
  distrito: string | null;
  tipo_cliente: string | null;
  detalle: string;
  hora_entrega: string | null;
  notas: string | null;
  empresa: string;
  fecha_pedido: string;
  detalle_final: string | null;
  created_at: Date;
  latitude: number | null;
  longitude: number | null;
  // --- Campos de despacho ---
  estado: EstadoPedido;
  repartidor_id: string | null;
  repartidor_name: string | null;
  orden_ruta: number | null;
  hora_llegada_estimada: string | null;
  razon_fallo: string | null;
  inicio_viaje_at: string | null;
  // --- Delivery externo ---
  es_delivery_externo: boolean;
  delivery_externo_nombre: string | null;
  // --- Campos legacy (se mantienen por compatibilidad) ---
  entregado: boolean;
  entregado_por: string | null;
  entregado_at: string | null;
  asesor_id: string | null;
  asesor_name: string | null;
};

export type User = {
  id: string;
  name: string;
  role: string;
};

export type Producto = {
  id: string;
  nombre: string;
  categoria: 'Pollo' | 'Carnes' | 'Huevos';
  unidad: string;
  activo: boolean;
};

export type PedidoItem = {
  id: string;
  pedido_id: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  unidad: string;
  notas: string | null;
};

// Vista simplificada para la ruta del repartidor
export type PedidoRuta = {
  id: string;
  cliente: string;
  direccion: string | null;
  distrito: string | null;
  whatsapp: string | null;
  latitude: number | null;
  longitude: number | null;
  estado: EstadoPedido;
  orden_ruta: number | null;
  hora_entrega: string | null;
  hora_llegada_estimada: string | null;
  inicio_viaje_at: string | null;
  razon_fallo: string | null;
  detalle: string;
  notas: string | null;
};
