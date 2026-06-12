// src/lib/clientes-duplicados.ts
// Regla anti-duplicados de clientes — COMPARTIDA por POST /api/clientes y
// PATCH /api/clientes/[id] (el PATCH era un bypass total: se podía editar un
// cliente propio y ponerle el RUC/WhatsApp de un cliente ajeno sin chequeo).
//
// Reglas (decisión Antonio/Hugo, 11 jun 2026):
//   · match EXACTO por RUC/DNI (TRIM) o WhatsApp (últimos 9 dígitos);
//   · asesora + cliente de OTRA (o sin asesora) → 409 DURO, sin override
//     (la vía legítima es pedir la transferencia a un admin);
//   · asesora + cliente PROPIO → 409 blando (override con permitir_duplicado,
//     caso real: cadena con varias sucursales);
//   · admin → 409 blando SIEMPRE (puede_forzar) — puede crear el duplicado,
//     pero el sistema le pregunta; nunca pasa en silencio.
//   · si matchean un cliente propio Y uno ajeno a la vez, GANA EL AJENO
//     (ORDER BY en SQL) — así el 409 duro no se puede esquivar confirmando
//     el blando del propio.
import type { NeonQueryFunction } from "@neondatabase/serverless";

export interface ChequeoDuplicadoOpts {
  /** RUC/DNI a verificar; null/vacío = no verificar este campo. */
  rucDni: string | null;
  /** WhatsApp a verificar; null/vacío = no verificar este campo. */
  whatsapp: string | null;
  userId: string;
  role: string;
  permitirDuplicado: boolean;
  /** En PATCH: id del cliente que se edita (se excluye del match). */
  excluirClienteId?: string | null;
}

export interface CuerpoConflicto {
  error: "cliente_duplicado";
  campo: "ruc_dni" | "whatsapp";
  mensaje: string;
  asesora_nombre?: string | null;
  es_mio?: boolean;
  puede_forzar?: boolean;
  cliente_id?: string;
}

/**
 * Devuelve el cuerpo del 409 si el alta/edición choca con un cliente existente,
 * o null si puede proceder.
 */
export async function chequearDuplicadoCliente(
  sql: NeonQueryFunction<false, false>,
  opts: ChequeoDuplicadoOpts
): Promise<CuerpoConflicto | null> {
  const rucNorm = (opts.rucDni ?? "").trim();
  const waNorm = (opts.whatsapp ?? "").replace(/\D/g, "").slice(-9);
  const waValido = waNorm.length === 9;
  if (!rucNorm && !waValido) return null;

  const excluir = opts.excluirClienteId ?? null;
  const dups = (await sql`
    SELECT c.id, c.asesor_id, u.name AS asesor_name,
           CASE WHEN ${rucNorm} <> '' AND TRIM(COALESCE(c.ruc_dni,'')) = ${rucNorm} THEN 'ruc_dni' ELSE 'whatsapp' END AS campo
    FROM clientes c LEFT JOIN users u ON u.id = c.asesor_id
    WHERE ((${rucNorm} <> '' AND TRIM(COALESCE(c.ruc_dni,'')) = ${rucNorm})
        OR (${waValido} AND RIGHT(regexp_replace(COALESCE(c.whatsapp,''), '\\D', '', 'g'), 9) = ${waNorm}))
      AND (${excluir}::uuid IS NULL OR c.id <> ${excluir}::uuid)
    ORDER BY (c.asesor_id IS DISTINCT FROM ${opts.userId}::uuid) DESC
    LIMIT 1
  `) as Array<{ id: string; asesor_id: string | null; asesor_name: string | null; campo: "ruc_dni" | "whatsapp" }>;

  if (dups.length === 0) return null;
  const dup = dups[0];
  const asesoraNombre = dup.asesor_name?.trim() || null;
  const campoLegible = dup.campo === "whatsapp" ? "celular" : "RUC/DNI";

  if (opts.role === "admin") {
    if (opts.permitirDuplicado) return null;
    return {
      error: "cliente_duplicado",
      campo: dup.campo,
      puede_forzar: true,
      asesora_nombre: asesoraNombre,
      mensaje: `Este cliente ya está registrado${asesoraNombre ? ` con la ejecutiva ${asesoraNombre}` : ""} (mismo ${campoLegible}). Si continúas se creará un DUPLICADO.`,
    };
  }

  const esMio = dup.asesor_id === opts.userId;
  if (!esMio) {
    // Duro: sin override, aunque venga permitir_duplicado.
    return {
      error: "cliente_duplicado",
      campo: dup.campo,
      asesora_nombre: asesoraNombre || "otra asesora",
      mensaje: `Este cliente ya está registrado y tiene una ejecutiva asignada (${asesoraNombre || "otra asesora"}). Si crees que debería ser tuyo, pide la transferencia a un administrador.`,
    };
  }
  if (opts.permitirDuplicado) return null;
  return {
    error: "cliente_duplicado",
    campo: dup.campo,
    es_mio: true,
    cliente_id: dup.id,
    mensaje: "Ya tienes un cliente registrado con este documento/celular. Puedes usar ese registro, o confirmar que quieres crear otro (ej. otra sucursal).",
  };
}
