// src/lib/sunat/ubigeos.ts
// ============================================================
// Catálogo de Ubigeos oficiales del INEI (Lima y Callao)
// ============================================================

export const UBIGEO_MAP: Record<string, string> = {
  // --- Provincia de Lima (1501xx) ---
  "lima": "150101",
  "cercado de lima": "150101",
  "ancon": "150102",
  "ancón": "150102",
  "ate": "150103",
  "ate vitarte": "150103",
  "barranco": "150104",
  "breña": "150105",
  "carabayllo": "150106",
  "chaclacayo": "150107",
  "chorrillos": "150108",
  "cieneguilla": "150109",
  "comas": "150110",
  "el agustino": "150111",
  "independencia": "150112",
  "jesus maria": "150113",
  "jesús maría": "150113",
  "la molina": "150114",
  "la victoria": "150115",
  "lince": "150116",
  "los olivos": "150117",
  "lurigancho": "150118",
  "chosica": "150118",
  "lurin": "150119",
  "lurín": "150119",
  "magdalena": "150120",
  "magdalena del mar": "150120",
  "pueblo libre": "150121",
  "miraflores": "150122",
  "pachacamac": "150123",
  "pachacámac": "150123",
  "pucusana": "150124",
  "puente piedra": "150125",
  "punta hermosa": "150126",
  "punta negra": "150127",
  "rimac": "150128",
  "rímac": "150128",
  "san bartolo": "150129",
  "san borja": "150130",
  "san isidro": "150131",
  "san juan de lurigancho": "150132",
  "sjl": "150132",
  "san juan de miraflores": "150133",
  "sjm": "150133",
  "san luis": "150134",
  "san martin de porres": "150135",
  "san martín de porres": "150135",
  "smp": "150135",
  "san miguel": "150136",
  "santa anita": "150137",
  "santa maria del mar": "150138",
  "santa maría del mar": "150138",
  "santa rosa": "150139",
  "santiago de surco": "150140",
  "surco": "150140",
  "surquillo": "150141",
  "villa el salvador": "150142",
  "ves": "150142",
  "villa maria del triunfo": "150143",
  "villa maría del triunfo": "150143",
  "vmt": "150143",

  // --- Provincia de Callao (0701xx) ---
  "callao": "070101",
  "provincia constitucional del callao": "070101",
  "bellavista": "070102",
  "carmen de la legua": "070103",
  "carmen de la legua reynoso": "070103",
  "la perla": "070104",
  "la punta": "070105",
  "ventanilla": "070106",
  "mi peru": "070107",
  "mi perú": "070107",
};

/**
 * Normaliza y busca el ubigeo de un distrito de Lima/Callao.
 * Retorna '150101' (Lima Cercado) como fallback si no se encuentra match.
 */
export function obtenerUbigeoDistrito(distrito: string | null | undefined): string {
  if (!distrito) return "150101";
  
  // Normalizar: minúsculas, sin espacios extras ni acentos en la clave base
  const clean = distrito
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // remueve diacríticos
    
  // Intentar match directo en el mapa
  const match = UBIGEO_MAP[clean];
  if (match) return match;

  // Si no coincide, buscar si alguna clave está contenida o contiene la búsqueda
  for (const [key, val] of Object.entries(UBIGEO_MAP)) {
    if (clean.includes(key) || key.includes(clean)) {
      return val;
    }
  }

  // Fallback por defecto a Lima Cercado
  return "150101";
}

/**
 * Busca el nombre legible de un distrito en base a su ubigeo.
 * Retorna 'LIMA' como fallback.
 */
export function obtenerDistritoPorUbigeo(ubigeo: string | null | undefined): string {
  if (!ubigeo) return "LIMA";
  
  // Buscar match exacto en UBIGEO_MAP
  for (const [dist, code] of Object.entries(UBIGEO_MAP)) {
    if (code === ubigeo) {
      // Retornar en mayúsculas y formateado
      return dist.toUpperCase();
    }
  }
  return "LIMA";
}

