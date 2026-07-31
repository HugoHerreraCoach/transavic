// Red de seguridad para resolver respuestas temporales de facturas/boletas.
// Solo consulta getStatus/getStatusCdr en lotes pequenos; JAMAS reenvia un CPE.
//
// Corre cada 15 min y SOLO dentro de la ventana de emision (ver
// lib/ventana-operativa.ts). Antes corria cada 5 min las 24 h: como Neon
// auto-suspende recien a los 5 min de silencio, el cron reseteaba el contador justo
// antes de que expirara y la base NUNCA se dormia — el 85% de la factura era estar
// prendida sin trabajo. Lo que quede pendiente fuera de la ventana no se pierde: lo
// levanta la corrida siguiente o el saneo lazy de GET /api/comprobantes.

import {
  comprobantesPendientesDeConciliar,
  conciliarComprobanteSunat,
} from "@/lib/sunat/reconciliacion-cpe";
import { dentroDeVentanaEmision } from "@/lib/ventana-operativa";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET no configurado en el servidor" },
      { status: 503 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Fuera del horario de emision: salimos SIN tocar la base, para que el computo
  // de Neon pueda auto-suspenderse de madrugada. Chequeo puro, sin consultas.
  if (!dentroDeVentanaEmision()) {
    return NextResponse.json({ ok: true, skipped: "fuera de ventana de emision" });
  }

  try {
    // Tres CPE por corrida mantienen el peor caso (getStatus + getStatusCdr,
    // ambos con timeout propio) dentro de maxDuration=60s.
    const ids = await comprobantesPendientesDeConciliar(3);
    const resultados: Array<{
      id: string;
      estado: string;
      ok: boolean;
      error?: string;
    }> = [];

    // Secuencial a proposito: evita una rafaga de consultas al servicio SUNAT.
    for (const id of ids) {
      try {
        const resultado = await conciliarComprobanteSunat(id);
        resultados.push({ id, estado: resultado.estado, ok: true });
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        console.error(`[CRON SUNAT] No se pudo conciliar ${id}:`, error);
        resultados.push({ id, estado: "error_consulta", ok: false, error: mensaje });
      }
    }

    return NextResponse.json({
      ok: resultados.every((resultado) => resultado.ok),
      procesados: resultados.length,
      resultados,
    });
  } catch (error) {
    console.error("Error en cron reconciliar-cpe-sunat:", error);
    return NextResponse.json(
      { error: "Error conciliando comprobantes con SUNAT" },
      { status: 500 }
    );
  }
}
