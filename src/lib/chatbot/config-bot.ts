// src/lib/chatbot/config-bot.ts
//
// Datos del negocio que usa el bot de ventas de WhatsApp, editables por el admin
// desde `settings.bot_ventas` (JSONB). Mismo patrón que `src/lib/parametros-negocio.ts`.
//
// REGLA (heredada de parametros-negocio): los DEFAULTS de acá son EXACTAMENTE la
// verdad de los documentos que entregó Antonio ("Antonella 2.0 – Verdad Única",
// "Ficha Comercial", "Beneficios"). Si la clave no existe en la DB, el bot se
// comporta igual que si estuviera configurado. Nunca revienta por un setting
// ausente o malformado.
//
// Qué NO va acá: el prompt en sí. El texto vive en `prompt-antonella.ts` (git)
// porque contiene el contrato `[HANDOFF]` del que dependen `pideHandoff()` y el
// apagado de `chatbot_activo`. Si eso fuera editable en un textarea, un pegado
// desprolijo dejaría al bot sin transferir y nadie se enteraría.
import type { NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Cuándo habla el bot.
 *  - `fuera_horario`: solo cuando NO hay asesoras (noches y días no laborables).
 *    Dentro del horario responde una humana y el bot se queda callado.
 *  - `siempre`: atiende las 24 h; la asesora lo pausa al entrar al chat.
 */
export type CuandoRespondeBot = "fuera_horario" | "siempre";

export interface ConfigBot {
  /** Interruptor general: en false, el bot no responde (contesta una humana). */
  activo: boolean;
  /**
   * Decisión de Hugo (13 ago 2026): el bot cubre el hueco, no reemplaza a las
   * asesoras. Por eso el default es `fuera_horario` y no `siempre`.
   */
  cuando_responde: CuandoRespondeBot;
  /** Nombre con el que se presenta. */
  asesora_nombre: string;
  anios_experiencia: number;
  /** Los 18 distritos donde SÍ se reparte. */
  distritos_cobertura: string[];
  /** Texto de los días de reparto, tal como se lo dice al cliente. */
  dias_reparto: string;
  /** Ventana de REPARTO (llega el pedido a la puerta). */
  reparto_hora_inicio: number;
  reparto_hora_fin: number;
  /** Días de reparto, 1 = lunes … 7 = domingo. */
  dias_reparto_num: number[];
  /** Ventana de ATENCIÓN por WhatsApp — distinta de la de reparto. */
  atencion_hora_inicio: number;
  atencion_hora_fin: number;
  dias_atencion: number[];
  medios_pago: string[];
  /** Pedido mínimo sugerido. El bot no rechaza: invita a llegar al mínimo. */
  minimo_hogar_kg: number;
  minimo_negocio_kg: number;
  /** Argumentos de venta (el prompt usa los primeros). */
  beneficios: string[];
  /** Si la carta incluye res y cerdo (existen en el catálogo de las dos marcas). */
  incluir_carnes_rojas: boolean;
  /** Qué hacer con una pollería: cerrar con amabilidad o pasarla a una asesora. */
  politica_pollerias: "rechazar" | "derivar";
  /** Válvula de tono para el admin. Se inyecta al final del prompt, acotado. */
  instrucciones_extra: string;
  temperatura: number;
  max_tokens: number;
  /** Cuánto se cachea la carta con precios (segundos). */
  ttl_carta_seg: number;
}

/** La verdad de los documentos de Antonio (5 ago 2026). */
export const CONFIG_BOT_DEFAULT: ConfigBot = {
  activo: true,
  cuando_responde: "fuera_horario",
  asesora_nombre: "Antonella",
  anios_experiencia: 9,
  // Ojo: la lista del docx dice "San Beatriz"; la del sistema (DISTRITOS_CRM en
  // crm-leads-client.tsx) dice "Santa Beatriz" y es la que eligen las asesoras.
  distritos_cobertura: [
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
  ],
  dias_reparto: "lunes a sábado",
  reparto_hora_inicio: 8,
  reparto_hora_fin: 12,
  dias_reparto_num: [1, 2, 3, 4, 5, 6],
  atencion_hora_inicio: 8,
  atencion_hora_fin: 20,
  dias_atencion: [1, 2, 3, 4, 5, 6],
  medios_pago: ["Yape", "Plin", "tarjeta", "transferencia", "efectivo"],
  minimo_hogar_kg: 5,
  minimo_negocio_kg: 10,
  beneficios: [
    "100% fresco del día, sin congeladoras: directo de planta a tu cocina",
    "corte limpio y presentación lista para cocinar",
    "entrega puntual en 18 distritos de Lima, con seguimiento interno",
    "variedad de cortes para cada uso y presupuesto",
    "9 años de experiencia y clientes que repiten",
    "pagos fáciles: Yape, Plin, tarjeta, transferencia o efectivo",
  ],
  incluir_carnes_rojas: true,
  politica_pollerias: "rechazar",
  instrucciones_extra: "",
  temperatura: 0.6,
  max_tokens: 500,
  ttl_carta_seg: 300,
};

/** Tope del texto libre del admin: evita que un pegado gigante desplace las reglas. */
export const MAX_INSTRUCCIONES_EXTRA = 800;

/** Mezcla lo guardado con los defaults, tolerando settings viejos o incompletos. */
export function normalizarConfigBot(crudo: unknown): ConfigBot {
  const base: ConfigBot = {
    ...CONFIG_BOT_DEFAULT,
    distritos_cobertura: [...CONFIG_BOT_DEFAULT.distritos_cobertura],
    dias_reparto_num: [...CONFIG_BOT_DEFAULT.dias_reparto_num],
    dias_atencion: [...CONFIG_BOT_DEFAULT.dias_atencion],
    medios_pago: [...CONFIG_BOT_DEFAULT.medios_pago],
    beneficios: [...CONFIG_BOT_DEFAULT.beneficios],
  };
  if (typeof crudo !== "object" || crudo === null) return base;
  const p = crudo as Partial<Record<keyof ConfigBot, unknown>>;

  const listaDeTextos = (v: unknown): string[] | null =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.trim() !== "")
      ? (v as string[]).map((x) => x.trim())
      : null;
  const listaDeDias = (v: unknown): number[] | null =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && x >= 1 && x <= 7)
      ? (v as number[])
      : null;
  const numero = (v: unknown, min: number, max: number): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
  const texto = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  if (typeof p.activo === "boolean") base.activo = p.activo;
  // Cualquier valor raro cae al default (`fuera_horario`): ante la duda, que el
  // bot cubra el hueco y no que hable encima de las asesoras.
  if (p.cuando_responde === "siempre" || p.cuando_responde === "fuera_horario") {
    base.cuando_responde = p.cuando_responde;
  }
  if (typeof p.incluir_carnes_rojas === "boolean") base.incluir_carnes_rojas = p.incluir_carnes_rojas;
  base.asesora_nombre = texto(p.asesora_nombre) ?? base.asesora_nombre;
  base.anios_experiencia = numero(p.anios_experiencia, 0, 200) ?? base.anios_experiencia;
  base.distritos_cobertura = listaDeTextos(p.distritos_cobertura) ?? base.distritos_cobertura;
  base.dias_reparto = texto(p.dias_reparto) ?? base.dias_reparto;
  base.reparto_hora_inicio = numero(p.reparto_hora_inicio, 0, 23) ?? base.reparto_hora_inicio;
  base.reparto_hora_fin = numero(p.reparto_hora_fin, 1, 24) ?? base.reparto_hora_fin;
  base.dias_reparto_num = listaDeDias(p.dias_reparto_num) ?? base.dias_reparto_num;
  base.atencion_hora_inicio = numero(p.atencion_hora_inicio, 0, 23) ?? base.atencion_hora_inicio;
  base.atencion_hora_fin = numero(p.atencion_hora_fin, 1, 24) ?? base.atencion_hora_fin;
  base.dias_atencion = listaDeDias(p.dias_atencion) ?? base.dias_atencion;
  base.medios_pago = listaDeTextos(p.medios_pago) ?? base.medios_pago;
  base.minimo_hogar_kg = numero(p.minimo_hogar_kg, 0, 1000) ?? base.minimo_hogar_kg;
  base.minimo_negocio_kg = numero(p.minimo_negocio_kg, 0, 5000) ?? base.minimo_negocio_kg;
  base.beneficios = listaDeTextos(p.beneficios) ?? base.beneficios;
  if (p.politica_pollerias === "rechazar" || p.politica_pollerias === "derivar") {
    base.politica_pollerias = p.politica_pollerias;
  }
  base.instrucciones_extra = (texto(p.instrucciones_extra) ?? "").slice(
    0,
    MAX_INSTRUCCIONES_EXTRA
  );
  base.temperatura = numero(p.temperatura, 0, 2) ?? base.temperatura;
  base.max_tokens = numero(p.max_tokens, 120, 2000) ?? base.max_tokens;
  base.ttl_carta_seg = numero(p.ttl_carta_seg, 0, 3600) ?? base.ttl_carta_seg;

  // Coherencia: una ventana invertida (fin <= inicio) dejaría al bot creyendo que
  // nunca es horario de atención.
  if (base.atencion_hora_fin <= base.atencion_hora_inicio) {
    base.atencion_hora_inicio = CONFIG_BOT_DEFAULT.atencion_hora_inicio;
    base.atencion_hora_fin = CONFIG_BOT_DEFAULT.atencion_hora_fin;
  }
  if (base.reparto_hora_fin <= base.reparto_hora_inicio) {
    base.reparto_hora_inicio = CONFIG_BOT_DEFAULT.reparto_hora_inicio;
    base.reparto_hora_fin = CONFIG_BOT_DEFAULT.reparto_hora_fin;
  }
  return base;
}

/** Lectura SERVER-SIDE: nunca lanza; ante cualquier fallo, defaults. */
export async function leerConfigBot(
  sql: NeonQueryFunction<false, false>
): Promise<ConfigBot> {
  try {
    const filas = await sql`SELECT value FROM settings WHERE key = 'bot_ventas'`;
    return normalizarConfigBot(filas[0]?.value);
  } catch {
    return normalizarConfigBot(null);
  }
}
