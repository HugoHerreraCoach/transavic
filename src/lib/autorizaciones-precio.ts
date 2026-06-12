// src/lib/autorizaciones-precio.ts
// Control de precio mínimo COMPARTIDO por /api/comprobantes/emitir y
// /emitir-manual (antes cada ruta tenía su bloque inline y EXIGÍA que el
// cliente mandara `autorizacion_id` — si la asesora no entraba al form por el
// link de la notificación, sus autorizaciones aprobadas no servían de nada y
// el sistema la mandaba a solicitar otra: caso Saraí ×3, 12 jun 2026).
//
// Regla: la asesora no puede emitir por debajo de `productos.precio_venta`
// sin una autorización del admin que CUBRA lo que está emitiendo. El servidor:
//   1) si viene `autorizacion_id`, la valida (aprobada, no usada, suya) Y
//      verifica que cubra los ítems — antes la vía explícita era un cheque en
//      blanco: cualquier id aprobado dejaba pasar cualquier ítem/precio;
//   2) si no viene (o no cubre), BUSCA automáticamente una aprobada sin usar
//      de la asesora, de la MISMA empresa y tipo de comprobante, que cubra
//      TODOS los ítems bajo mínimo; prioriza la del mismo cliente;
//   3) solo si no hay ninguna devuelve el 402 de siempre.
//
// "Cubrir" un ítem = mismo nombre normalizado + precio autorizado ≤ precio del
// ítem (+0.005 por redondeo) + cantidad emitida ≤ cantidad autorizada con 10%
// de tolerancia (los pesos reales varían al pesar; sin el tope, una
// autorización de 10 kg validaría 1000 kg al precio rebajado).
import type { NeonQueryFunction } from "@neondatabase/serverless";

export interface ItemControlPrecio {
  nombre: string;
  precioUnitario: number;
  cantidad?: number;
}

export type ResultadoControlPrecio =
  | {
      ok: true;
      /** Autorización a consumir (marcar `usada_at` si la emisión sale bien); null = no hizo falta. */
      autorizacionId: string | null;
    }
  | {
      ok: false;
      status: 402;
      body: { error: "precio_bajo_sin_autorizacion"; producto: string; precio_minimo: number };
    };

interface LineaAutorizada {
  nombre?: string;
  precio_solicitado?: number | string;
  cantidad?: number | string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** ¿La autorización (items_json) cubre todos los ítems bajo mínimo? */
export function cubreItems(itemsJson: unknown, bajos: ItemControlPrecio[]): boolean {
  if (!Array.isArray(itemsJson)) return false;
  const lineas = itemsJson as LineaAutorizada[];
  return bajos.every((item) =>
    lineas.some((l) => {
      if (typeof l.nombre !== "string" || norm(l.nombre) !== norm(item.nombre)) return false;
      const precioAut = Number(l.precio_solicitado);
      if (!(precioAut > 0) || precioAut > item.precioUnitario + 0.005) return false;
      // Cantidad: solo se exige si ambos lados la tienen (tolerancia 10% por
      // pesos reales). Autorizaciones viejas sin cantidad no bloquean.
      const cantAut = Number(l.cantidad);
      const cantItem = Number(item.cantidad);
      if (cantAut > 0 && cantItem > 0 && cantItem > cantAut * 1.1 + 0.01) return false;
      return true;
    })
  );
}

export async function controlarPrecioMinimo(
  sql: NeonQueryFunction<false, false>,
  opts: {
    items: ItemControlPrecio[];
    asesoraId: string;
    autorizacionId?: string | null;
    /** Empresa y tipo de la emisión — el auto-match solo usa autorizaciones del mismo contexto. */
    empresa?: string | null;
    tipo?: string | null;
    /** Documento del cliente: prioriza la autorización pedida para ese cliente. */
    clienteNumDoc?: string | null;
  }
): Promise<ResultadoControlPrecio> {
  // 1) Ítems por debajo del precio mínimo del catálogo.
  const bajos: Array<ItemControlPrecio & { minimo: number }> = [];
  for (const item of opts.items) {
    const prodRows = (await sql`
      SELECT precio_venta FROM productos
      WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(${item.nombre}))
      LIMIT 1
    `) as Array<{ precio_venta: string | null }>;
    const minimo = prodRows[0]?.precio_venta ? Number(prodRows[0].precio_venta) : 0;
    if (minimo > 0 && item.precioUnitario < minimo) {
      bajos.push({ ...item, minimo });
    }
  }
  if (bajos.length === 0) return { ok: true, autorizacionId: null };

  // 2) Autorización enviada explícitamente (link de la notificación / botón
  //    "Emitir con esta autorización"): debe ser suya, aprobada, sin usar Y
  //    cubrir los ítems. Si no cubre, NO cortamos: probamos el auto-match.
  if (opts.autorizacionId) {
    const rows = (await sql`
      SELECT id, items_json FROM autorizaciones_precio
      WHERE id = ${opts.autorizacionId}
        AND asesora_id = ${opts.asesoraId}
        AND estado = 'aprobada'
        AND usada_at IS NULL
      LIMIT 1
    `) as Array<{ id: string; items_json: unknown }>;
    if (rows.length > 0 && cubreItems(rows[0].items_json, bajos)) {
      return { ok: true, autorizacionId: rows[0].id };
    }
  }

  // 3) Auto-match: aprobadas sin usar de la asesora, mismo contexto
  //    (empresa/tipo si vienen); prioriza la del mismo cliente y la más reciente.
  const candidatas = (await sql`
    SELECT id, items_json, cliente_json FROM autorizaciones_precio
    WHERE asesora_id = ${opts.asesoraId}
      AND estado = 'aprobada'
      AND usada_at IS NULL
      AND (${opts.empresa ?? null}::text IS NULL OR empresa = ${opts.empresa ?? null})
      AND (${opts.tipo ?? null}::text IS NULL OR tipo = ${opts.tipo ?? null})
    ORDER BY COALESCE(resuelta_at, created_at) DESC
    LIMIT 20
  `) as Array<{
    id: string;
    items_json: unknown;
    cliente_json: { numDocumento?: string } | null;
  }>;
  const doc = (opts.clienteNumDoc ?? "").trim();
  const ordenadas = doc
    ? [...candidatas].sort((a, b) => {
        const aCli = a.cliente_json?.numDocumento?.trim() === doc ? 0 : 1;
        const bCli = b.cliente_json?.numDocumento?.trim() === doc ? 0 : 1;
        return aCli - bCli;
      })
    : candidatas;
  const match = ordenadas.find((a) => cubreItems(a.items_json, bajos));
  if (match) return { ok: true, autorizacionId: match.id };

  return {
    ok: false,
    status: 402,
    body: {
      error: "precio_bajo_sin_autorizacion",
      producto: bajos[0].nombre,
      precio_minimo: bajos[0].minimo,
    },
  };
}
