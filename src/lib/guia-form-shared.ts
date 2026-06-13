// src/lib/guia-form-shared.ts
// FUENTE ÚNICA de reglas, constantes y helpers compartidos por los DOS modales de
// emisión de Guía de Remisión Electrónica:
//   - emitir-guia-modal.tsx          (desde un pedido/comprobante)
//   - emitir-guia-directa-modal.tsx  (GRE directa/standalone)
// Regla de mantenimiento: cualquier cambio a las reglas del chofer/M1L, distritos o
// consultas compartidas se hace AQUÍ, nunca en un solo modal (estuvieron duplicadas
// y se desincronizaron — ver gotcha #28 del CLAUDE.md).

export interface MotorizadoUser {
  id: string;
  name: string;
  role: string;
  chofer_dni?: string | null;
  chofer_licencia?: string | null;
  vehiculo_placa?: string | null;
  chofer_nombres?: string | null;
  chofer_apellidos?: string | null;
}

export const DISTRITOS_LIMA = [
  "Ate", "Ancón", "Barranco", "Breña", "Carabayllo", "Cercado de Lima", "Chaclacayo", "Chorrillos", "Cieneguilla", "Comas",
  "El Agustino", "Independencia", "Jesús María", "La Molina", "La Victoria", "Lince", "Los Olivos",
  "Lurigancho", "Lurín", "Magdalena del Mar", "Miraflores", "Pachacámac", "Pucusana", "Pueblo Libre", "Puente Piedra",
  "Punta Hermosa", "Punta Negra", "Rímac", "San Bartolo", "San Borja", "San Isidro", "San Juan de Lurigancho",
  "San Juan de Miraflores", "San Luis", "San Martín de Porres", "San Miguel", "Santa Anita", "Santa María del Mar",
  "Santa Rosa", "Santiago de Surco", "Surquillo", "Villa El Salvador", "Villa María del Triunfo",
  "Callao", "Bellavista", "Carmen de la Legua", "La Perla", "La Punta", "Ventanilla", "Mi Perú"
].sort();

/** Heurística para separar un nombre completo en nombres y apellidos (cbc:FirstName/FamilyName). */
export function dividirNombreLocal(fullName: string): { nombres: string; apellidos: string } {
  const limpio = (fullName || "").trim().replace(/\s+/g, " ");
  if (!limpio) return { nombres: "", apellidos: "" };
  const palabras = limpio.split(" ");
  const n = palabras.length;
  if (n <= 1) return { nombres: limpio, apellidos: "-" };
  if (n === 2) return { nombres: palabras[0], apellidos: palabras[1] };
  if (n === 3) return { nombres: palabras[0], apellidos: `${palabras[1]} ${palabras[2]}` };
  return { nombres: `${palabras[0]} ${palabras[1]}`, apellidos: palabras.slice(2).join(" ") };
}

/** Datos de chofer pre-llenados al elegir un motorizado registrado. */
export function datosChoferDesdeMotorizado(rep: MotorizadoUser | undefined | null): {
  dni: string; licencia: string; placa: string; nombres: string; apellidos: string;
} {
  if (!rep) return { dni: "", licencia: "", placa: "", nombres: "", apellidos: "" };
  const { nombres, apellidos } = dividirNombreLocal(rep.name || "");
  return {
    dni: rep.chofer_dni || "",
    licencia: rep.chofer_licencia || "",
    placa: rep.vehiculo_placa || "",
    nombres: rep.chofer_nombres || nombres,
    apellidos: rep.chofer_apellidos || apellidos,
  };
}

/**
 * LA regla de negocio del chofer (la misma que valida el backend api/guias/emitir):
 * - Con vehículo categoría M1/L (moto/auto ligero) SUNAT permite OMITIR placa y TODOS los
 *   datos del conductor → todo opcional.
 * - Sin M1/L: DNI (8 dígitos), licencia, nombres, apellidos y placa son obligatorios.
 */
