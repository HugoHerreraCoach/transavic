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
