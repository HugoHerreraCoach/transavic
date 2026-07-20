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
  origen?: string | null;
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
  // --- Reprogramación (badge visible para producción y asesoras) ---
  /** Fecha de entrega ANTERIOR ya formateada DD/MM (NULL si la marca fue "más tarde"). */
  reprogramado_de?: string | null;
  reprogramado_at?: string | null;
  reprogramado_motivo?: string | null;
};

export type User = {
  id: string;
  name: string;
  role: string;
  chofer_dni?: string | null;
  chofer_licencia?: string | null;
  vehiculo_placa?: string | null;
  chofer_nombres?: string | null;
  chofer_apellidos?: string | null;
  activo_rotacion?: boolean;
  orden_rotacion?: number;
  leads_recibidos_hoy?: number;
  /** FALSE = ex-empleado desactivado: el login lo rechaza (jamás se borra la fila). */
  activo?: boolean;
  /** TRUE = usuario observador: puede ver todo su rol pero el middleware bloquea toda escritura. */
  solo_lectura?: boolean;
  /** Lista de hrefs de sección que puede ver/abrir. NULL = sin restricción (defaults del rol). */
  vistas_permitidas?: string[] | null;
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
  guia_firmada_at?: string | null;
};

export type LeadEstado = 'Nuevo' | 'Contactado' | 'Calificado' | 'Propuesta' | 'Cerrado' | 'Perdido';

export type Lead = {
  id: string;
  nombre: string;
  telefono: string;
  negocio: string | null;
  ciudad: string | null;
  origen: string;
  empresa: string;
  estado: LeadEstado;
  vendedor_id: string | null;
  vendedor_name?: string | null;
  chatbot_activo: boolean;
  notas: string | null;
  tags?: string[] | null;
  unread_count?: number;
  /** Instante en que el bot empezó a generar una respuesta (NULL = no está trabajando).
   *  La UI solo muestra "escribiendo…" si es reciente, para que un flag colgado no
   *  deje el indicador encendido para siempre. */
  bot_pensando_desde?: string | Date | null;
  last_inbound_at?: string | Date | null;
  estado_asignacion?: string | null;
  candidato_actual?: string | null;
  candidatos_nivel?: string[] | null;
  inicio_turno?: string | Date | null;
  timeout_nivel?: number | null;
  golden_ticket_phase?: string | null;
  created_at: Date;
  updated_at: Date;
};

export type LeadMensaje = {
  id: string;
  lead_id: string;
  sender: 'cliente' | 'bot' | 'asesora' | string;
  body: string;
  type: string;
  created_at: Date;
  /** Estado de entrega del mensaje saliente (WhatsApp Cloud API). */
  estado?: 'enviado' | 'entregado' | 'leido' | 'fallido' | null;
  whatsapp_message_id?: string | null;
  media_url?: string | null;
  error_msg?: string | null;
};

