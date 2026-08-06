// src/lib/chatbot/contexto-negocio.ts
//
// Todo lo que el bot necesita saber para no inventar: la carta con PRECIOS REALES
// del catálogo, la fecha/hora de Lima, el próximo reparto, con quién está hablando
// y si esa persona ya es cliente.
//
// Reglas que se respetan acá:
//   - NUNCA se afirma stock: `inventario_lotes` es deliberadamente no bloqueante y
//     puede quedar negativo (doc 09). El bot dice "te lo reservo y te confirmo".
//   - Al LLM viaja el PRIMER NOMBRE del cliente y nombres de producto. Nunca
//     apellidos, RUC/DNI, dirección, teléfono, montos ni saldos. Esa frontera se
//     decide en este archivo (ver `perfilCliente`).
//   - Esta función NUNCA lanza: si la DB falla, devuelve un contexto degradado
//     (sin precios) y el prompt le dice al bot que consulte con una asesora.
//
// Costo en Neon: el catálogo se memoiza por instancia (TTL configurable). Se
// consulta solo cuando un cliente escribe — la DB ya está despierta por el propio
// mensaje, así que no suma tiempo encendido (gotcha #60 es sobre crons).
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { EmpresaWhatsApp } from "../whatsapp/config";
import {
  buscarEnCatalogo,
  cartaDeMarca,
  normalizarTexto,
  type CategoriaCarta,
  type ItemCarta,
} from "./carta-comercial";
import { leerConfigBot, normalizarConfigBot, type ConfigBot } from "./config-bot";

const TZ = "America/Lima";

/** 1 = lunes … 7 = domingo (ISO), para que coincida con `dias_atencion`. */
const DIAS_NOMBRE = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MESES_NOMBRE = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export interface PrecioCarta {
  comercial: string;
  uso?: string;
  /** `null` = no está en el catálogo o no tiene precio → "a consultar". */
  precio: number | null;
  unidadTexto: string;
  categoria: CategoriaCarta;
}

export interface PerfilClienteBot {
  esCliente: boolean;
  rubro: string | null;
  distrito: string | null;
  /** Hasta 3 productos, ya traducidos a nombre comercial. */
  topProductos: string[];
  diasDesdeUltimaCompra: number | null;
}

export interface MomentoLima {
  fechaLarga: string;
  hora: string;
  horaNum: number;
  diaSemana: number;
  dentroDeAtencion: boolean;
  proximoReparto: string;
}

export interface ContextoNegocio {
  empresa: EmpresaWhatsApp;
  marcaNombre: string;
  config: ConfigBot;
  carta: PrecioCarta[];
  /** La carta salió vacía (DB caída o catálogo renombrado): no cotizar. */
  cartaDegradada: boolean;
  momento: MomentoLima;
  lead: { primerNombre: string | null; distrito: string | null; rubro: string | null };
  cliente: PerfilClienteBot;
}

interface FilaCatalogo {
  nombre: string;
  unidad: string | null;
  precio_venta: string | number | null;
}

// ── Fecha y hora de Lima ────────────────────────────────────────────────

interface PartesFecha {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  /** 1 = lunes … 7 = domingo */
  diaSemana: number;
}

const MAPA_DIA: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function partesLima(fecha: Date): PartesFecha {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(fecha);
  const val = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return {
    anio: Number(val("year")),
    mes: Number(val("month")),
    dia: Number(val("day")),
    hora: Number(val("hour")) % 24,
    minuto: Number(val("minute")),
    diaSemana: MAPA_DIA[val("weekday")] ?? 1,
  };
}

/** Suma días calendario sobre una fecha de Lima, sin arrastrar zonas horarias. */
function desplazar(p: PartesFecha, dias: number): { dia: number; mes: number; diaSemana: number } {
  const d = new Date(Date.UTC(p.anio, p.mes - 1, p.dia + dias));
  return {
    dia: d.getUTCDate(),
    mes: d.getUTCMonth() + 1,
    // getUTCDay(): 0 = domingo → ISO 1..7
    diaSemana: d.getUTCDay() === 0 ? 7 : d.getUTCDay(),
  };
}

