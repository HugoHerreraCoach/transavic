// Efectos internos idempotentes cuando SUNAT confirma tarde un CPE 01/03.
//
// Este modulo NO emite, reconstruye ni firma documentos. Solo ejecuta los mismos
// enlaces de cartera que normalmente ocurren cuando sendBill responde aceptado
// en la primera llamada. La operacion se deriva de los vinculos existentes:
// Campo -> venta_avicola_id; Planta -> pedido.origen=pos_planta; resto Ejecutivas.

import { neon } from "@neondatabase/serverless";

interface EfectoAceptacionResultado {
  aplicado: boolean;
  requiereRevision: boolean;
  motivoRevision?: string;
}

function fechaIso(value: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function diasEntreFechas(desde: string | null, hasta: string | null): number | null {
  if (!desde || !hasta) return null;
  const inicio = new Date(`${desde}T12:00:00Z`).getTime();
  const fin = new Date(`${hasta}T12:00:00Z`).getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null;
  return Math.max(0, Math.round((fin - inicio) / 86_400_000));
}

/**
 * Aplica la cartera correcta para un CPE que paso de incierto a aceptado.
 *
 * Si el mismo pedido ya tiene otro CPE aceptado, NO crea ni religa deuda: marca
 * la fila para revision humana (posible duplicado legal que requiere decidir NC).
 */
export async function aplicarEfectosAceptacionCpe(
  comprobanteId: string
): Promise<EfectoAceptacionResultado> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT
      c.id, c.pedido_id, c.venta_avicola_id, c.tipo, c.estado,
      c.serie_numero, c.cliente_razon_social, c.monto_total,
      c.forma_pago, c.fecha_emision, c.fecha_vencimiento, c.emitido_por,
      c.cobranza_cliente_id,
      p.origen AS pedido_origen, p.cliente AS pedido_cliente,
      p.cliente_id AS pedido_cliente_id, p.asesor_id AS pedido_asesor_id,
      (
        SELECT string_agg(hermano.serie_numero, ', ' ORDER BY hermano.created_at)
        FROM comprobantes hermano
        WHERE c.pedido_id IS NOT NULL
          AND hermano.pedido_id = c.pedido_id
          AND hermano.id <> c.id
          AND hermano.tipo IN ('01', '03')
          AND hermano.estado IN ('aceptado', 'observado')
      ) AS hermanos_aceptados
    FROM comprobantes c
    LEFT JOIN pedidos p ON p.id = c.pedido_id
    WHERE c.id = ${comprobanteId}::uuid
    LIMIT 1
  `) as Array<{
    id: string;
    pedido_id: string | null;
    venta_avicola_id: string | null;
    tipo: string;
    estado: string;
    serie_numero: string;
    cliente_razon_social: string | null;
    monto_total: string | number;
    forma_pago: string | null;
    fecha_emision: string | Date | null;
    fecha_vencimiento: string | Date | null;
    emitido_por: string | null;
    cobranza_cliente_id: string | null;
    pedido_origen: string | null;
    pedido_cliente: string | null;
    pedido_cliente_id: string | null;
    pedido_asesor_id: string | null;
    hermanos_aceptados: string | null;
  }>;

  const c = rows[0];
  if (
    !c ||
    !["01", "03"].includes(c.tipo) ||
    !["aceptado", "observado"].includes(c.estado)
  ) {
    return { aplicado: false, requiereRevision: false };
  }

  if (c.hermanos_aceptados) {
    const motivo = `Posible duplicado: el mismo pedido ya tiene aceptado ${c.hermanos_aceptados}. No se modifico la cartera automaticamente.`;
    await sql`
      UPDATE comprobantes
      SET sunat_requiere_revision = TRUE,
          sunat_revision_motivo = ${motivo}
      WHERE id = ${c.id}::uuid
    `;
    return { aplicado: false, requiereRevision: true, motivoRevision: motivo };
  }

  // Campo tiene su propia cartera (ventas_avicola - abonos_avicola). El CPE no
  // debe crear una fila en `facturas`.
  if (c.venta_avicola_id) {
    return { aplicado: true, requiereRevision: false };
  }

  if (c.pedido_id && c.pedido_origen === "pos_planta") {
    const { vincularCobranzaPlantaAComprobante } = await import("@/lib/planta/saldos");
    await vincularCobranzaPlantaAComprobante(sql, {
      pedidoId: c.pedido_id,
      comprobanteId: c.id,
    });
    return { aplicado: true, requiereRevision: false };
  }

  const fechaEmision = fechaIso(c.fecha_emision);
  const fechaVencimiento = fechaIso(c.fecha_vencimiento);
  const plazoCredito = diasEntreFechas(fechaEmision, fechaVencimiento);
  const { vincularCobranzaAComprobante, crearFacturaStandalone, plazoDeCobranza } =
    await import("@/lib/cobranzas");

  if (c.pedido_id) {
    const facturasPrevias = (await sql`
      SELECT numero_comprobante
      FROM facturas
      WHERE pedido_id = ${c.pedido_id}::uuid
        AND COALESCE(numero_comprobante, '') <> ''
        AND numero_comprobante <> ${c.serie_numero}
        AND estado <> 'Anulada'
      LIMIT 1
    `) as Array<{ numero_comprobante: string }>;
    if (facturasPrevias[0]) {
      const motivo = `La cobranza del pedido ya esta vinculada a ${facturasPrevias[0].numero_comprobante}. No se reemplazo automaticamente por ${c.serie_numero}.`;
      await sql`
        UPDATE comprobantes
        SET sunat_requiere_revision = TRUE,
            sunat_revision_motivo = ${motivo}
        WHERE id = ${c.id}::uuid
      `;
      return { aplicado: false, requiereRevision: true, motivoRevision: motivo };
    }

    await vincularCobranzaAComprobante({
      pedidoId: c.pedido_id,
      clienteNombre: c.cliente_razon_social || c.pedido_cliente || "Cliente",
      clienteId: c.pedido_cliente_id,
      asesorId: c.pedido_asesor_id,
      monto: Number(c.monto_total),
      plazoDias:
        c.forma_pago === "Credito" && plazoCredito != null
          ? plazoCredito
          : await plazoDeCobranza(c.pedido_cliente_id),
      numeroComprobante: c.serie_numero,
      fechaEmision,
    });

    await sql`
      UPDATE facturas
      SET numero_comprobante = ${c.serie_numero}
      WHERE pedido_id = ${c.pedido_id}::uuid
        AND numero_comprobante IS NULL
    `;
    return { aplicado: true, requiereRevision: false };
  }

  const yaExiste = (await sql`
    SELECT id FROM facturas
    WHERE comprobante_id = ${c.id}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (yaExiste.length === 0) {
    let asesorId: string | null = null;
    if (c.emitido_por) {
      const emisores = (await sql`
        SELECT id
        FROM users
        WHERE role = 'asesor'
          AND LOWER(TRIM(name)) = LOWER(TRIM(${c.emitido_por}))
        ORDER BY activo DESC, id
        LIMIT 1
      `) as Array<{ id: string }>;
      asesorId = emisores[0]?.id ?? null;
    }
    if (!asesorId && c.cobranza_cliente_id) {
      const clientes = (await sql`
        SELECT asesor_id
        FROM clientes
        WHERE id = ${c.cobranza_cliente_id}::uuid
        LIMIT 1
      `) as Array<{ asesor_id: string | null }>;
      asesorId = clientes[0]?.asesor_id ?? null;
    }
    await crearFacturaStandalone({
      clienteNombre: c.cliente_razon_social || "Cliente",
      clienteId: c.cobranza_cliente_id,
      asesorId,
      monto: Number(c.monto_total),
      plazoDias:
        c.forma_pago === "Credito" && plazoCredito != null
          ? plazoCredito
          : await plazoDeCobranza(null),
      numeroComprobante: c.serie_numero,
      comprobanteId: c.id,
      fechaEmision,
    });
  }
  return { aplicado: true, requiereRevision: false };
}
