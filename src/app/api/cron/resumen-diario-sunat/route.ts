// src/app/api/cron/resumen-diario-sunat/route.ts
// Cron de Vercel que envía el Resumen Diario de Boletas (RC-) a SUNAT
// automáticamente al día siguiente de la emisión.
//
// Configurar en vercel.json:
//   { "path": "/api/cron/resumen-diario-sunat", "schedule": "0 7 * * *" }
//   (las 02:00 Lima = 07:00 UTC)
//
// Para cada empresa configurada (transavic, avicola):
//   1. Buscar boletas emitidas AYER
//   2. Si hay alguna, generar RC y enviar a SUNAT
//   3. Loggear ticket recibido (Antonio lo consulta después)
//
// Requiere CRON_SECRET en .env. SUNAT_*_CERT_B64 debe estar configurado.

import { NextResponse } from "next/server";
import { enviarResumenDiario } from "@/lib/sunat/resumen-diario";
import { type EmpresaId } from "@/lib/sunat/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Validar CRON_SECRET (obligatorio)
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET no configurado" },
      { status: 503 }
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Fecha de ayer en zona horaria Lima (las boletas que vamos a resumir)
  const ayer = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const empresas: EmpresaId[] = ["transavic", "avicola"];
  const resultados: Array<Record<string, unknown>> = [];

  // El helper enviarResumenDiario aplica la idempotencia: si ya se envió el
  // resumen de ayer para esta empresa, lo salta (skipped:true) en vez de
  // mandar un RC duplicado a SUNAT.
  for (const empresa of empresas) {
    const r = await enviarResumenDiario({ empresa, fecha: ayer });
    resultados.push({
      empresa,
      ok: r.ok,
      skipped: r.skipped ?? false,
      boletas: r.boletas,
      correlativo: r.correlativo,
      ticket: r.ticket,
      estado: r.estado,
      mensaje: r.mensaje,
      error: r.error,
    });
  }

  return NextResponse.json({
    fecha: ayer,
    timestamp: new Date().toISOString(),
    resultados,
  });
}