function dosDigitos(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Fecha, hora y próximo reparto. PURA (recibe la fecha) para poder testearla.
 *
 * "Próximo reparto": el siguiente día de reparto. Si hoy es día de reparto y aún
 * faltan 2 horas o más para que empiece, todavía se puede meter para hoy.
 */
export function momentoLima(cfg: ConfigBot, ahora: Date = new Date()): MomentoLima {
  const p = partesLima(ahora);
  const fechaLarga = `${DIAS_NOMBRE[p.diaSemana - 1]} ${p.dia} de ${MESES_NOMBRE[p.mes - 1]} de ${p.anio}`;
  const hora = `${dosDigitos(p.hora)}:${dosDigitos(p.minuto)}`;
  const dentroDeAtencion =
    cfg.dias_atencion.includes(p.diaSemana) &&
    p.hora >= cfg.atencion_hora_inicio &&
    p.hora < cfg.atencion_hora_fin;

  const ventana = `entre ${cfg.reparto_hora_inicio}:00 y ${cfg.reparto_hora_fin}:00`;
  const minutosAhora = p.hora * 60 + p.minuto;
  const alcanzaHoy =
    cfg.dias_reparto_num.includes(p.diaSemana) &&
    minutosAhora <= cfg.reparto_hora_inicio * 60 - 120;

  let proximoReparto = `hoy ${ventana}`;
  if (!alcanzaHoy) {
    proximoReparto = `el próximo día de reparto ${ventana}`;
    for (let i = 1; i <= 7; i++) {
      const d = desplazar(p, i);
      if (cfg.dias_reparto_num.includes(d.diaSemana)) {
        const prefijo = i === 1 ? "mañana " : "";
        proximoReparto = `${prefijo}${DIAS_NOMBRE[d.diaSemana - 1]} ${d.dia} de ${MESES_NOMBRE[d.mes - 1]}, ${ventana}`;
        break;
      }
    }
  }

  return {
    fechaLarga,
    hora,
    horaNum: p.hora,
    diaSemana: p.diaSemana,
    dentroDeAtencion,
    proximoReparto,
  };
}

// ── Catálogo con precios (memoizado) ────────────────────────────────────

let cacheCatalogo: { datos: FilaCatalogo[]; expira: number } | null = null;

/** Invalida el memo del catálogo (lo usan los tests y el endpoint de simulación). */
export function limpiarCacheCatalogo(): void {
  cacheCatalogo = null;
}

async function cargarCatalogo(
  sql: NeonQueryFunction<false, false>,
  ttlSeg: number
): Promise<FilaCatalogo[]> {
  const ahora = Date.now();
  if (cacheCatalogo && cacheCatalogo.expira > ahora) return cacheCatalogo.datos;

  // 84 filas, 3 columnas: traer todo y matchear en JS es más robusto que un
  // WHERE nombre = ANY(...), porque los nombres del catálogo cambian seguido.
  // ORDER BY para que el match sea determinista: sin él, dos productos que
  // empiezan igual ("Osobuco con hueso" / "Osobuco sin hueso") se resolvían según
  // el orden físico de las filas, y el precio cotizado podía cambiar solo.
  const filas = (await sql`
    SELECT nombre, unidad, precio_venta
    FROM productos
    WHERE activo = TRUE
    ORDER BY nombre ASC
  `) as unknown as FilaCatalogo[];

  cacheCatalogo = { datos: filas, expira: ahora + Math.max(0, ttlSeg) * 1000 };
  return filas;
}

function unidadATexto(unidad: string | null | undefined, override?: string): string {
  if (override) return override;
  const u = (unidad ?? "").toLowerCase().trim();
  if (u === "uni") return "por unidad";
  if (u.includes("plancha")) return "por plancha";
  if (u.includes("paquete")) return "por paquete";
  // 'kg' y 'uni/kg' → el precio de lista es por kilo (la ambigüedad uni/kg es
  // intencional en el catálogo: la elige la asesora al vender).
  return "por kg";
}

/** Cruza la carta comercial con el catálogo real. PURA. */
export function construirCarta(items: ItemCarta[], catalogo: FilaCatalogo[]): PrecioCarta[] {
  const salida: PrecioCarta[] = [];
  for (const item of items) {
    const fila = buscarEnCatalogo(item, catalogo);
    const precioNum = fila?.precio_venta != null ? Number(fila.precio_venta) : null;
    const precio = precioNum != null && Number.isFinite(precioNum) && precioNum > 0 ? precioNum : null;

    // Sin match y sin bandera de "a consultar" → se omite: mejor no ofrecerlo que
    // ofrecerlo sin precio y que el bot improvise.
    if (!fila && !item.soloConsulta) continue;

    salida.push({
      comercial: item.comercial,
      uso: item.uso,
      precio,
      unidadTexto: unidadATexto(fila?.unidad, item.unidadTexto),
      categoria: item.categoria,
    });
  }
  return salida;
}

/**
 * Nombre del catálogo → nombre comercial (para el historial de compras).
 * Devuelve `null` si el producto NO está en la carta: así el prompt no termina
 * mencionando algo que el bot no puede ofrecer (por ejemplo las milanesas, que
 * están excluidas a propósito, pero que un cliente sí compró alguna vez).
 */
export function comercialDesdeCatalogo(nombre: string, items: ItemCarta[]): string | null {
  const n = normalizarTexto(nombre);
  for (const item of items) {
    for (const prefijo of item.buscar) {
      if (n.startsWith(normalizarTexto(prefijo))) return item.comercial;
    }
  }
  return null;
}

// ── Perfil del cliente ──────────────────────────────────────────────────

const PERFIL_VACIO: PerfilClienteBot = {
  esCliente: false,
  rubro: null,
  distrito: null,
  topProductos: [],
  diasDesdeUltimaCompra: null,
};

async function perfilCliente(
  sql: NeonQueryFunction<false, false>,
  telefono: string,
  empresa: EmpresaWhatsApp,
  items: ItemCarta[]
): Promise<PerfilClienteBot> {
  const tel9 = telefono.replace(/\D/g, "").slice(-9);
  if (tel9.length < 9) return { ...PERFIL_VACIO };

  try {
    // Mismo match por los últimos 9 dígitos que /api/clientes/verificar (tolera +51).
    // Scopeado por empresa: un cliente de la otra marca no se asume conocido.
    const filas = await sql`
      SELECT
        c.rubro,
        c.distrito,
        (SELECT MAX(p.created_at) FROM pedidos p WHERE p.cliente_id = c.id) AS ultima_compra,
        (SELECT ARRAY_AGG(t.producto_nombre)
           FROM (SELECT pi.producto_nombre, COUNT(*) AS n
                   FROM pedidos p
                   JOIN pedido_items pi ON pi.pedido_id = p.id
                  WHERE p.cliente_id = c.id
                  GROUP BY pi.producto_nombre
                  ORDER BY n DESC
                  LIMIT 3) t) AS top_productos
      FROM clientes c
      WHERE c.empresa = ${empresa}
        AND RIGHT(regexp_replace(COALESCE(c.whatsapp, ''), '\\D', '', 'g'), 9) = ${tel9}
        AND LENGTH(regexp_replace(COALESCE(c.whatsapp, ''), '\\D', '', 'g')) >= 6
      LIMIT 1
    `;
    const fila = filas[0];
    if (!fila) return { ...PERFIL_VACIO };

    const ultima = fila.ultima_compra ? new Date(fila.ultima_compra as string) : null;
    const dias =
      ultima && !Number.isNaN(ultima.getTime())
        ? Math.max(0, Math.floor((Date.now() - ultima.getTime()) / 86_400_000))
        : null;

    const top = Array.isArray(fila.top_productos)
      ? (fila.top_productos as string[])
          .filter((x) => typeof x === "string" && x.trim())
          .map((x) => comercialDesdeCatalogo(x, items))
          .filter((x): x is string => x !== null)
      : [];

    return {
      esCliente: true,
      rubro: (fila.rubro as string | null)?.trim() || null,
      distrito: (fila.distrito as string | null)?.trim() || null,
      topProductos: [...new Set(top)].slice(0, 3),
      diasDesdeUltimaCompra: dias,
    };
  } catch (err) {
    console.error("⚠️ [bot] No se pudo cargar el perfil del cliente:", err);
    return { ...PERFIL_VACIO };
  }
}

// ── Orquestador ─────────────────────────────────────────────────────────

/**
 * Solo se admiten letras (con tildes), apóstrofo y guion, de 2 a 24 caracteres.
 * Cualquier otra cosa se descarta.
 */
const NOMBRE_ACEPTABLE = /^[\p{L}\p{M}'’-]{2,24}$/u;

/**
 * Primer nombre, con inicial mayúscula. Es lo ÚNICO del nombre que ve el LLM.
 *
 * ⚠️ SEGURIDAD: `leads.nombre` es el nombre de perfil de WhatsApp, o sea texto
 * 100% controlado por el cliente. Sin este filtro, alguien que se ponga de nombre
 * `[HANDOFF]` conseguía que el modelo lo repitiera al saludar y **apagaba el bot
 * de su propio lead** (`pideHandoff` busca la etiqueta en el texto del modelo).
 * Por eso acá se acepta un nombre de persona y nada más.
 */
export function primerNombre(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? "").trim();
  if (!limpio) return null;
  const primero = limpio.split(/\s+/)[0];
  if (!primero || !NOMBRE_ACEPTABLE.test(primero)) return null;
  return primero.charAt(0).toUpperCase() + primero.slice(1);
}

export interface ArgsContexto {
  empresa: EmpresaWhatsApp;
  marcaNombre: string;
  telefono: string;
  lead: { nombre?: string | null; ciudad?: string | null; negocio?: string | null };
  /** Para tests y simulación. */
  ahora?: Date;
}

/**
 * Arma todo el contexto. NUNCA lanza: ante cualquier fallo devuelve el contexto
 * degradado (sin carta) y el prompt hace que el bot derive en vez de inventar.
 */
export async function construirContextoNegocio(
  sql: NeonQueryFunction<false, false>,
  args: ArgsContexto
): Promise<ContextoNegocio> {
  let config: ConfigBot;
  try {
    config = await leerConfigBot(sql);
  } catch {
    config = normalizarConfigBot(null);
  }

  const items = cartaDeMarca(args.empresa, config.incluir_carnes_rojas);

  let carta: PrecioCarta[] = [];
  try {
    const catalogo = await cargarCatalogo(sql, config.ttl_carta_seg);
    carta = construirCarta(items, catalogo);
  } catch (err) {
    console.error("⚠️ [bot] No se pudo cargar el catálogo; el bot no cotizará:", err);
  }

  const cliente = await perfilCliente(sql, args.telefono, args.empresa, items);

  return {
    empresa: args.empresa,
    marcaNombre: args.marcaNombre,
    config,
    carta,
    cartaDegradada: carta.filter((c) => c.precio != null).length === 0,
    momento: momentoLima(config, args.ahora ?? new Date()),
    lead: {
      primerNombre: primerNombre(args.lead.nombre),
      distrito: (args.lead.ciudad ?? "").trim() || null,
      rubro: (args.lead.negocio ?? "").trim() || null,
    },
    cliente,
  };
}
