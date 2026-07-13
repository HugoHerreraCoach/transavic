// src/lib/planta/saldos.ts
// Aritmética de la cobranza de planta (operación 3). Saldo calculado AL VUELO:
//   saldo por deuda   = monto − Σ abonos (NOT anulado)
//   saldo por cliente = Σ (monto − Σ abonos) de sus cobranzas NO anuladas
// Aislado de `facturas` de ejecutivas: al no leer/escribir ahí, la deuda de
// planta no aparece en las cobranzas ni reportes de ejecutivas, y viceversa.
// ⚠️ Neon devuelve NUMERIC como string → todo monto se castea ::float8.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type {
  ClientePlantaConSaldo,
  CobranzaPlanta,
  AbonoPlanta,
  EstadoCobranzaPlanta,
} from "@/lib/planta/types";

type Sql = NeonQueryFunction<false, false>;

export const UMBRAL_DEUDA_PLANTA = 0.01;

/** Lista de clientes de planta con su deuda total. Filtros en el caller. */
export async function listaClientesPlantaConSaldo(
  sql: Sql
): Promise<ClientePlantaConSaldo[]> {
  const rows = (await sql`
    SELECT
      c.id, c.nombre, c.razon_social, c.ruc_dni, c.telefono, c.direccion,
      c.plazo_pago_dias, c.activo, c.empresa,
      c.created_at::text AS created_at,
      c.updated_at::text AS updated_at,
      COALESCE(d.total_deuda, 0)::float8 AS total_deuda,
      COALESCE(d.total_abonado, 0)::float8 AS total_abonado,
      (COALESCE(d.total_deuda, 0) - COALESCE(d.total_abonado, 0))::float8 AS saldo_actual,
      d.ultima_compra::text AS ultima_compra,
      d.ultimo_pago::text AS ultimo_pago
    FROM clientes_planta c
    LEFT JOIN (
      SELECT
        co.cliente_planta_id,
        SUM(co.monto) AS total_deuda,
        MAX(co.fecha_emision) AS ultima_compra,
        COALESCE((
          SELECT SUM(a.monto)
          FROM abonos_planta a
          JOIN cobranzas_planta c2 ON c2.id = a.cobranza_id
          WHERE c2.cliente_planta_id = co.cliente_planta_id
            AND NOT c2.anulada AND NOT a.anulado
        ), 0) AS total_abonado,
        (SELECT MAX(a.fecha) FROM abonos_planta a
          JOIN cobranzas_planta c3 ON c3.id = a.cobranza_id
          WHERE c3.cliente_planta_id = co.cliente_planta_id
            AND NOT c3.anulada AND NOT a.anulado) AS ultimo_pago
      FROM cobranzas_planta co
      WHERE NOT co.anulada
      GROUP BY co.cliente_planta_id
    ) d ON d.cliente_planta_id = c.id
    ORDER BY c.nombre ASC
  `) as ClientePlantaConSaldo[];
  return rows;
}

/** Saldo de UN cliente (misma aritmética). */
export async function saldoClientePlanta(
  sql: Sql,
  clienteId: string
): Promise<ClientePlantaConSaldo | null> {
  const lista = await listaClientesPlantaConSaldo(sql);
  return lista.find((c) => c.id === clienteId) ?? null;
}

/** Cobranzas (deudas) con su saldo. Opcionalmente filtradas por cliente. */
export async function listaCobranzasPlanta(
  sql: Sql,
  clienteId?: string
): Promise<CobranzaPlanta[]> {
  const rows = (await sql`
    SELECT
      co.id, co.pedido_id, co.cliente_planta_id, co.cliente_nombre,
      co.monto::float8 AS monto, co.plazo_dias,
      co.fecha_emision::text AS fecha_emision,
      co.fecha_vencimiento::text AS fecha_vencimiento,
      CASE
        WHEN NOT co.anulada
          AND co.estado = 'Pendiente'
          AND co.fecha_vencimiento < (NOW() AT TIME ZONE 'America/Lima')::date
        THEN 'Vencida'
        ELSE co.estado
      END AS estado,
      co.comprobante_id, co.empresa, co.notas, co.anulada,
      co.anulacion_motivo, co.created_at::text AS created_at,
      COALESCE(ab.total_abonado, 0)::float8 AS total_abonado,
      (co.monto - COALESCE(ab.total_abonado, 0))::float8 AS saldo
    FROM cobranzas_planta co
    LEFT JOIN (
      SELECT cobranza_id, SUM(monto) AS total_abonado
      FROM abonos_planta WHERE NOT anulado GROUP BY cobranza_id
    ) ab ON ab.cobranza_id = co.id
    ${clienteId ? sql`WHERE co.cliente_planta_id = ${clienteId}` : sql``}
    ORDER BY co.created_at DESC
  `) as CobranzaPlanta[];
  return rows;
}