export function validarChofer(d: {
  indicadorM1L: boolean;
  dni: string;
  licencia: string;
  nombres: string;
  apellidos: string;
  placa: string;
}): { ok: boolean; faltantes: string[] } {
  if (d.indicadorM1L) return { ok: true, faltantes: [] };
  const faltantes: string[] = [];
  if (d.dni.trim().length !== 8) faltantes.push("DNI del chofer (8 dígitos)");
  if (d.licencia.trim().length < 5) faltantes.push("Licencia de conducir");
  if (!d.nombres.trim()) faltantes.push("Nombres del chofer");
  if (!d.apellidos.trim()) faltantes.push("Apellidos del chofer");
  if (d.placa.trim().length < 6) faltantes.push("Placa del vehículo");
  return { ok: faltantes.length === 0, faltantes };
}

/** Resultado de la consulta RENIEC/SUNAT (apisperu) para autocompletar el destinatario. */
export interface ResultadoConsultaDoc {
  ok: boolean;
  nombre: string;      // razón social (RUC) o nombre completo (DNI)
  direccion: string | null;
  distrito: string | null; // solo RUC (el DNI no trae dirección); viene en MAYÚSCULAS de apisperu
  mensaje: string | null; // mensaje de error amigable si !ok
}

/** Consulta un DNI(8)/RUC(11) en apisperu vía /api/consulta-documento. */
export async function consultarDocumento(numero: string): Promise<ResultadoConsultaDoc> {
  if (!/^\d{8}$|^\d{11}$/.test(numero)) {
    return { ok: false, nombre: "", direccion: null, distrito: null, mensaje: "Documento inválido" };
  }
  try {
    const res = await fetch("/api/consulta-documento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: numero.length === 11 ? "ruc" : "dni", numero }),
    });
    const j = await res.json();
    if (res.ok && j.ok) {
      return {
        ok: true,
        nombre: j.razonSocial || j.nombreCompleto || "",
        direccion: j.direccion || null,
        distrito: j.distrito || null,
        mensaje: null,
      };
    }
    return { ok: false, nombre: "", direccion: null, distrito: null, mensaje: j.mensaje || j.error || "No se encontró el documento." };
  } catch {
    return { ok: false, nombre: "", direccion: null, distrito: null, mensaje: "No se pudo consultar. Escribe los datos a mano." };
  }
}

function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

/**
 * Empareja el distrito que devuelve apisperu (MAYÚSCULAS y a veces sin tildes,
 * ej. "SAN MARTIN DE PORRES") con el valor EXACTO del <select> de DISTRITOS_LIMA
 * ("San Martín de Porres"). Devuelve null si no es de Lima/Callao o no matchea —
 * en ese caso el select se deja como está y el usuario elige a mano.
 */
export function matchDistritoLima(distritoApi: string | null | undefined): string | null {
  if (!distritoApi) return null;
  const buscado = normalizarTexto(distritoApi);
  if (!buscado) return null;
  // apisperu/SUNAT llaman "LIMA" al Cercado (ubigeo 150101)
  if (buscado === "lima") return "Cercado de Lima";
  // Coloquialismos comunes en pedidos/fichas ("Surco" = Santiago de Surco)
  if (buscado === "surco") return "Santiago de Surco";
  if (buscado === "sjl") return "San Juan de Lurigancho";
  if (buscado === "smp") return "San Martín de Porres";
  return DISTRITOS_LIMA.find((d) => normalizarTexto(d) === buscado) ?? null;
}

/**
 * Detecta el distrito DENTRO del texto de una dirección (ej. "Av. X 123 - San Borja",
 * "... URB. MELGAREJO LA MOLINA"). Solo devuelve un distrito si la coincidencia es
 * INEQUÍVOCA: exactamente un distrito de DISTRITOS_LIMA aparece como palabra completa.
 * Si hay cero o varias coincidencias (o solo zonas como "Salamanca" que no son
 * distrito), devuelve null y el usuario elige a mano.
 * Nota: si un nombre contiene a otro ("San Juan de Lurigancho" ⊃ "Lurigancho"),
 * cuenta solo el MÁS LARGO presente.
 */
