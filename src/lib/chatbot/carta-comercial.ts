// src/lib/chatbot/carta-comercial.ts
//
// La CARTA que el bot puede vender: nombre comercial ↔ producto real del catálogo.
//
// Por qué existe (y por qué no le pasamos los 84 productos de la DB al bot):
//   1. Los nombres del catálogo son operativos, no comerciales: "Cuy entero precio
//      por uni.", "Huevos x paquete de 6 planchas A GRANEL (solo x paquete 11.500 KG
//      a 11.80 KG aprox)". Si el bot los repite, suena a inventario y no a vendedora.
//   2. Antonio definió una lista oficial de lo que se ofrece (documento "Antonella 2.0
//      – Verdad Única") y pidió explícitamente NO ofrecer nada fuera de ella —
//      incluida la milanesa, que sí existe en el catálogo pero no se ofrece.
//   3. Un prompt con 84 líneas de producto es ruido que degrada la respuesta.
//
// Regla de oro: lo que NO está en esta carta, el bot NO lo cotiza (ofrece consultarlo).
//
// Este módulo es PURO: no toca DB. Los precios los resuelve `contexto-negocio.ts`
// cruzando `buscar[]` contra `productos.nombre`.
import type { EmpresaWhatsApp } from "../whatsapp/config";

export type CategoriaCarta = "pollo" | "huevos" | "carnes";

export interface ItemCarta {
  /** Cómo lo nombra el bot frente al cliente. */
  comercial: string;
  /**
   * Prefijos a buscar en `productos.nombre` (normalizados, sin tildes), en orden
   * de preferencia. Se usa prefijo y no igualdad porque el catálogo agrega
   * paréntesis y aclaraciones de peso al final del nombre.
   */
  buscar: string[];
  /** Para qué sirve — alimenta la recomendación por uso ("caldo", "parrilla"). */
  uso?: string;
  /** Cómo lo llama el cliente en WhatsApp. */
  alias?: string[];
  /** Override cuando la unidad del catálogo es ambigua ("uni/kg"). */
  unidadTexto?: string;
  /** Se lista aunque no tenga precio en el catálogo (queda "a consultar"). */
  soloConsulta?: boolean;
  categoria: CategoriaCarta;
}

