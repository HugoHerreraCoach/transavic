// src/lib/cuadre-pollo.ts
// ÚNICA fuente del Cuadre de Pollo (merma diaria del beneficio).
//
// Replica el cuadre que Marianela llevaba a mano en Excel. NO es un cuadre por
// producto: se compra pollo vivo (1 producto) y se vende en ~20 cortes, así que
// comparar fila por fila es imposible. El cuadre es GLOBAL del día:
//
//   Neto ingresado  = Σ (peso_neto de compras de productos 'vivo' y 'desposte')
//                     − devoluciones
//   Total salida    = Venta Campo + Venta Planta + lo que SALIÓ a corte/delivery
//   Merma real      = Neto ingresado − Total salida
//   Merma esperada  = total de aves × merma estándar por ave (0.32 kg, configurable)
//   DIFERENCIA      = Merma esperada − Merma real   (negativa ⇒ se perdió de más)
//
// REGLA CRÍTICA — no duplicar peso: el cuadre usa la SALIDA FÍSICA a corte (lo que
// Antonio manda picar al acopio), NO lo que las asesoras facturan. Son dos medidas
// del MISMO flujo; sumarlas duplicaría ~30-45% del peso del día. Lo facturado por
// asesoras se muestra aparte, en el control de delivery, para conciliar ambas.
// Si no se digitó la salida a corte, se cae a lo facturado y se avisa en pantalla
// (`usoFacturadoComoSalida`).
//
// Fechas: todos los flujos se anclan al día en que la mercadería SALE físicamente
// (`pedidos.fecha_pedido` es la fecha de ENTREGA — gotcha #8), no al día en que se
// registró la venta.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { leerParametrosNegocio, type ParametrosNegocio } from "@/lib/parametros-negocio";

export interface LineaProveedor {
  proveedor: string;
  jabas: number;
  bruto: number;
  tara: number;
  neto: number;
  /** Los cortes comprados a terceros también entran al pool, pero se distinguen. */
  esVivo: boolean;
  /** true = devolución al proveedor. Va con los pesos en negativo, como en su Excel. */
  esDevolucion: boolean;
}

export interface CuadrePollo {
  fecha: string;

  // --- ENTRADA ---
  proveedores: LineaProveedor[];
  jabas: number;
  kgBruto: number;
  kgTara: number;
  /** Neto de pollo vivo + cortes comprados a terceros, ya restadas las devoluciones. */
  kgNetoIngresado: number;
  /** Cuántas guías de compra tiene el día (0 ⇒ el cuadre no se puede calcular). */
  guiasCompra: number;

  // --- AVES ---
  avesMacho: number;
  avesHembra: number;
  avesTotal: number;
  /** true si las aves las digitó el usuario porque la compra no traía el desglose. */
  avesManuales: boolean;

  // --- SALIDA ---
  kgCampo: number;
  kgPlanta: number;
  kgCorte: number;
  kgCorteEspecial: number;
  kgPolloEntero: number;
  /** Suma de los tres manuales: lo que salió de planta hacia el acopio de delivery. */
  kgSalidaCorte: number;
  kgTotalSalida: number;

  // --- CUADRE ---
  mermaReal: number;
  mermaEsperada: number;
  diferencia: number;
  /** kg de merma por ave. null si no hay aves cargadas. */
  mermaPorAve: number | null;
  mermaPct: number;
  mermaAlta: boolean;
  /** Margen de ruido bajo el cual la diferencia se considera cuadrada (1% del neto). */
  tolerancia: number;
  cuadra: boolean;

  // --- CONTROL DE DELIVERY ---
  kgFacturadoAsesoras: number;
  diferenciaDelivery: number;
  usoFacturadoComoSalida: boolean;

  observaciones: string | null;
  parametros: ParametrosNegocio;
}

/**
 * Merma esperada del beneficio, en kg = total de aves × merma estándar por ave.
 *
 * Es exactamente la fórmula de Marianela: en sus 32 hojas de marzo el cociente
 * (merma esperada / total de aves) da 0.32 EXACTO siempre, aunque ella anote al
 * costado "macho 0.35 / hembra 0.30" — esos son valores de referencia que no
 * entran en su cálculo. Se replica su fórmula para que el número le cuadre.
 */
export function mermaEsperada(
  avesTotal: number,
  p: Pick<ParametrosNegocio, "merma_estandar_ave_kg">
): number {
  return avesTotal > 0 ? avesTotal * p.merma_estandar_ave_kg : 0;
}

/** Redondeo a 2 decimales, para que la pantalla no muestre colas de coma flotante. */
const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Arma el cuadre completo de un día. `fechaIso` en formato YYYY-MM-DD (zona Lima).
 * Es la ÚNICA implementación de la fórmula — no la dupliques en un endpoint nuevo.
 */
