// app/types/pedido.ts

// Lista de distritos como un tipo para autocompletado y seguridad.
export const distritos = [
  "La Victoria",
  "Lince",
  "San Isidro",
  "San Miguel",
  "San Borja",
  "Breña",
  "Surquillo",
  "Cercado de Lima",
  "Miraflores",
  "La Molina",
  "Surco",
  "Magdalena",
  "Jesús María",
  "Salamanca",
  "Barranco",
  "San Luis",
  "Santa Beatriz",
  "Pueblo Libre",
] as const; // 'as const' lo convierte en una tupla de solo lectura

// Creamos un tipo de unión a partir del array de distritos
export type Distrito = (typeof distritos)[number];

// Creamos un tipo para las opciones de empresa
export type Empresa = "Transavic" | "Avícola de Tony";

// La interfaz principal para los datos del ticket
export interface TicketData {
  cliente: string;
  whatsapp: string;
  direccion: string;
  distrito: Distrito; // Usamos nuestro nuevo tipo
  tipoCliente: "Frecuente" | "Nuevo";
  detalle: string;
  horaEntrega: string;
  notas: string;
  empresa: Empresa;
  fecha: string; // Campo para la fecha de generación
}
