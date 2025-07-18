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
  fecha_pedido: string; // La recibimos como string formateado
  peso_exacto: number | null;
  created_at: Date;
};
