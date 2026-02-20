// src/lib/types.ts
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
  entregado: boolean;
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
