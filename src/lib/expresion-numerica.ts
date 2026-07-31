// src/lib/expresion-numerica.ts
// Evalúa expresiones aritméticas simples tecleadas por el usuario, tipo Excel:
//   "62+62.2+62.5+61.75"  →  248.45   (pesadas de una carga, una por una)
//   "70+15+55*7+15"       →  485      (jabas × aves por jaba, así cuenta las aves)
//
// Por qué existe: en el Excel de Marianela el 23% de las celdas de peso son sumas
// de varias pesadas — en "CORTE" pasa 29 de 32 días, con hasta 11 pesadas. Un input
// que solo acepte un número la obligaría a sumar en calculadora todos los días.
//
// ⚠️ NUNCA usar eval() ni new Function(): esto es entrada de usuario. El parser es
// propio y solo entiende números y + − * /.
//
// ⚠️ La PRECEDENCIA importa: su "70+15+55*7+15" da 485 (los machos reales de esa
// hoja). Evaluado de izquierda a derecha daría 3010. Primero * y /, después + y −.

export interface ResultadoExpresion {
  valor: number;
  valida: boolean;
}

/** Vacío ⇒ 0 válido (una celda en blanco no es un error). */
const VACIO: ResultadoExpresion = { valor: 0, valida: true };
const INVALIDA: ResultadoExpresion = { valor: 0, valida: false };

type Token = number | "+" | "-" | "*" | "/";

/**
 * Parte el texto en números y operadores. Devuelve null si aparece cualquier
 * carácter que no sea dígito, punto, espacio o un operador.
 */
function tokenizar(texto: string): Token[] | null {
  const tokens: Token[] = [];
  let numero = "";
  // true cuando el último token emitido es un número y todavía no vino un operador.
  // Sirve para dos cosas: rechazar dos números pegados ("62 2") y aceptar espacios
  // alrededor de los operadores ("62 + 62.2").
  let numeroCerrado = false;

  const cerrarNumero = (): boolean => {
    if (numero === "") return true; // nada que cerrar
    const n = Number(numero);
    if (!Number.isFinite(n)) return false; // "." suelto
    tokens.push(n);
    numero = "";
    numeroCerrado = true;
    return true;
  };

  for (const ch of texto) {
    const esDigito = ch >= "0" && ch <= "9";
    const esPunto = ch === "." || ch === ",";

    if (esDigito || esPunto) {
      // Dos números sin operador en medio ("62 2") es un descuido, no una suma.
      if (numeroCerrado) return null;
      if (esPunto) {
        if (numero.includes(".")) return null; // "1.2.3"
        numero += ".";
      } else {
        numero += ch;
      }
    } else if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      if (!cerrarNumero()) return null;
      if (!numeroCerrado) return null; // operador sin número delante ("+5", "2++3")
      tokens.push(ch);
      numeroCerrado = false;
    } else if (ch === " " || ch === "\t") {
      if (!cerrarNumero()) return null;
    } else {
      return null; // letras, paréntesis, símbolos: fuera
    }
  }

  if (!cerrarNumero()) return null;
  if (!numeroCerrado) return null; // vacío o termina en operador ("62+")

  return tokens;
}

/**
 * Evalúa una expresión aritmética simple respetando la precedencia de * y /.
 *
 * Acepta: dígitos, punto o coma decimal, espacios y los operadores + − * /.
 * No acepta paréntesis ni signo negativo inicial (no hacen falta aquí, y dejarlos
 * fuera mantiene el parser trivial de auditar).
 */
export function evaluarExpresion(texto: string | null | undefined): ResultadoExpresion {
  const limpio = (texto ?? "").trim();
  if (limpio === "") return VACIO;

  const tokens = tokenizar(limpio);
  if (!tokens || tokens.length === 0) return INVALIDA;

  // Primera pasada: resolver * y / dejando una lista de sumandos.
  const sumandos: number[] = [];
  const signos: Array<"+" | "-"> = [];
  let acumulado: number | null = null;
  let pendiente: "*" | "/" | null = null;

  for (const token of tokens) {
    if (typeof token === "number") {
      if (pendiente === null) {
        acumulado = token;
      } else if (pendiente === "*") {
        acumulado = (acumulado ?? 0) * token;
        pendiente = null;
      } else {
        if (token === 0) return INVALIDA; // división por cero
        acumulado = (acumulado ?? 0) / token;
        pendiente = null;
      }
    } else if (token === "*" || token === "/") {
      if (acumulado === null) return INVALIDA;
      pendiente = token;
    } else {
      // + o −: se cierra el término actual
      if (acumulado === null || pendiente !== null) return INVALIDA;
      sumandos.push(acumulado);
      signos.push(token);
      acumulado = null;
    }
  }

  if (acumulado === null || pendiente !== null) return INVALIDA;
  sumandos.push(acumulado);

  // Segunda pasada: + y −.
  let total = sumandos[0];
  for (let i = 0; i < signos.length; i++) {
    total = signos[i] === "+" ? total + sumandos[i + 1] : total - sumandos[i + 1];
  }

  if (!Number.isFinite(total)) return INVALIDA;

  // 2 decimales: son kilos y aves, no hace falta más, y evita colas de coma flotante.
  return { valor: Math.round((total + Number.EPSILON) * 100) / 100, valida: true };
}

/** Atajo para pintar: el valor si es válida, 0 si no. */
export function valorDeExpresion(texto: string | null | undefined): number {
  const r = evaluarExpresion(texto);
  return r.valida ? r.valor : 0;
}

/** true si el texto tiene más de un término (sirve para mostrar el desglose). */
export function tieneDesglose(texto: string | null | undefined): boolean {
  const limpio = (texto ?? "").trim();
  return /[+\-*/]/.test(limpio);
}
