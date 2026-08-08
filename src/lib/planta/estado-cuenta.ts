// src/lib/planta/estado-cuenta.ts
// Agrupa el historial de un cliente de planta en un libro DÍA POR DÍA, con el
// saldo arrastrado. Función PURA (sin I/O): es la fuente ÚNICA que consumen la
// pantalla y el PDF, para que nunca muestren números distintos.
//
// ⚠️ REGLA CENTRAL: el saldo lo mueven `saldo_anterior`, las ventas a CRÉDITO y
// los abonos. Las ventas al CONTADO se registran (el cliente quiere ver qué se
// llevó) pero NO tocan el saldo — ya se pagaron. Meterlas en la columna de saldo
// haría que el estado de cuenta se contradiga con la deuda real.
//
// Espejo de src/lib/avicola/estado-cuenta.ts, que no tiene esta distinción
// porque en campo toda venta es a crédito.
import type {
  ClientePlantaConSaldo,
  ItemMovimientoPlanta,
  MedioPagoPlanta,
  MovimientoPlanta,
} from "@/lib/planta/types";

/** Un abono suelto dentro del día, con el saldo que dejó al aplicarse. */
export interface AbonoDiaPlanta {
  id: string;
  created_at: string;
  monto: number;
  medio_pago: MedioPagoPlanta | null;
  observaciones: string | null;
  /** Saldo inmediatamente después de aplicar este movimiento, en orden cronológico. */
  saldo_posterior: number;
}

export interface DiaEstadoCuentaPlanta {
  /** YYYY-MM-DD */
  fecha: string;
  items: ItemMovimientoPlanta[];
  /** Σ ventas a CRÉDITO del día (lo que generó deuda). */
  venta_credito: number;
  /** Σ ventas al CONTADO del día (informativo, no mueve el saldo). */
  venta_contado: number;
  /** Σ abonos del día. */
  abonos_del_dia: number;
  /** Cada abono se conserva por separado, ordenado por created_at. */
  abonos: AbonoDiaPlanta[];
  /** Saldo al inicio del día. */
  saldo_anterior: number;
  /** Saldo al cierre del día. */
  saldo_actual: number;
  hay_venta: boolean;
  hay_abono: boolean;
}

export interface EstadoCuentaPlanta {
  desde: string | null;
  hasta: string | null;
  /** Saldo antes del primer día del período. */
  saldo_inicial: number;
  /** Ascendente por fecha. */
  dias: DiaEstadoCuentaPlanta[];
  total_credito: number;
  total_contado: number;
  total_abonado: number;
  /** Saldo pendiente al cierre del período. */
  saldo_final: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ¿Este movimiento mueve el saldo? Solo el crédito y los abonos. */
function afectaSaldo(m: MovimientoPlanta): boolean {
  return m.tipo === "abono" || m.tipo_pago === "Credito";
}

/** Cuánto suma (+) o resta (−) al saldo. */
function delta(m: MovimientoPlanta): number {
  if (!afectaSaldo(m)) return 0;
  return m.tipo === "venta" ? m.monto : -m.monto;
}

export function construirEstadoCuentaPlanta(
  cliente: Pick<ClientePlantaConSaldo, "saldo_anterior">,
  historial: MovimientoPlanta[],
  desde: string | null,
  hasta: string | null
): EstadoCuentaPlanta {
  const movs = historial.filter((m) => !m.anulado);

  // Saldo con el que se entra al período.
  let saldoInicial = cliente.saldo_anterior;
  if (desde) {
    for (const m of movs) {
      if (m.fecha.slice(0, 10) < desde) saldoInicial += delta(m);
    }
  }
  saldoInicial = r2(saldoInicial);

  // Ventana del período (comparación lexicográfica de YYYY-MM-DD, inclusiva).
  const enPeriodo = movs
    .filter((m) => {
      const f = m.fecha.slice(0, 10);
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      return true;
    })
    .sort((a, b) =>
      a.fecha === b.fecha
        ? a.created_at.localeCompare(b.created_at)
        : a.fecha.localeCompare(b.fecha)
    );

  // Map preserva orden de inserción = ascendente.
  const porDia = new Map<string, MovimientoPlanta[]>();
  for (const m of enPeriodo) {
    const clave = m.fecha.slice(0, 10);
    const lista = porDia.get(clave);
    if (lista) lista.push(m);
    else porDia.set(clave, [m]);
  }

  const dias: DiaEstadoCuentaPlanta[] = [];
  let saldo = saldoInicial;
  let totalCredito = 0;
  let totalContado = 0;
  let totalAbonado = 0;

  for (const [fecha, lista] of porDia) {
    const ventas = lista.filter((m) => m.tipo === "venta");
    const abonosDelDia = lista.filter((m) => m.tipo === "abono");

    const ventaCredito = r2(
      ventas.filter((v) => v.tipo_pago === "Credito").reduce((a, v) => a + v.monto, 0)
    );
    const ventaContado = r2(
      ventas.filter((v) => v.tipo_pago !== "Credito").reduce((a, v) => a + v.monto, 0)
    );
    const sumaAbonos = r2(abonosDelDia.reduce((a, m) => a + m.monto, 0));

    const items = ventas.flatMap((v) => v.items ?? []);
    const saldoAnterior = saldo;

    // Saldo posterior de CADA abono: se recorre el día completo en orden
    // cronológico para que tres pagos del mismo día conserven su saldo
    // individual en vez de colapsarse en una sola cifra.
    const abonos: AbonoDiaPlanta[] = [];
    let saldoMovimiento = saldo;
    for (const m of lista) {
      saldoMovimiento = r2(saldoMovimiento + delta(m));
      if (m.tipo === "abono") {
        abonos.push({
          id: m.id,
          created_at: m.created_at,
          monto: m.monto,
          medio_pago: m.medio_pago,
          observaciones: m.observaciones,
          saldo_posterior: saldoMovimiento,
        });
      }
    }

    saldo = r2(saldo + ventaCredito - sumaAbonos);
    totalCredito = r2(totalCredito + ventaCredito);
    totalContado = r2(totalContado + ventaContado);
    totalAbonado = r2(totalAbonado + sumaAbonos);

    dias.push({
      fecha,
      items,
      venta_credito: ventaCredito,
      venta_contado: ventaContado,
      abonos_del_dia: sumaAbonos,
      abonos,
      saldo_anterior: saldoAnterior,
      saldo_actual: saldo,
      hay_venta: ventas.length > 0,
      hay_abono: abonosDelDia.length > 0,
    });
  }

  return {
    desde,
    hasta,
    saldo_inicial: saldoInicial,
    dias,
    total_credito: totalCredito,
    total_contado: totalContado,
    total_abonado: totalAbonado,
    saldo_final: saldo,
  };
}
