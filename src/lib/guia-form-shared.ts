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
  "Ate", "Ancón", "Barranco", "Breña", "Carabayllo", "Chaclacayo", "Chorrillos", "Cieneguilla", "Comas",
  "El Agustino", "Independencia", "Jesús María", "La Molina", "La Victoria", "Lince", "Los Olivos",
  "Lurigancho", "Lurín", "Magdalena del Mar", "Miraflores", "Pachacámac", "Pucusana", "Puente Piedra",
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
  mensaje: string | null; // mensaje de error amigable si !ok
}

/** Consulta un DNI(8)/RUC(11) en apisperu vía /api/consulta-documento. */
export async function consultarDocumento(numero: string): Promise<ResultadoConsultaDoc> {
  if (!/^\d{8}$|^\d{11}$/.test(numero)) {
    return { ok: false, nombre: "", direccion: null, mensaje: "Documento inválido" };
  }
  try {
    const res = await fetch("/api/consulta-documento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: numero.length === 11 ? "ruc" : "dni", numero }),
    });
    const j = await res.json();
    if (res.ok && j.ok) {
      return { ok: true, nombre: j.razonSocial || j.nombreCompleto || "", direccion: j.direccion || null, mensaje: null };
    }
    return { ok: false, nombre: "", direccion: null, mensaje: j.mensaje || j.error || "No se encontró el documento." };
  } catch {
    return { ok: false, nombre: "", direccion: null, mensaje: "No se pudo consultar. Escribe los datos a mano." };
  }
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
