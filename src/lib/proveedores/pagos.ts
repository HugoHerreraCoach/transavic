import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

export interface RegistrarPagoProveedorInput {
  id: string;
  proveedor_id: string;
  cuenta_bancaria_id: string;
  monto: number;
  fecha: string;
  notas: string | null;
  deuda_prioritaria_id: string | null;
  confirmar_anticipo: boolean;
}

export class PagoProveedorError extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly datos?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    codigo: string,
    datos?: Record<string, unknown>
  ) {
    super(message);
    this.status = status;
    this.codigo = codigo;
    this.datos = datos;
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

async function deudaPendienteProveedor(sql: Sql, proveedorId: string) {
  const filas = (await sql`
    SELECT COALESCE(SUM(monto_deuda - monto_pagado), 0)::float8 AS saldo
    FROM cuentas_por_pagar
    WHERE proveedor_id = ${proveedorId}
      AND monto_pagado < monto_deuda
  `) as Array<{ saldo: number }>;
  return r2(Number(filas[0]?.saldo ?? 0));
}

/** Debe ser la primera consulta de toda transaccion que cambie el saldo del proveedor. */
export function consultaBloqueoProveedor(sql: Sql, proveedorId: string) {
  return sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${proveedorId}::text, 0))
  `;
}

/**
 * Consultas que consumen anticipos antiguos al crear una deuda. El llamador
 * debe ejecutarlas, dentro de la misma sql.transaction, despues de crear la
 * deuda y habiendo adquirido antes consultaBloqueoProveedor().
 */
export function consultasAplicarAnticiposADeuda(
  sql: Sql,
  proveedorId: string,
  deudaId: string,
  fechaAplicacion: string
) {
  return [
    sql`
      WITH deuda AS (
        SELECT id, monto_deuda - monto_pagado AS saldo
        FROM cuentas_por_pagar
        WHERE id = ${deudaId} AND proveedor_id = ${proveedorId}
      ),
      disponibles AS (
        SELECT
          p.id AS pago_id,
          p.fecha,
          p.created_at,
          p.monto - COALESCE(SUM(a.monto), 0) AS disponible
        FROM pagos_proveedores p
        LEFT JOIN pagos_proveedores_aplicaciones a ON a.pago_id = p.id
        WHERE p.proveedor_id = ${proveedorId}
          AND p.estado = 'registrado'
        GROUP BY p.id, p.fecha, p.created_at, p.monto
        HAVING p.monto - COALESCE(SUM(a.monto), 0) > 0
      ),
      ordenados AS (
        SELECT
          d.*,
          COALESCE(
            SUM(d.disponible) OVER (
              ORDER BY d.fecha, d.created_at, d.pago_id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),
            0
          ) AS disponible_anterior
        FROM disponibles d
      )
      INSERT INTO pagos_proveedores_aplicaciones (
        pago_id, deuda_id, proveedor_id, monto, origen, fecha_aplicacion
      )
      SELECT
        o.pago_id,
        ${deudaId},
        ${proveedorId},
        LEAST(o.disponible, GREATEST(0, de.saldo - o.disponible_anterior)),
        'anticipo_posterior',
        ${fechaAplicacion}::date
      FROM ordenados o
      CROSS JOIN deuda de
      WHERE o.disponible_anterior < de.saldo
        AND LEAST(o.disponible, GREATEST(0, de.saldo - o.disponible_anterior)) > 0
      ON CONFLICT (pago_id, deuda_id) DO NOTHING
    `,
    sql`
      UPDATE cuentas_por_pagar cpp
      SET monto_pagado = LEAST(
            cpp.monto_deuda,
            COALESCE((
              SELECT SUM(a.monto)
              FROM pagos_proveedores_aplicaciones a
              JOIN pagos_proveedores p ON p.id = a.pago_id
              WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
            ), 0)
          ),
          estado = CASE
            WHEN COALESCE((
              SELECT SUM(a.monto)
              FROM pagos_proveedores_aplicaciones a
              JOIN pagos_proveedores p ON p.id = a.pago_id
              WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
            ), 0) >= cpp.monto_deuda THEN 'Pagado'
            WHEN COALESCE((
              SELECT SUM(a.monto)
              FROM pagos_proveedores_aplicaciones a
              JOIN pagos_proveedores p ON p.id = a.pago_id
              WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
            ), 0) > 0 THEN 'Parcial'
            ELSE 'Pendiente'
          END,
          updated_at = NOW()
      WHERE cpp.id = ${deudaId} AND cpp.proveedor_id = ${proveedorId}
    `,
  ];
}

async function obtenerPago(sql: Sql, id: string) {
  const filas = (await sql`
    SELECT id, proveedor_id, cuenta_bancaria_id, deuda_prioritaria_id,
           monto::float8 AS monto, fecha::text, COALESCE(notas, '') AS notas,
           estado, procesado_at
    FROM pagos_proveedores
    WHERE id = ${id}
  `) as Array<{
    id: string;
    proveedor_id: string;
    cuenta_bancaria_id: string;
    deuda_prioritaria_id: string | null;
    monto: number;
    fecha: string;
    notas: string;
    estado: "registrado" | "anulado";
    procesado_at: string | null;
  }>;
  return filas[0] ?? null;
}

function payloadCoincide(
  existente: NonNullable<Awaited<ReturnType<typeof obtenerPago>>>,
  input: RegistrarPagoProveedorInput
) {
  return (
    existente.proveedor_id === input.proveedor_id &&
    existente.cuenta_bancaria_id === input.cuenta_bancaria_id &&
    existente.deuda_prioritaria_id === input.deuda_prioritaria_id &&
    Math.abs(Number(existente.monto) - input.monto) < 0.005 &&
    existente.fecha === input.fecha &&
    existente.notas.trim() === (input.notas ?? "").trim()
  );
}

async function validarReferencias(
  sql: Sql,
  input: RegistrarPagoProveedorInput
) {
  const [hoyRows, proveedorRows, cuentaRows] = await Promise.all([
    sql`SELECT (NOW() AT TIME ZONE 'America/Lima')::date::text AS hoy`,
    sql`SELECT id FROM proveedores WHERE id = ${input.proveedor_id}`,
    sql`SELECT id FROM cuentas_bancarias WHERE id = ${input.cuenta_bancaria_id} AND activa = TRUE`,
  ]);
  const hoy = String(hoyRows[0]?.hoy ?? "");
  if (input.fecha > hoy) {
    throw new PagoProveedorError(
      "La fecha del pago no puede estar en el futuro.",
      400,
      "FECHA_FUTURA"
    );
  }
  if (proveedorRows.length === 0) {
    throw new PagoProveedorError("Proveedor no encontrado.", 404, "PROVEEDOR_NO_ENCONTRADO");
  }
  if (cuentaRows.length === 0) {
    throw new PagoProveedorError(
      "Cuenta bancaria de origen no encontrada o inactiva.",
      404,
      "CUENTA_NO_ENCONTRADA"
    );
  }
  if (input.deuda_prioritaria_id) {
    const deuda = await sql`
      SELECT id FROM cuentas_por_pagar
      WHERE id = ${input.deuda_prioritaria_id}
        AND proveedor_id = ${input.proveedor_id}
    `;
    if (deuda.length === 0) {
      throw new PagoProveedorError(
        "La deuda seleccionada no pertenece al proveedor.",
        409,
        "DEUDA_DE_OTRO_PROVEEDOR"
      );
    }
  }
}

export async function registrarPagoProveedor(
  sql: Sql,
  usuarioId: string,
  inputOriginal: RegistrarPagoProveedorInput
) {
  const input = {
    ...inputOriginal,
    monto: r2(inputOriginal.monto),
    notas: inputOriginal.notas?.trim() || null,
  };

  const existenteAntes = await obtenerPago(sql, input.id);
  if (existenteAntes) {
    if (!payloadCoincide(existenteAntes, input)) {
      throw new PagoProveedorError(
        "El identificador del pago ya fue usado con datos diferentes.",
        409,
        "IDEMPOTENCIA_CONFLICTO"
      );
    }
    return { pago: existenteAntes, repetido: true };
  }

  await validarReferencias(sql, input);

  const deudaPendiente = await deudaPendienteProveedor(sql, input.proveedor_id);
  const anticipo = r2(Math.max(0, input.monto - deudaPendiente));
  if (anticipo > 0 && !input.confirmar_anticipo) {
    throw new PagoProveedorError(
      `El pago supera la deuda actual. S/ ${anticipo.toFixed(2)} quedarán como saldo a favor.`,
      409,
      "ANTICIPO_REQUIERE_CONFIRMACION",
      { deuda_pendiente: deudaPendiente, saldo_favor_nuevo: anticipo }
    );
  }

  try {
    await sql.transaction(
      [
      consultaBloqueoProveedor(sql, input.proveedor_id),
      sql`
        INSERT INTO pagos_proveedores (
          id, proveedor_id, cuenta_bancaria_id, deuda_prioritaria_id,
          monto, fecha, notas, estado, origen_registro, registrado_por
        )
        SELECT
          ${input.id}, ${input.proveedor_id}, cb.id, ${input.deuda_prioritaria_id},
          ${input.monto}, ${input.fecha}::date, ${input.notas}, 'registrado',
          'sistema', ${usuarioId}
        FROM cuentas_bancarias cb
        WHERE cb.id = ${input.cuenta_bancaria_id} AND cb.activa = TRUE
        ON CONFLICT (id) DO NOTHING
      `,
      // Guard AUTORITATIVO, ya dentro de la transaccion y despues del lock.
      // La funcion aborta y revierte todo el batch si otro pago consumio la
      // deuda mientras esta solicitud esperaba. El catch lo traduce a 409.
      sql`
        SELECT public.validar_anticipo_pago_proveedor(
          ${input.id}::uuid,
          ${input.confirmar_anticipo}::boolean
        )
      `,
      // Movimiento y saldo de la cuenta. `procesado_at IS NULL` hace que un
      // retry concurrente no descuente la cuenta por segunda vez.
      sql`
        WITH pago AS (
          SELECT * FROM pagos_proveedores
          WHERE id = ${input.id} AND estado = 'registrado' AND procesado_at IS NULL
        ),
        movimiento AS (
          INSERT INTO transacciones (
            cuenta_id, usuario_id, tipo, monto, concepto, referencia_id,
            fecha, pago_proveedor_id
          )
          SELECT
            p.cuenta_bancaria_id,
            ${usuarioId},
            'egreso',
            p.monto,
            'Pago a Proveedor: ' || prov.razon_social ||
              COALESCE(' - ' || NULLIF(p.notas, ''), ''),
            COALESCE(p.deuda_prioritaria_id, p.proveedor_id),
            p.fecha,
            p.id
          FROM pago p
          JOIN proveedores prov ON prov.id = p.proveedor_id
          ON CONFLICT DO NOTHING
          RETURNING cuenta_id, monto
        )
        UPDATE cuentas_bancarias cb
        SET saldo = cb.saldo - m.monto,
            updated_at = NOW()
        FROM movimiento m
        WHERE cb.id = m.cuenta_id
      `,
      // Prioridad: documento elegido y luego FIFO por vencimiento/creacion.
      sql`
        WITH pago AS (
          SELECT * FROM pagos_proveedores
          WHERE id = ${input.id} AND estado = 'registrado' AND procesado_at IS NULL
        ),
        saldos AS (
          SELECT
            cpp.id,
            cpp.proveedor_id,
            cpp.monto_deuda - cpp.monto_pagado AS saldo,
            cpp.fecha_vencimiento,
            cpp.created_at,
            CASE WHEN cpp.id = p.deuda_prioritaria_id THEN 0 ELSE 1 END AS prioridad
          FROM cuentas_por_pagar cpp
          CROSS JOIN pago p
          WHERE cpp.proveedor_id = p.proveedor_id
            AND cpp.monto_pagado < cpp.monto_deuda
        ),
        ordenadas AS (
          SELECT
            s.*,
            COALESCE(
              SUM(s.saldo) OVER (
                ORDER BY s.prioridad, s.fecha_vencimiento NULLS LAST, s.created_at, s.id
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ),
              0
            ) AS saldo_anterior
          FROM saldos s
        )
        INSERT INTO pagos_proveedores_aplicaciones (
          pago_id, deuda_id, proveedor_id, monto, origen, fecha_aplicacion
        )
        SELECT
          p.id,
          o.id,
          o.proveedor_id,
          LEAST(o.saldo, GREATEST(0, p.monto - o.saldo_anterior)),
          'pago',
          p.fecha
        FROM ordenadas o
        CROSS JOIN pago p
        WHERE o.saldo_anterior < p.monto
          AND LEAST(o.saldo, GREATEST(0, p.monto - o.saldo_anterior)) > 0
        ON CONFLICT (pago_id, deuda_id) DO NOTHING
      `,
      // Esta consulta es posterior al INSERT de aplicaciones dentro de la
      // misma transaccion, por lo que recalcula el cache desde la fuente canonica.
      sql`
        UPDATE cuentas_por_pagar cpp
        SET monto_pagado = LEAST(
              cpp.monto_deuda,
              COALESCE((
                SELECT SUM(a.monto)
                FROM pagos_proveedores_aplicaciones a
                JOIN pagos_proveedores p ON p.id = a.pago_id
                WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
              ), 0)
            ),
            estado = CASE
              WHEN COALESCE((
                SELECT SUM(a.monto)
                FROM pagos_proveedores_aplicaciones a
                JOIN pagos_proveedores p ON p.id = a.pago_id
                WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
              ), 0) >= cpp.monto_deuda THEN 'Pagado'
              WHEN COALESCE((
                SELECT SUM(a.monto)
                FROM pagos_proveedores_aplicaciones a
                JOIN pagos_proveedores p ON p.id = a.pago_id
                WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
              ), 0) > 0 THEN 'Parcial'
              ELSE 'Pendiente'
            END,
            updated_at = NOW()
        WHERE cpp.proveedor_id = ${input.proveedor_id}
      `,
      sql`
        UPDATE pagos_proveedores
        SET procesado_at = NOW(), updated_at = NOW()
        WHERE id = ${input.id} AND procesado_at IS NULL
      `,
      ],
      // El advisory lock serializa por proveedor; ReadCommitted permite que un
      // retry que esperaba el lock vea el pago ya confirmado y responda idempotente.
      { isolationLevel: "ReadCommitted" }
    );
  } catch (error: unknown) {
    const dbError = error as { code?: string; message?: string };
    if (
      dbError.code === "P0001" &&
      dbError.message?.includes("ANTICIPO_REQUIERE_CONFIRMACION")
    ) {
      const saldoActual = await deudaPendienteProveedor(sql, input.proveedor_id);
      const saldoFavorNuevo = r2(Math.max(0, input.monto - saldoActual));
      throw new PagoProveedorError(
        `El pago supera la deuda actual. S/ ${saldoFavorNuevo.toFixed(2)} quedarán como saldo a favor.`,
        409,
        "ANTICIPO_REQUIERE_CONFIRMACION",
        { deuda_pendiente: saldoActual, saldo_favor_nuevo: saldoFavorNuevo }
      );
    }
    throw error;
  }

  const pago = await obtenerPago(sql, input.id);
  if (!pago) {
    throw new PagoProveedorError(
      "No se pudo registrar el pago. Recarga e intenta nuevamente.",
      409,
      "PAGO_NO_REGISTRADO"
    );
  }
  if (!payloadCoincide(pago, input)) {
    throw new PagoProveedorError(
      "El identificador del pago ya fue usado con datos diferentes.",
      409,
      "IDEMPOTENCIA_CONFLICTO"
    );
  }

  return { pago, repetido: false };
}

export async function anularPagoProveedor(
  sql: Sql,
  usuarioId: string,
  proveedorId: string,
  pagoId: string,
  motivo: string
) {
  const pagoRows = (await sql`
    SELECT id, proveedor_id, estado
    FROM pagos_proveedores
    WHERE id = ${pagoId} AND proveedor_id = ${proveedorId}
  `) as Array<{ id: string; proveedor_id: string; estado: "registrado" | "anulado" }>;
  const pago = pagoRows[0];
  if (!pago) {
    throw new PagoProveedorError("Pago no encontrado.", 404, "PAGO_NO_ENCONTRADO");
  }
  if (pago.estado === "anulado") return { anulado: true, repetido: true };

  await sql.transaction(
    [
      consultaBloqueoProveedor(sql, proveedorId),
      sql`
        UPDATE pagos_proveedores
        SET estado = 'anulado', anulado_por = ${usuarioId}, anulado_at = NOW(),
            motivo_anulacion = ${motivo}, updated_at = NOW()
        WHERE id = ${pagoId} AND proveedor_id = ${proveedorId}
          AND estado = 'registrado'
      `,
      sql`
        WITH pago AS (
          SELECT * FROM pagos_proveedores
          WHERE id = ${pagoId} AND proveedor_id = ${proveedorId} AND estado = 'anulado'
        ),
        reverso AS (
          INSERT INTO transacciones (
            cuenta_id, usuario_id, tipo, monto, concepto, referencia_id,
            fecha, pago_proveedor_id
          )
          SELECT
            p.cuenta_bancaria_id,
            ${usuarioId},
            'ingreso',
            p.monto,
            'Anulacion de pago a proveedor - ' || ${motivo},
            COALESCE(p.deuda_prioritaria_id, p.proveedor_id),
            (NOW() AT TIME ZONE 'America/Lima')::date,
            p.id
          FROM pago p
          ON CONFLICT DO NOTHING
          RETURNING cuenta_id, monto
        )
        UPDATE cuentas_bancarias cb
        SET saldo = cb.saldo + r.monto, updated_at = NOW()
        FROM reverso r
        WHERE cb.id = r.cuenta_id
      `,
      sql`
        UPDATE cuentas_por_pagar cpp
        SET monto_pagado = LEAST(
              cpp.monto_deuda,
              COALESCE((
                SELECT SUM(a.monto)
                FROM pagos_proveedores_aplicaciones a
                JOIN pagos_proveedores p ON p.id = a.pago_id
                WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
              ), 0)
            ),
            estado = CASE
              WHEN COALESCE((
                SELECT SUM(a.monto)
                FROM pagos_proveedores_aplicaciones a
                JOIN pagos_proveedores p ON p.id = a.pago_id
                WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
              ), 0) >= cpp.monto_deuda THEN 'Pagado'
              WHEN COALESCE((
                SELECT SUM(a.monto)
                FROM pagos_proveedores_aplicaciones a
                JOIN pagos_proveedores p ON p.id = a.pago_id
                WHERE a.deuda_id = cpp.id AND p.estado = 'registrado'
              ), 0) > 0 THEN 'Parcial'
              ELSE 'Pendiente'
            END,
            updated_at = NOW()
        WHERE cpp.proveedor_id = ${proveedorId}
      `,
    ],
    { isolationLevel: "ReadCommitted" }
  );

  return { anulado: true, repetido: false };
}
