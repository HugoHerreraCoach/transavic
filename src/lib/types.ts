// src/lib/types.ts

export type EstadoPedido =
  | 'Pendiente'
  | 'En_Produccion'
  | 'Listo_Para_Despacho'
  | 'Asignado'
  | 'En_Camino'
  | 'Entregado'
  | 'Fallido';

export type Pedido = {
  id: string;
  cliente: string;
  whatsapp: string | null;
  direccion: string | null;
  distrito: string | null;
  tipo_cliente: string | null;
  detalle: string;
  hora_entrega: string | null;
  razon_social: string | null;
  ruc_dni: string | null;
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
  // --- Ruta y distancias ---
  distancia_km: number | null;
  duracion_estimada_min: number | null;
  // --- Delivery externo ---
  es_delivery_externo: boolean;
  delivery_externo_nombre: string | null;
  // --- Campos legacy (se mantienen por compatibilidad) ---
  entregado: boolean;
  entregado_por: string | null;
  entregado_at: string | null;
  asesor_id: string | null;
  asesor_name: string | null;
  // --- Orden firmada por el cliente (foto que sube el repartidor) ---
  guia_firmada_at?: string | null;
};

export type User = {
  id: string;
  name: string;
  role: string;
};

export type Producto = {
  id: string;
  nombre: string;
  // El catálogo permite categorías custom (ver POST /api/productos), por eso
  // dejamos `string` y los 3 valores comunes como hints en el tipo.
  categoria: 'Pollo' | 'Carnes' | 'Huevos' | string;
  unidad: string;
  activo: boolean;
  codigo?: string | null;
  precio_venta?: number | string | null;
  precio_compra?: number | string | null;
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
  distancia_km: number | null;
  duracion_estimada_min: number | null;
  asesor_name: string | null;
};
