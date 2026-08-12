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
//
// ⚠️ ENVÍO APAGADO POR DEFECTO (11 ago 2026). Corre en modo SIMULACIÓN salvo que
// `SUNAT_RESUMEN_DIARIO_AUTO="true"`. Motivo: se verificó que las 579 boletas
// aceptadas tienen CDR legible, o sea que SUNAT ya las registra una por una vía
// sendBill; volver a declararlas en un RC sería una declaración repetida.
// Además este cron nunca completó una corrida (ver más abajo), así que
// encenderlo de golpe mandaría a SUNAT algo que nadie ha visto nunca.
// Decisión de Hugo; confirmar con el contador antes de encenderlo.

import { NextResponse } from "next/server";
import { enviarResumenDiario, sanearResumenesColgados } from "@/lib/sunat/resumen-diario";
import { type EmpresaId } from "@/lib/sunat/types";

export const dynamic = "force-dynamic";
// Firmar el XML y hablar con SUNAT no entra en el timeout por defecto de Vercel.
// Sin esto (hasta el 11 ago 2026) la función moría DESPUÉS de crear la fila
// 'enviando' y ANTES del catch: 60 corridas seguidas fallaron sin dejar rastro.
export const maxDuration = 60;

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

  // Cierra las filas que una corrida anterior dejó colgadas en 'enviando' para
  // que un fallo quede visible en vez de parecer "en curso" para siempre.
  let saneadas = 0;
  try {
    saneadas = await sanearResumenesColgados();
  } catch (err) {
    console.warn("[resumen-diario] No se pudieron sanear filas colgadas:", err);
  }

  // Simulación salvo que se active explícitamente (ver cabecera del archivo).
  const envioAutomatico = process.env.SUNAT_RESUMEN_DIARIO_AUTO === "true";

  // El helper enviarResumenDiario aplica la idempotencia: si ya se envió el
  // resumen de ayer para esta empresa, lo salta (skipped:true) en vez de
  // mandar un RC duplicado a SUNAT.
  //
  // Cada empresa va en su propio try/catch: antes iban en serie y sin proteger,
  // así que un fallo (o el timeout) de transavic dejaba a avicola sin correr —
  // por eso en 70 días avicola solo generó UNA fila.
  for (const empresa of empresas) {
    try {
      const r = await enviarResumenDiario({
        empresa,
        fecha: ayer,
        dryRun: !envioAutomatico,
      });
      resultados.push({
        empresa,
        ok: r.ok,
        skipped: r.skipped ?? false,
        dryRun: r.dryRun ?? false,
        boletas: r.boletas,
        correlativo: r.correlativo,
        ticket: r.ticket,
        estado: r.estado,
        mensaje: r.mensaje,
        error: r.error,
      });
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err);
      console.error(`[resumen-diario] Falló la empresa ${empresa}:`, mensaje);
      resultados.push({ empresa, ok: false, error: mensaje });
    }
  }

  return NextResponse.json({
    fecha: ayer,
    timestamp: new Date().toISOString(),
    envioAutomatico,
    filasColgadasSaneadas: saneadas,
    resultados,
  });
}