export function detectarDistritoEnDireccion(direccion: string | null | undefined): string | null {
  if (!direccion) return null;
  // normalizarTexto (NFD) también convierte ñ→n, así que el texto queda en [a-z0-9 + signos]
  let texto = ` ${normalizarTexto(direccion)} `;
  if (texto.trim().length < 3) return null;
  // Más largos primero para que "San Juan de Lurigancho" gane sobre "Lurigancho"
  const ordenados = [...DISTRITOS_LIMA].sort((a, b) => b.length - a.length);
  const hallados: string[] = [];
  for (const d of ordenados) {
    const dNorm = normalizarTexto(d);
    const re = new RegExp(`(^|[^a-z0-9])${dNorm}($|[^a-z0-9])`, "g");
    if (re.test(texto)) {
      hallados.push(d);
      // Borrar la ocurrencia para que un nombre contenido no se cuente dos veces
      texto = texto.replace(re, "$1·$2");
    }
  }
  return hallados.length === 1 ? hallados[0] : null;
}

/**
 * Decide qué autollenar en el punto de llegada tras una consulta RUC exitosa.
 * Dos modos:
 *  - forzar=true  → el USUARIO tipeó el documento (acción explícita de redefinir
 *    el destinatario): la dirección fiscal REEMPLAZA lo que haya, y el distrito
 *    se actualiza (o se LIMPIA si el RUC nuevo no trae distrito reconocible y lo
 *    visible era un autollenado del RUC anterior — nunca dejar un distrito ajeno).
 *  - forzar=false → consulta automática (al abrir el modal, o al elegir un cliente
 *    frecuente): solo llena campos VACÍOS o que puso el propio autollenado; nunca
 *    pisa lo escrito a mano ni la dirección de ENTREGA del pedido/ficha.
 * `distrito: ""` significa "limpiar el select"; `undefined` = no tocar.
 */
export function decidirAutollenadoDestino(p: {
  forzar: boolean;
  direccionApi: string | null;
  distritoApi: string | null;
  direccionActual: string;
  distritoActual: string;
  dirAutollenada: string | null;
  distAutollenado: string | null;
}): { direccion?: string; distrito?: string } {
  const out: { direccion?: string; distrito?: string } = {};
  let direccionReemplazada = false;
  if (p.direccionApi) {
    if (p.forzar || !p.direccionActual.trim() || p.direccionActual === p.dirAutollenada) {
      out.direccion = p.direccionApi;
      direccionReemplazada = true;
    }
  }
  const nuevoDist = matchDistritoLima(p.distritoApi) ?? detectarDistritoEnDireccion(p.direccionApi);
  if (nuevoDist) {
    if (p.forzar || !p.distritoActual.trim() || p.distritoActual === p.distAutollenado) {
      out.distrito = nuevoDist;
    }
  } else if (p.forzar && p.distritoActual.trim()) {
    // No hay distrito reconocible para el RUC nuevo. Si REEMPLAZAMOS la dirección,
    // el distrito viejo corresponde a OTRA dirección → se limpia SIEMPRE (la
    // asesora lo elige): nunca dejar un par dirección/distrito incoherente.
    // Si la dirección NO cambió, solo se limpia si era un autollenado nuestro.
    if (direccionReemplazada || p.distritoActual === p.distAutollenado) {
      out.distrito = "";
    }
  }
  return out;
}

/** Entorno SUNAT real (beta | production) para el banner del modal. null = no se pudo cargar. */
export async function fetchEntornoSunat(): Promise<boolean | null> {
  try {
    const res = await fetch("/api/sunat/entorno");
    if (!res.ok) return null;
    const j = await res.json();
    return !!j.esProduccion;
  } catch {
    return null;
  }
}
