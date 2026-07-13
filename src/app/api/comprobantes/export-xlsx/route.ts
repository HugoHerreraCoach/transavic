// src/app/api/comprobantes/export-xlsx/route.ts
// Exporta comprobantes como reporte contable .xlsx multi-hoja (para el contador).
//
// Reporte "inteligente" (mayo 2026, portado de conexipema-eventos):
//   - Filtra por RANGO DE FECHAS (?desde&hasta) sobre fecha_emision; usa
//     created_at en Lima solo como fallback para registros legacy sin esa fecha.
//   - Respeta los filtros de la lista (tipo, empresa, cliente_doc_num).
//   - Hojas: Resumen · Registro de Ventas · Boletas · Facturas · Notas de Crédito.
//   - NC restan; rechazado/error/anulado fuera de las sumas.
//
// Scope por rol: admin ve todo; asesor solo los comprobantes de sus pedidos.

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import {
  generarBufferReporteComprobantes,
  type FilaComprobante,
  type PeriodoReporte,
} from "@/lib/sunat/reporte-excel-comprobantes";

export const dynamic = "force-dynamic";

/** Valida YYYY-MM-DD. */
const esFecha = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** DD/MM/YYYY para etiquetas legibles. */
function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== "admin" && role !== "asesor") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo"); // "01" | "03" | "07" | null
  const empresa = searchParams.get("empresa"); // "transavic" | "avicola" | null
  const clienteDocNum = searchParams.get("cliente_doc_num")?.trim();
  const desdeRaw = searchParams.get("desde"); // YYYY-MM-DD | null
  const hastaRaw = searchParams.get("hasta"); // YYYY-MM-DD | null
  const operacionRaw = searchParams.get("operacion");
  const operacionesValidas = ["ejecutivas", "campo", "planta"] as const;
  if (
    operacionRaw !== null &&
    !operacionesValidas.includes(
      operacionRaw as (typeof operacionesValidas)[number]
    )
  ) {
    return NextResponse.json(
      { error: "Filtro de operación inválido." },
      { status: 400 }
    );
  }
  const operacion = operacionRaw as
    | (typeof operacionesValidas)[number]
    | null;

  const sql = neon(process.env.DATABASE_URL!);

  // Query dinámica (mismo patrón que GET /api/comprobantes).
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (role === "asesor") {
    conditions.push(
      `(COALESCE(c.pedido_id, ref.pedido_id) IN
          (SELECT id FROM pedidos WHERE asesor_id = $${i})
        OR LOWER(TRIM(c.emitido_por)) = LOWER(TRIM($${i + 1})))`
    );
    params.push(userId, session.user.name ?? "");
    i += 2;
  }
  if (tipo && (tipo === "01" || tipo === "03" || tipo === "07" || tipo === "08")) {
    conditions.push(`c.tipo = $${i++}`);
    params.push(tipo);
  }
  if (empresa && (empresa === "transavic" || empresa === "avicola")) {
    conditions.push(`c.empresa = $${i++}`);
    params.push(empresa);
  }
  if (clienteDocNum && /^\d{8,11}$/.test(clienteDocNum)) {
    conditions.push(`c.cliente_doc_num = $${i++}`);
    params.push(clienteDocNum);
  }
  // El origen se deriva igual que en GET /api/comprobantes. Las NC heredan del
  // comprobante referenciado; Campo prima sobre cualquier pedido accidental.
  const ventaCampoExpr =
    "COALESCE(c.venta_avicola_id, ref.venta_avicola_id)";
  const origenPedidoExpr = "COALESCE(p.origen, pref.origen)";
  if (operacion === "campo") {
    conditions.push(`${ventaCampoExpr} IS NOT NULL`);
  } else if (operacion === "planta") {
    conditions.push(
      `${ventaCampoExpr} IS NULL AND ${origenPedidoExpr} = 'pos_planta'`
    );
  } else if (operacion === "ejecutivas") {
    conditions.push(
      `${ventaCampoExpr} IS NULL AND (${origenPedidoExpr} IS NULL OR ${origenPedidoExpr} <> 'pos_planta')`
    );
  }
  // Rango de fechas: comparamos por la fecha de emisión REAL del comprobante
  // (fecha_emision, que puede ser retroactiva) con fallback a created_at en zona
  // Lima — así un comprobante con fecha retroactiva cae en el período correcto.
  if (esFecha(desdeRaw)) {
    conditions.push(
      `COALESCE(c.fecha_emision, (c.created_at AT TIME ZONE 'America/Lima')::date) >= $${i++}`
    );
    params.push(desdeRaw);
  }
  if (esFecha(hastaRaw)) {
    conditions.push(
      `COALESCE(c.fecha_emision, (c.created_at AT TIME ZONE 'America/Lima')::date) <= $${i++}`
    );
    params.push(hastaRaw);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = (await sql.query(
    `SELECT c.serie, c.numero, c.serie_numero, c.tipo, c.empresa,
            c.cliente_doc_tipo, c.cliente_doc_num, c.cliente_razon_social,
            c.monto_subtotal, c.monto_igv, c.monto_total,
            c.estado, c.mensaje_sunat, c.created_at, c.fecha_emision, c.forma_pago, c.fecha_vencimiento
     FROM comprobantes c
     LEFT JOIN comprobantes ref ON ref.id = c.referencia_comprobante_id
     LEFT JOIN pedidos p ON p.id = c.pedido_id
     LEFT JOIN pedidos pref ON pref.id = ref.pedido_id
     ${where}
     ORDER BY COALESCE(c.fecha_emision, (c.created_at AT TIME ZONE 'America/Lima')::date) ASC, c.created_at ASC
     LIMIT 10000`,
    params
  )) as FilaComprobante[];

  // Etiqueta del período para el encabezado de las hojas + el nombre de archivo.
  const periodo: PeriodoReporte = (() => {
    if (esFecha(desdeRaw) && esFecha(hastaRaw)) {
      return {
        desde: desdeRaw,
        hasta: hastaRaw,
        etiqueta: `${ddmmyyyy(desdeRaw)} al ${ddmmyyyy(hastaRaw)}`,
      };
    }
    if (esFecha(desdeRaw)) {
      return { desde: desdeRaw, hasta: "hoy", etiqueta: `desde ${ddmmyyyy(desdeRaw)}` };
    }
    if (esFecha(hastaRaw)) {
      return { desde: "inicio", hasta: hastaRaw, etiqueta: `hasta ${ddmmyyyy(hastaRaw)}` };
    }
    return { desde: "todo", hasta: "todo", etiqueta: "Todos los comprobantes" };
  })();

  const buf = generarBufferReporteComprobantes(rows, periodo);

  // Nombre de archivo: incluye el rango para que el contador lo identifique.
  const slug =
    periodo.desde === "todo"
      ? new Date().toISOString().slice(0, 10)
      : `${periodo.desde}_al_${periodo.hasta}`;
  const filename = `reporte-comprobantes${operacion ? `-${operacion}` : ""}-${slug}.xlsx`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
    },
  });
}
