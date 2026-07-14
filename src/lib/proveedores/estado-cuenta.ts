import type {
  DeudaProveedorFicha,
  EstadoCuentaProveedor,
  MovimientoEstadoCuentaProveedor,
  MovimientoProveedorBase,
  PagoProveedorFicha,
} from "@/lib/proveedores/types";

const centavos = (monto: number) => Math.round(monto * 100);
const soles = (montoCentavos: number) => montoCentavos / 100;

/**
 * Convierte la ficha persistida en el libro cronológico que consumen pantalla y
 * PDF. Un pago anulado conserva su salida original y agrega un contraasiento en
 * la fecha de anulación; centralizarlo evita que cada consumidor reconstruya una
 * historia financiera distinta.
 */
export function construirMovimientosProveedor(
  deudas: DeudaProveedorFicha[],
  pagos: PagoProveedorFicha[]
): MovimientoProveedorBase[] {
  return [
    ...deudas.map((deuda) => ({
      id: deuda.id,
      tipo: "deuda" as const,
      fecha: deuda.fecha,
      created_at: deuda.created_at,
      monto: deuda.monto_deuda,
      documento:
        deuda.tipo_doc && deuda.nro_doc
          ? `${deuda.tipo_doc} ${deuda.nro_doc}`
          : deuda.concepto,
      concepto: deuda.concepto || "Compra a proveedor",
      cuenta_nombre: null,
      notas: null,
      items: deuda.items,
      aplicaciones: deuda.aplicaciones,
    })),
    ...pagos.flatMap((pago) => {
      const movimientoPago: MovimientoProveedorBase = {
        id: pago.id,
        tipo: "pago",
        fecha: pago.fecha,
        created_at: pago.created_at,
        monto: pago.monto,
        documento: null,
        concepto: "Pago al proveedor",
        cuenta_nombre: pago.cuenta_nombre,
        notas: pago.notas,
        items: [],
        aplicaciones: pago.aplicaciones,
      };
      if (pago.estado !== "anulado" || !pago.anulado_at) {
        return [movimientoPago];
      }

      const fechaContraasiento = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
      }).format(new Date(pago.anulado_at));
      const contraasiento: MovimientoProveedorBase = {
        id: `${pago.id}-contraasiento`,
        tipo: "contraasiento",
        fecha: fechaContraasiento,
        created_at: pago.anulado_at,
        monto: pago.monto,
        documento: null,
        concepto: "Contraasiento de pago anulado",
        cuenta_nombre: pago.cuenta_nombre,
        notas: pago.motivo_anulacion,
        items: [],
        aplicaciones: pago.aplicaciones,
      };
      return [movimientoPago, contraasiento];
    }),
  ];
}

/**
 * Libro mayor de un proveedor. Una compra aumenta lo que Transavic debe y cada
 * pago individual lo disminuye. El saldo puede ser negativo: es un anticipo a
 * favor de Transavic. Pantalla y PDF consumen exactamente esta funcion.
 */
export function construirEstadoCuentaProveedor(
  movimientos: MovimientoProveedorBase[],
  desde: string | null = null,
  hasta: string | null = null
): EstadoCuentaProveedor {
  const ordenados = [...movimientos].sort((a, b) => {
    const fecha = a.fecha.localeCompare(b.fecha);
    if (fecha !== 0) return fecha;
    const creado = a.created_at.localeCompare(b.created_at);
    if (creado !== 0) return creado;
    // Una deuda registrada en el mismo instante se muestra antes de su pago y
    // el contraasiento después del movimiento que revierte.
    if (a.tipo !== b.tipo) {
      const orden = { deuda: 0, pago: 1, contraasiento: 2 } as const;
      return orden[a.tipo] - orden[b.tipo];
    }
    return a.id.localeCompare(b.id);
  });

  let saldoInicialCt = 0;
  for (const movimiento of ordenados) {
    if (desde && movimiento.fecha < desde) {
      saldoInicialCt +=
        movimiento.tipo === "pago"
          ? -centavos(movimiento.monto)
          : centavos(movimiento.monto);
    }
  }

  const dentro = ordenados.filter((movimiento) => {
    if (desde && movimiento.fecha < desde) return false;
    if (hasta && movimiento.fecha > hasta) return false;
    return true;
  });

  let saldoCt = saldoInicialCt;
  let compradoCt = 0;
  let pagadoCt = 0;
  const filas: MovimientoEstadoCuentaProveedor[] = dentro.map((movimiento) => {
    const anteriorCt = saldoCt;
    const montoCt = centavos(movimiento.monto);
    if (movimiento.tipo === "deuda") {
      saldoCt += montoCt;
      compradoCt += montoCt;
    } else if (movimiento.tipo === "pago") {
      saldoCt -= montoCt;
      pagadoCt += montoCt;
    } else {
      saldoCt += montoCt;
      pagadoCt -= montoCt;
    }
    return {
      ...movimiento,
      saldo_anterior: soles(anteriorCt),
      saldo_posterior: soles(saldoCt),
    };
  });

  return {
    desde,
    hasta,
    saldo_inicial: soles(saldoInicialCt),
    total_comprado: soles(compradoCt),
    total_pagado: soles(pagadoCt),
    saldo_final: soles(saldoCt),
    deuda_pendiente: soles(Math.max(0, saldoCt)),
    saldo_favor: soles(Math.max(0, -saldoCt)),
    movimientos: filas,
  };
}
