export interface DeudaParaDistribuir {
  id: string;
  saldo: number;
  fecha_vencimiento: string | null;
  created_at: string;
}

export interface ResultadoDistribucionPago {
  aplicaciones: Array<{ deuda_id: string; monto: number }>;
  saldo_favor: number;
}

/** Especificacion ejecutable del orden usado por el SQL: elegida y luego FIFO. */
export function distribuirPagoProveedor(
  monto: number,
  deudas: DeudaParaDistribuir[],
  deudaPrioritariaId: string | null = null
): ResultadoDistribucionPago {
  let restanteCt = Math.round(monto * 100);
  const ordenadas = [...deudas]
    .filter((deuda) => deuda.saldo > 0.009)
    .sort((a, b) => {
      const prioridadA = a.id === deudaPrioritariaId ? 0 : 1;
      const prioridadB = b.id === deudaPrioritariaId ? 0 : 1;
      if (prioridadA !== prioridadB) return prioridadA - prioridadB;
      const vencimientoA = a.fecha_vencimiento ?? "9999-12-31";
      const vencimientoB = b.fecha_vencimiento ?? "9999-12-31";
      return (
        vencimientoA.localeCompare(vencimientoB) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id)
      );
    });

  const aplicaciones: ResultadoDistribucionPago["aplicaciones"] = [];
  for (const deuda of ordenadas) {
    if (restanteCt <= 0) break;
    const aplicadoCt = Math.min(restanteCt, Math.round(deuda.saldo * 100));
    if (aplicadoCt > 0) {
      aplicaciones.push({ deuda_id: deuda.id, monto: aplicadoCt / 100 });
      restanteCt -= aplicadoCt;
    }
  }
  return { aplicaciones, saldo_favor: restanteCt / 100 };
}