/** minúsculas, sin tildes, espacios colapsados. */
export function normalizarTexto(texto: string): string {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pollo, gallina y huevos: la carta que comparten las dos marcas.
 * Sale del documento oficial de Antonio, en su orden.
 */
const CARTA_AVES: ItemCarta[] = [
  {
    comercial: "Pollo entero",
    buscar: ["pollo con menudencia entero", "pollo entero con menudencia", "pollo entero"],
    uso: "el clásico: rinde para todo",
    alias: ["pollo", "pollo con menudencia", "pollo fresco"],
    categoria: "pollo",
  },
  {
    comercial: "Pollo entero sin menudencia",
    buscar: ["pollo entero sin menudencia"],
    alias: ["pollo sin menudencia", "pollo limpio"],
    categoria: "pollo",
  },
  {
    comercial: "Pechuga especial (con hueso)",
    buscar: ["pechuga especial"],
    uso: "rinde y es versátil",
    alias: ["pechuga con hueso", "pechuga"],
    categoria: "pollo",
  },
  {
    comercial: "Pechuga deshuesada (filete de pechuga)",
    buscar: ["pechuga deshuesada"],
    uso: "preparaciones variadas, salteados, apanados",
    alias: ["filete de pechuga", "filete", "pechuga sin hueso", "pechuga deshuesada"],
    categoria: "pollo",
  },
  {
    comercial: "Pierna especial (pierna con encuentro)",
    buscar: ["pierna especial"],
    uso: "parrilla, plancha y guisos",
    alias: ["pierna con encuentro", "pierna entera"],
    categoria: "pollo",
  },
  {
    comercial: "Pierna sola",
    buscar: ["piernas solas", "pierna sola"],
    uso: "guisos",
    alias: ["piernas"],
    categoria: "pollo",
  },
  {
    comercial: "Encuentro (muslo)",
    buscar: ["encuentro"],
    uso: "guisos y horno",
    alias: ["muslo", "muslos"],
    categoria: "pollo",
  },
  {
    comercial: "Pierna deshuesada (filete de pierna)",
    buscar: ["filetes de pierna", "pierna deshuesada"],
    uso: "salteados y brochetas",
    alias: ["filete de pierna", "pierna sin hueso"],
    categoria: "pollo",
  },
  {
    comercial: "Alitas",
    buscar: ["alas", "alitas"],
    uso: "parrilla y plancha: salen jugosas",
    alias: ["alita", "ala"],
    categoria: "pollo",
  },
  // ⚠️ Las gallinas y el pato se venden ENTEROS pero se cobran POR KILO (el seed
  // lo dice explícito: "venta entera (peso aprox. 3.600 a 4.200 kg)" a S/ 14). En
  // el catálogo algunas filas tienen `unidad = 'uni'`, y sin este override el bot
  // cotizaba "S/ 17.90 por unidad" una gallina de 4 kg: casi 4 veces menos.
  {
    comercial: "Gallina doble",
    buscar: ["gallina doble"],
    uso: "caldo y sopa: da más sabor y fuerza",
    alias: ["gallina doble pecho"],
    unidadTexto: "por kg",
    categoria: "pollo",
  },
  {
    comercial: "Gallina colorada",
    buscar: ["gallina colorada", "gallina roja"],
    uso: "caldo y sopa",
    alias: ["gallina roja", "gallina"],
    unidadTexto: "por kg",
    categoria: "pollo",
  },
  {
    comercial: "Menudencia",
    buscar: ["menudencia"],
    uso: "caldos y sopas",
    alias: ["menudencias"],
    categoria: "pollo",
  },
  {
    comercial: "Pato entero",
    buscar: ["pato entero"],
    alias: ["pato"],
    unidadTexto: "por kg",
    categoria: "pollo",
  },
  {
    comercial: "Cuy entero",
    buscar: ["cuy entero"],
    unidadTexto: "por unidad",
    alias: ["cuy"],
    categoria: "pollo",
  },
  {
    comercial: "Cabrito fresco",
    buscar: ["cabrito"],
    // Antonio lo lista como "(según stock)". Si no está en el catálogo, se ofrece
    // igual pero SIN precio: el bot dice que lo consulta.
    soloConsulta: true,
    alias: ["cabrito"],
    categoria: "pollo",
  },
  {
    comercial: "Huevos de corral (docena)",
    buscar: ["huevos de corral"],
    unidadTexto: "por docena",
    alias: ["huevos de corral", "huevo de corral"],
    categoria: "huevos",
  },
  {
    comercial: "Huevos La Calera (plancha de 30)",
    buscar: ["huevos la calera plancha", "huevos la calera"],
    unidadTexto: "por plancha",
    alias: ["huevos la calera", "plancha de huevos", "huevos"],
    categoria: "huevos",
  },
  {
    comercial: "Huevos por paquete (6 planchas)",
    buscar: ["huevos x paquete"],
    unidadTexto: "por paquete",
    uso: "para negocios que consumen volumen",
    alias: ["paquete de huevos", "huevos al por mayor"],
    categoria: "huevos",
  },
];

/**
 * Res y cerdo. Ambas marcas los tienen en el catálogo y sus perfiles comerciales
 * los mencionan, pero el documento oficial de Antonella no los lista: por eso van
 * detrás de un switch (`ConfigBot.incluir_carnes_rojas`, encendido por defecto).
 */
const CARTA_CARNES: ItemCarta[] = [
  { comercial: "Bistec de res", buscar: ["bistec de res"], uso: "plancha", alias: ["bistec"], categoria: "carnes" },
  { comercial: "Lomo fino", buscar: ["lomo fino"], alias: ["lomo"], categoria: "carnes" },
  { comercial: "Carne de guiso de res (sin hueso)", buscar: ["carne guiso de res"], uso: "guisos y estofados", alias: ["carne de guiso", "guiso de res"], categoria: "carnes" },
  { comercial: "Carne molida de res especial", buscar: ["carne molida de res"], alias: ["carne molida", "molida"], categoria: "carnes" },
  { comercial: "Costillar", buscar: ["costillar"], uso: "horno y parrilla", alias: ["costilla"], categoria: "carnes" },
  { comercial: "Churrasco", buscar: ["churrasco"], uso: "parrilla", categoria: "carnes" },
  // Dos ítems distintos a propósito: son dos precios (con hueso sale bastante más
  // barato). Con uno solo, el bot cotizaba SIEMPRE el caro.
  { comercial: "Osobuco con hueso", buscar: ["osobuco con hueso"], uso: "caldos y estofados", alias: ["osobuco"], categoria: "carnes" },
  { comercial: "Osobuco sin hueso", buscar: ["osobuco sin hueso"], uso: "caldos y estofados", categoria: "carnes" },
  { comercial: "Cerdo en corte de guiso", buscar: ["cerdo en corte de guiso"], alias: ["cerdo para guiso"], categoria: "carnes" },
  { comercial: "Chuleta de cerdo", buscar: ["chuleta de cerdo"], uso: "plancha y parrilla", alias: ["chuleta"], categoria: "carnes" },
  { comercial: "Panceta", buscar: ["panceta"], alias: ["tocino"], categoria: "carnes" },
];

/**
 * ⚠️ Productos que existen en el catálogo y NO van en la carta a propósito:
 * milanesas (Antonio pidió explícitamente no ofrecerlas), magret de pato, pavita,
 * piernitas bouchet, hueso manzano, huachalomo, hígado, mondonguito, corazón para
 * anticucho. Si alguna vez se quieren ofrecer, se agregan acá — no en el prompt.
 */
export function cartaDeMarca(
  _empresa: EmpresaWhatsApp,
  incluirCarnesRojas: boolean
): ItemCarta[] {
  // Hoy las dos marcas comparten catálogo y precios (`productos` no tiene columna
  // `empresa`), así que la carta es la misma. El parámetro queda para el día en que
  // una marca deje de ofrecer algo.
  return incluirCarnesRojas ? [...CARTA_AVES, ...CARTA_CARNES] : [...CARTA_AVES];
}

/**
 * ¿El texto del cliente menciona un producto de la carta?
 * Match por nombre comercial o alias, con el más largo primero para que
 * "pechuga deshuesada" gane sobre "pechuga".
 */
export function matchItemCarta(texto: string, items: ItemCarta[]): ItemCarta | null {
  const t = normalizarTexto(texto);
  if (!t) return null;

  let mejor: { item: ItemCarta; largo: number } | null = null;
  for (const item of items) {
    const candidatos = [item.comercial, ...(item.alias ?? [])].map(normalizarTexto);
    for (const c of candidatos) {
      if (c && t.includes(c) && (!mejor || c.length > mejor.largo)) {
        mejor = { item, largo: c.length };
      }
    }
  }
  return mejor?.item ?? null;
}

/**
 * ¿Qué fila del catálogo corresponde a este ítem de la carta?
 * Prefijo normalizado, respetando el orden de `buscar` (el primero que exista gana).
 */
export function buscarEnCatalogo<T extends { nombre: string }>(
  item: ItemCarta,
  catalogo: T[]
): T | null {
  for (const prefijo of item.buscar) {
    const p = normalizarTexto(prefijo);
    const exacto = catalogo.find((f) => normalizarTexto(f.nombre) === p);
    if (exacto) return exacto;
    const porPrefijo = catalogo.find((f) => normalizarTexto(f.nombre).startsWith(p));
    if (porPrefijo) return porPrefijo;
  }
  return null;
}