/** Abonos de una cobranza (para el detalle/historial). */
export async function abonosDeCobranza(
  sql: Sql,
  cobranzaId: string
): Promise<AbonoPlanta[]> {
  const rows = (await sql`
    SELECT
      a.id, a.cobranza_id, a.monto::float8 AS monto, a.medio_pago,
      a.fecha::text AS fecha, a.observaciones,
      (a.comprobante_data IS NOT NULL) AS tiene_comprobante,
      a.anulado, a.anulacion_motivo, a.created_at::text AS created_at
    FROM abonos_planta a
    WHERE a.cobranza_id = ${cobranzaId}
    ORDER BY a.created_at DESC
  `) as AbonoPlanta[];
  return rows;
}

/**
 * Recalcula y persiste el `estado` de una cobranza según sus abonos y la fecha.
 * Pagada si Σ abonos ≥ monto; Parcial si > 0; si no, Pendiente/Vencida por fecha.
 * (No toca cobranzas anuladas.)
 */
export async function recalcularEstadoCobranza(
  sql: Sql,
  cobranzaId: string
): Promise<void> {
  const rows = (await sql`
    SELECT
      co.monto::float8 AS monto,
      co.fecha_vencimiento,
      co.anulada,
      COALESCE((
        SELECT SUM(a.monto) FROM abonos_planta a
        WHERE a.cobranza_id = co.id AND NOT a.anulado
      ), 0)::float8 AS abonado
    FROM cobranzas_planta co
    WHERE co.id = ${cobranzaId}
  `) as Array<{ monto: number; fecha_vencimiento: string; anulada: boolean; abonado: number }>;
  const r = rows[0];
  if (!r || r.anulada) return;

  let estado: EstadoCobranzaPlanta;
  if (r.abonado + UMBRAL_DEUDA_PLANTA >= r.monto) {
    estado = "Pagada";
  } else if (r.abonado > UMBRAL_DEUDA_PLANTA) {
    estado = "Parcial";
  } else {
    // Sin abonos: Vencida si ya pasó el vencimiento (comparado en zona Lima), si no Pendiente.
    const venceRows = (await sql`
      SELECT ${r.fecha_vencimiento}::date < (NOW() AT TIME ZONE 'America/Lima')::date AS vencida
    `) as Array<{ vencida: boolean }>;
    estado = venceRows[0]?.vencida ? "Vencida" : "Pendiente";
  }

  await sql`
    UPDATE cobranzas_planta
    SET estado = ${estado}, updated_at = NOW()
    WHERE id = ${cobranzaId}
  `;
}

/**
 * Enlaza el CPE emitido desde un pedido POS con la deuda de planta que ya nació
 * al vender a crédito. Para contado no habrá fila y el UPDATE retorna 0.
 * Nunca crea una deuda ni toca `facturas`.
 */
export async function vincularCobranzaPlantaAComprobante(
  sql: Sql,
  params: { pedidoId: string; comprobanteId: string }
): Promise<number> {
  const rows = (await sql`
    UPDATE cobranzas_planta
    SET comprobante_id = ${params.comprobanteId}::uuid,
        updated_at = NOW()
    WHERE pedido_id = ${params.pedidoId}::uuid
      AND (
        comprobante_id IS NULL
        OR comprobante_id = ${params.comprobanteId}::uuid
      )
    RETURNING id
  `) as Array<{ id: string }>;
  return rows.length;
}

/**
 * Anula las deudas de planta asociadas a un CPE que acaba de recibir una Nota
 * de Crédito total aceptada. Esta operación nunca toca `facturas`: la cartera
 * del POS vive exclusivamente en `cobranzas_planta`.
 *
 * Se enlaza por `comprobante_id` cuando existe y también por `pedido_id`, porque
 * las cobranzas POS históricas se crearon antes de emitir el CPE y pueden no
 * tener todavía guardado el id del comprobante. Las cobranzas pagadas no se
 * anulan automáticamente: requieren gestionar la devolución manualmente.
 */
export async function anularCobranzasPlantaDeComprobante(
  sql: Sql,
  params: {
    comprobanteId: string;
    pedidoId?: string | null;
    motivo: string;
    anuladaPor: string;
  }
): Promise<number> {
  const rows = (await sql`
    UPDATE cobranzas_planta
    SET anulada = TRUE,
        anulada_at = NOW(),
        anulada_por = ${params.anuladaPor}::uuid,
        anulacion_motivo = ${params.motivo},
        estado = 'Anulada',
        comprobante_id = COALESCE(comprobante_id, ${params.comprobanteId}::uuid),
        updated_at = NOW()
    WHERE NOT anulada
      AND estado IN ('Pendiente', 'Parcial', 'Vencida')
      AND (
        comprobante_id = ${params.comprobanteId}::uuid
        OR (
          ${params.pedidoId ?? null}::uuid IS NOT NULL
          AND pedido_id = ${params.pedidoId ?? null}::uuid
        )
      )
    RETURNING id
  `) as Array<{ id: string }>;
  return rows.length;
}
