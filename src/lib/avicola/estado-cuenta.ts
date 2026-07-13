// src/lib/avicola/estado-cuenta.ts
// Libro mayor POR DÍA del estado de cuenta de un cliente avícola, con filtro por
// período (rediseño pedido por el equipo, 11 jul 2026). Fuente ÚNICA compartida
// por el modal (pantalla) y el PDF, para que NUNCA divirjan.
//
// Columnas del documento: Fecha · Venta del día · Peso/Producto · Monto del día ·
// Saldo anterior · Abonos · Saldo actual, más los totales del período al pie.
//
// Aritmética (misma base que saldos.ts): saldo_anterior es el saldo ANTES de todo
// movimiento. Para un período [desde, hasta] el saldo de arranque = saldo_anterior
// + Σ(ventas − abonos) con fecha < desde (se corre hacia adelante SOLO dentro del
// período). Así un "hasta" en el pasado da el saldo REAL al cierre del período (el
// PDF viejo lo anclaba a saldo_actual all-time → daba mal con topes pasados).
import type {
  ClienteAvicolaConSaldo,
  MedioPagoAvicola,
  MovimientoAvicola,
  VentaAvicolaItem,
} from "@/lib/avicola/types";

/** Un abono individual dentro del día. Se conserva separado para que el cliente
 * pueda auditar cada pago en pantalla y en el PDF, aunque los totales sigan
 * calculándose por día. */
export interface AbonoDiaEstadoCuenta {
  id: string;
  created_at: string;
  monto: number;
  medio_pago: MedioPagoAvicola | null;
  observaciones: string | null;
  /** Saldo inmediatamente después de aplicar este movimiento en orden cronológico. */
  saldo_posterior: number;
}

/** Una fila = un DÍA con actividad (venta, abono, o ambos). */
export interface DiaEstadoCuenta {
  fecha: string; // YYYY-MM-DD
  /** Números de guía de las ventas del día (normalmente 1; el histórico raro puede traer 2). */
  guias: number[];
  /** Ítems de las ventas del día (producto + peso + precio). */
  items: VentaAvicolaItem[];
  venta_del_dia: number; // Σ ventas del día
  abonos_del_dia: number; // Σ abonos del día
  /** Cada abono permanece visible por separado, ordenado por created_at. */
  abonos: AbonoDiaEstadoCuenta[];
  saldo_anterior: number; // saldo al inicio del día
  saldo_actual: number; // saldo al cierre del día
  hay_venta: boolean;
  hay_abono: boolean;
}

export interface EstadoCuentaPeriodo {
  desde: string | null; // YYYY-MM-DD o null = desde el inicio
  hasta: string | null; // YYYY-MM-DD o null = hasta hoy
  saldo_inicial: number; // saldo antes del primer día del período
  dias: DiaEstadoCuenta[]; // ascendente por fecha
  total_vendido: number; // Σ ventas del período
  total_abonado: number; // Σ abonos del período
  saldo_final: number; // saldo pendiente al cierre del período
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Construye el libro mayor por día del período [desde, hasta] (inclusive).
 * `desde`/`hasta` son YYYY-MM-DD o null (abierto). Ignora anulados.
 */
export function construirEstadoCuenta(
  cliente: Pick<ClienteAvicolaConSaldo, "saldo_anterior">,
  historial: MovimientoAvicola[],
  desde: string | null,
  hasta: string | null
): EstadoCuentaPeriodo {
  const movs = historial.filter((m) => !m.anulado);

  // Saldo al INICIO del período = saldo_anterior + Σ movimientos con fecha < desde.
  let saldoInicial = cliente.saldo_anterior;
  if (desde) {
    for (const m of movs) {
      if (m.fecha.slice(0, 10) < desde) {
        saldoInicial += m.tipo === "venta" ? m.monto : -m.monto;
      }
    }
  }
  saldoInicial = r2(saldoInicial);

  // Movimientos DENTRO del período, ascendente (desempate por created_at).
  const dentro = movs
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

  // Agrupar por día (Map preserva orden de inserción = ascendente).
  const porDia = new Map<string, MovimientoAvicola[]>();
  for (const m of dentro) {
    const f = m.fecha.slice(0, 10);
    const lista = porDia.get(f);
    if (lista) lista.push(m);
    else porDia.set(f, [m]);
  }

  let saldo = saldoInicial;
  let totalVendido = 0;
  let totalAbonado = 0;
  const dias: DiaEstadoCuenta[] = [];

  for (const [fecha, lista] of porDia) {
    const ventas = lista.filter((m) => m.tipo === "venta");
    const abonos = lista.filter((m) => m.tipo === "abono");
    const ventaDelDia = r2(ventas.reduce((a, m) => a + m.monto, 0));
    const abonosDelDia = r2(abonos.reduce((a, m) => a + m.monto, 0));
    const items = ventas.flatMap((v) => v.items ?? []);
    const guias = ventas
      .map((v) => v.numero_guia)
      .filter((n): n is number => n != null);

    const saldoAnterior = saldo;

    // Saldo corriente dentro del día. `lista` ya está ordenada por created_at,
    // por lo que tres abonos del mismo cliente conservan su orden y su saldo
    // posterior individual en vez de colapsarse en una sola cifra.
    let saldoMovimiento = saldoAnterior;
    const abonosDetalle: AbonoDiaEstadoCuenta[] = [];
    for (const movimiento of lista) {
      saldoMovimiento = r2(
        saldoMovimiento +
          (movimiento.tipo === "venta" ? movimiento.monto : -movimiento.monto)
      );
      if (movimiento.tipo === "abono") {
        abonosDetalle.push({
          id: movimiento.id,
          created_at: movimiento.created_at,
          monto: movimiento.monto,
          medio_pago: movimiento.medio_pago,
          observaciones: movimiento.observaciones,
          saldo_posterior: saldoMovimiento,
        });
      }
    }

    saldo = r2(saldo + ventaDelDia - abonosDelDia);
    totalVendido = r2(totalVendido + ventaDelDia);
    totalAbonado = r2(totalAbonado + abonosDelDia);

    dias.push({
      fecha,
      guias,
      items,
      venta_del_dia: ventaDelDia,
      abonos_del_dia: abonosDelDia,
      abonos: abonosDetalle,
      saldo_anterior: saldoAnterior,
      saldo_actual: saldo,
      hay_venta: ventas.length > 0,
      hay_abono: abonos.length > 0,
    });
  }

  return {
    desde,
    hasta,
    saldo_inicial: saldoInicial,
    dias,
    total_vendido: totalVendido,
    total_abonado: totalAbonado,
    saldo_final: saldo,
  };
}