export async function construirCuadrePollo(
  sql: NeonQueryFunction<false, false>,
  fechaIso: string
): Promise<CuadrePollo> {
  const parametros = await leerParametrosNegocio(sql);

  // --- ENTRADA: guías de compra del día -------------------------------------
  // Solo productos que entran al pool de pollo: el vivo que se beneficia y los
  // cortes que se compran ya hechos a terceros. Las gallinas/carnes de reventa
  // se cuadran aparte, por producto, en Reportes.
  // Las devoluciones (ci.tipo='devolucion') restan, igual que en su Excel.
  const filasCompra = (await sql`
    SELECT
      COALESCE(pv.razon_social, 'Sin proveedor') AS proveedor,
      pr.origen_fisico,
      COALESCE(ci.tipo, 'ingreso') AS tipo,
      COALESCE(SUM(ci.jabas), 0)::int AS jabas,
      COALESCE(SUM(ci.peso_bruto), 0)::float8 AS bruto,
      COALESCE(SUM(ci.peso_tara), 0)::float8 AS tara,
      COALESCE(SUM(ci.peso_neto), 0)::float8 AS neto,
      COALESCE(SUM(ci.jabas_macho * 7 + ci.sueltos_macho), 0)::int AS aves_macho,
      COALESCE(SUM(ci.jabas_hembra * 9 + ci.sueltos_hembra), 0)::int AS aves_hembra,
      COUNT(DISTINCT c.id)::int AS guias
    FROM compra_items ci
    JOIN compras c ON c.id = ci.compra_id
    JOIN productos pr ON pr.id = ci.producto_id
    LEFT JOIN proveedores pv ON pv.id = c.proveedor_id
    WHERE c.fecha = ${fechaIso}::date
      AND c.estado <> 'Anulado'
      AND pr.origen_fisico IN ('vivo', 'desposte')
    GROUP BY 1, 2, 3
    ORDER BY 3 ASC, 7 DESC
  `) as Array<Record<string, unknown>>;

  // Las devoluciones van como fila propia con los pesos en negativo — igual que la
  // línea "DEV. BENF." de su Excel. Fusionarlas con el ingreso del mismo proveedor
  // daría el total correcto pero le escondería el dato que ella revisa.
  const proveedores: LineaProveedor[] = filasCompra.map((f) => {
    const signo = f.tipo === "devolucion" ? -1 : 1;
    return {
      proveedor: String(f.proveedor),
      jabas: signo * num(f.jabas),
      bruto: r2(signo * num(f.bruto)),
      tara: r2(signo * num(f.tara)),
      neto: r2(signo * num(f.neto)),
      esVivo: f.origen_fisico === "vivo",
      esDevolucion: signo === -1,
    };
  });

  const jabas = proveedores.reduce((a, p) => a + p.jabas, 0);
  const kgBruto = r2(proveedores.reduce((a, p) => a + p.bruto, 0));
  const kgTara = r2(proveedores.reduce((a, p) => a + p.tara, 0));
  const kgNetoIngresado = r2(proveedores.reduce((a, p) => a + p.neto, 0));
  const guiasCompra = filasCompra.reduce((a, f) => a + num(f.guias), 0);
  // Las aves se cuentan solo de los ingresos: una devolución de pollo beneficiado no
  // resta aves del beneficio del día.
  const soloIngresos = filasCompra.filter((f) => f.tipo !== "devolucion");
  const avesMachoCompra = soloIngresos.reduce((a, f) => a + num(f.aves_macho), 0);
  const avesHembraCompra = soloIngresos.reduce((a, f) => a + num(f.aves_hembra), 0);

  // --- SALIDA automática: campo y planta ------------------------------------
  // Solo kg. Los productos que se venden por unidad quedan fuera: sumarlos como
  // si fueran kilos contaminaría la merma (mismo filtro que /api/reportes/salida-carnes).
  const filasSalida = (await sql`
    SELECT
      COALESCE((
        SELECT SUM(vi.peso_kg)
        FROM venta_avicola_items vi
        JOIN ventas_avicola v ON v.id = vi.venta_id
        JOIN productos pr ON pr.id = vi.producto_id
        WHERE v.fecha = ${fechaIso}::date
          AND NOT v.anulada
          AND pr.origen_fisico IN ('vivo', 'desposte')
      ), 0)::float8 AS kg_campo,
      COALESCE((
        SELECT SUM(pi.cantidad)
        FROM pedido_items pi
        JOIN pedidos p ON p.id = pi.pedido_id
        JOIN productos pr ON pr.id = pi.producto_id
        WHERE p.fecha_pedido = ${fechaIso}::date
          AND p.origen = 'pos_planta'
          AND p.estado <> 'Fallido'
          AND NOT COALESCE(p.anulada, FALSE)
          AND pi.unidad IN ('kg', 'KGM')
          AND pr.origen_fisico IN ('vivo', 'desposte')
      ), 0)::float8 AS kg_planta,
      COALESCE((
        SELECT SUM(COALESCE(pi.cantidad_real, pi.cantidad, 0))
        FROM pedido_items pi
        JOIN pedidos p ON p.id = pi.pedido_id
        JOIN productos pr ON pr.id = pi.producto_id
        WHERE p.fecha_pedido = ${fechaIso}::date
          AND COALESCE(p.origen, 'asesor') = 'asesor'
          AND p.estado <> 'Fallido'
          AND NOT COALESCE(p.anulada, FALSE)
          AND pi.unidad IN ('kg', 'KGM')
          AND pr.origen_fisico IN ('vivo', 'desposte')
      ), 0)::float8 AS kg_asesoras
  `) as Array<Record<string, unknown>>;

  const kgCampo = r2(num(filasSalida[0]?.kg_campo));
  const kgPlanta = r2(num(filasSalida[0]?.kg_planta));
  const kgFacturadoAsesoras = r2(num(filasSalida[0]?.kg_asesoras));

  // --- Captura manual del día ------------------------------------------------
  const filasManual = (await sql`
    SELECT aves_macho, aves_hembra, kg_corte, kg_corte_especial, kg_pollo_entero, observaciones
    FROM public.cuadre_pollo_dia
    WHERE fecha = ${fechaIso}::date
  `) as Array<Record<string, unknown>>;
  const manual = filasManual[0];

  const kgCorte = r2(num(manual?.kg_corte));
  const kgCorteEspecial = r2(num(manual?.kg_corte_especial));
  const kgPolloEntero = r2(num(manual?.kg_pollo_entero));
  const kgSalidaCorte = r2(kgCorte + kgCorteEspecial + kgPolloEntero);

  // Las aves de la compra mandan; las manuales solo rellenan cuando no hay desglose.
  const hayAvesEnCompra = avesMachoCompra > 0 || avesHembraCompra > 0;
  const avesMacho = hayAvesEnCompra ? avesMachoCompra : num(manual?.aves_macho);
  const avesHembra = hayAvesEnCompra ? avesHembraCompra : num(manual?.aves_hembra);
  const avesTotal = avesMacho + avesHembra;

  // --- CUADRE ----------------------------------------------------------------
  // Si no se digitó la salida a corte, se usa lo facturado por asesoras como
  // aproximación (y la pantalla lo advierte). Nunca se suman las dos.
  const usoFacturadoComoSalida = kgSalidaCorte === 0 && kgFacturadoAsesoras > 0;
  const salidaDelivery = usoFacturadoComoSalida ? kgFacturadoAsesoras : kgSalidaCorte;
  const kgTotalSalida = r2(kgCampo + kgPlanta + salidaDelivery);

  const mermaReal = r2(kgNetoIngresado - kgTotalSalida);
  const esperada = mermaEsperada(avesTotal, parametros);

  const mermaPct = kgNetoIngresado > 0 ? (mermaReal / kgNetoIngresado) * 100 : 0;

  // Tolerancia: 1% del peso que entró. Pesar ~2 000 kg en balanza de planta tiene
  // ruido de varios kilos, así que una diferencia de 3 kg NO es una alerta — en su
  // Excel ese -3.50 lo daba por cuadrado. Solo se alerta si el faltante la supera.
  const diferencia = r2(esperada - mermaReal);
  const tolerancia = r2(kgNetoIngresado * 0.01);
  const cuadra = diferencia >= -tolerancia;

  return {
    fecha: fechaIso,
    proveedores,
    jabas,
    kgBruto,
    kgTara,
    kgNetoIngresado,
    guiasCompra,
    avesMacho,
    avesHembra,
    avesTotal,
    avesManuales: !hayAvesEnCompra && avesTotal > 0,
    kgCampo,
    kgPlanta,
    kgCorte,
    kgCorteEspecial,
    kgPolloEntero,
    kgSalidaCorte,
    kgTotalSalida,
    mermaReal,
    mermaEsperada: r2(esperada),
    diferencia,
    mermaPorAve: avesTotal > 0 ? r2(mermaReal / avesTotal) : null,
    mermaPct: r2(mermaPct),
    mermaAlta: mermaPct > parametros.merma_alta_pct,
    tolerancia,
    cuadra,
    kgFacturadoAsesoras,
    diferenciaDelivery: r2(kgFacturadoAsesoras - kgSalidaCorte),
    usoFacturadoComoSalida,
    observaciones: (manual?.observaciones as string | null) ?? null,
    parametros,
  };
}
