// Conciliacion de facturas/boletas cuyo envio a SUNAT tuvo respuesta ambigua.
//
// IMPORTANTE: este flujo SOLO CONSULTA getStatus/getStatusCdr. Nunca reenvia,
// reconstruye, firma ni consume correlativos. Puede ejecutarse desde una accion
// manual o desde cron; el claim y los UPDATE condicionales lo hacen idempotente.

import { neon } from "@neondatabase/serverless";
import { getSunatConfig } from "./config-transavic";
import { consultarEstadoCpe } from "./soap-client";
import { EstadoSunat, type EmpresaId } from "./types";
import { aplicarEfectosAceptacionCpe } from "./efectos-aceptacion-cpe";
import { notificarComprobanteConProblema } from "@/lib/notificaciones";

const MINUTOS_PRIMERA_CONSULTA = 15;
const MINUTOS_ENTRE_CONSULTAS = 10;
const MINUTOS_CDR_PENDIENTE = 30;
const MINUTOS_CLAIM_CONSULTA = 2;
const MINUTOS_CLAIM_POSTPROCESO = 5;
const MINUTOS_MIN_ENTRE_NO_EXISTE = 5;
const NO_EXISTE_CONSECUTIVOS_FINAL = 2;

export interface ResultadoConciliacionCpe {
  id: string;
  estado:
    | "por_confirmar"
    | "aceptado"
    | "observado"
    | "rechazado"
    | "anulado"
    | "no_registrado"
    | "error";
  mensaje: string;
  codigoRespuesta: string | null;
  tieneCdr: boolean;
  verificadoAt: string | null;
  proximaConsultaAt: string | null;
  requiereRevision: boolean;
  motivoRevision: string | null;
  definitivo: boolean;
}

export class ConciliacionCpeNoPermitidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConciliacionCpeNoPermitidaError";
  }
}

interface FilaConciliacion {
  id: string;
  ruc_emisor: string;
  empresa: string;
  tipo: string;
  serie: string;
  numero: number;
  serie_numero: string;
  fecha_emision: string | Date;
  monto_total: string | number | null;
  estado: string;
  cdr_base64: string | null;
  sunat_cdr_legible: boolean;
  mensaje_sunat: string | null;
  created_at: string | Date;
  pedido_id: string | null;
  emitido_por: string | null;
  pedido_asesor_id: string | null;
  sunat_codigo_consulta: string | null;
  sunat_ultima_consulta_at: string | Date | null;
  sunat_siguiente_consulta_at: string | Date | null;
  sunat_no_existe_consecutivos: number;
  sunat_requiere_revision: boolean;
  sunat_revision_motivo: string | null;
  sunat_postproceso_estado: string | null;
  sunat_postproceso_at: string | Date | null;
  sunat_postproceso_error: string | null;
}

function iso(value: string | Date | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

function esEstadoDefinitivo(estado: string): boolean {
  return ["aceptado", "observado", "rechazado", "anulado", "no_registrado"].includes(
    estado
  );
}

function respuestaDesdeFila(c: FilaConciliacion): ResultadoConciliacionCpe {
  return {
    id: c.id,
    estado: c.estado as ResultadoConciliacionCpe["estado"],
    mensaje:
      c.mensaje_sunat ||
      (c.estado === "por_confirmar"
        ? "SUNAT todavía está procesando el comprobante. No emitas otro."
        : "Estado consultado."),
    codigoRespuesta: c.sunat_codigo_consulta,
    tieneCdr: !!c.sunat_cdr_legible,
    verificadoAt: iso(c.sunat_ultima_consulta_at),
    proximaConsultaAt: iso(c.sunat_siguiente_consulta_at),
    requiereRevision: !!c.sunat_requiere_revision,
    motivoRevision: c.sunat_revision_motivo,
    definitivo: esEstadoDefinitivo(c.estado),
  };
}

async function cargarFila(id: string): Promise<FilaConciliacion | null> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT
      c.id, c.ruc_emisor, c.empresa, c.tipo, c.serie, c.numero,
      c.serie_numero, c.fecha_emision, c.monto_total,
      c.estado, c.cdr_base64, c.sunat_cdr_legible,
      c.mensaje_sunat,
      c.created_at, c.pedido_id, c.emitido_por,
      c.sunat_codigo_consulta, c.sunat_ultima_consulta_at,
      c.sunat_siguiente_consulta_at, c.sunat_no_existe_consecutivos,
      c.sunat_requiere_revision, c.sunat_revision_motivo,
      c.sunat_postproceso_estado, c.sunat_postproceso_at,
      c.sunat_postproceso_error,
      p.asesor_id AS pedido_asesor_id
    FROM comprobantes c
    LEFT JOIN pedidos p ON p.id = c.pedido_id
    WHERE c.id = ${id}::uuid
    LIMIT 1
  `) as FilaConciliacion[];
  return rows[0] ?? null;
}

async function completarPostprocesoAceptado(
  c: FilaConciliacion
): Promise<void> {
  if (
    !["aceptado", "observado"].includes(c.estado) ||
    !["pendiente", "aplicando"].includes(c.sunat_postproceso_estado ?? "")
  ) {
    return;
  }

  const sql = neon(process.env.DATABASE_URL!);
  const claims = (await sql`
    UPDATE comprobantes
    SET sunat_postproceso_estado = 'aplicando',
        sunat_postproceso_at = NOW()
    WHERE id = ${c.id}::uuid
      AND estado IN ('aceptado', 'observado')
      AND (
        sunat_postproceso_estado = 'pendiente'
        OR (
          sunat_postproceso_estado = 'aplicando'
          AND sunat_postproceso_at < NOW() - make_interval(mins => ${MINUTOS_CLAIM_POSTPROCESO})
        )
      )
    RETURNING id
  `) as Array<{ id: string }>;
  if (claims.length === 0) return;

  try {
    const efecto = await aplicarEfectosAceptacionCpe(c.id);
    await sql`
      UPDATE comprobantes
      SET sunat_postproceso_estado = ${
        efecto.requiereRevision ? "revision" : "aplicado"
      },
          sunat_postproceso_at = NOW(),
          sunat_postproceso_error = NULL,
          sunat_requiere_revision = ${efecto.requiereRevision},
          sunat_revision_motivo = COALESCE(
            ${efecto.motivoRevision ?? null},
            sunat_revision_motivo
          )
      WHERE id = ${c.id}::uuid
        AND sunat_postproceso_estado = 'aplicando'
    `;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE comprobantes
      SET sunat_postproceso_estado = 'pendiente',
          sunat_postproceso_at = NOW(),
          sunat_postproceso_error = ${mensaje.slice(0, 1000)},
          sunat_siguiente_consulta_at = COALESCE(
            sunat_siguiente_consulta_at,
            NOW() + make_interval(mins => ${MINUTOS_ENTRE_CONSULTAS})
          )
      WHERE id = ${c.id}::uuid
        AND sunat_postproceso_estado = 'aplicando'
    `;
    console.error(
      `[SUNAT CONSULTA] ${c.serie_numero} aceptado, pero fallo el enlace interno:`,
      error
    );
  }
}

/**
 * Ejecuta, con claim atomico, los efectos internos de una factura/boleta ya
 * aceptada. Lo usan tanto la respuesta inmediata de sendBill como la
 * conciliacion tardia y el reintento del mismo XML. Centralizar esta entrada
 * evita que dos workers creen o vinculen la misma deuda en paralelo.
 */
export async function completarPostprocesoAceptadoPorId(
  id: string
): Promise<void> {
  const c = await cargarFila(id);
  if (c) await completarPostprocesoAceptado(c);
}

/**
 * Consulta y concilia un CPE 01/03.
 *
 * `forzar` ignora la fecha programada, pero nunca ignora el claim de otra
 * consulta. `incluirError` se usa solo como preflight seguro del reintento
 * historico: consulta primero antes de pensar en reenviar el mismo XML.
 */
export async function conciliarComprobanteSunat(
  id: string,
  opciones: { forzar?: boolean; incluirError?: boolean } = {}
): Promise<ResultadoConciliacionCpe> {
  const sql = neon(process.env.DATABASE_URL!);

  // Una funcion interrumpida tras reservar XML pudo dejar `emitiendo`. A los 15
  // minutos ya no se reenvia: primero pasa al estado consultable.
  await sql`
    UPDATE comprobantes
    SET estado = 'por_confirmar',
        mensaje_sunat =
          'El envío se interrumpió y SUNAT puede haber recibido el comprobante. No emitas otro; el sistema verificará este mismo número.',
        sunat_siguiente_consulta_at = NOW()
    WHERE id = ${id}::uuid
      AND tipo IN ('01', '03')
      AND estado = 'emitiendo'
      AND created_at < NOW() - INTERVAL '15 minutes'
  `;

  let c = await cargarFila(id);
  if (!c) throw new ConciliacionCpeNoPermitidaError("Comprobante no encontrado");
  if (!["01", "03"].includes(c.tipo)) {
    throw new ConciliacionCpeNoPermitidaError(
      "La verificación automática aplica solo a facturas y boletas."
    );
  }

  // Si SUNAT ya quedo aceptado pero la funcion termino antes de aplicar cartera,
  // el cron retoma este paso sin volver a emitir ni depender de otra transicion.
  await completarPostprocesoAceptado(c);
  c = (await cargarFila(id)) ?? c;

  // Consulta Integrada de boletas confirma validez pero no entrega CDR. Solo
  // las facturas F pueden entrar al recuperador SOAP de constancia.
  const aceptadoSinCdr =
    c.tipo === "01" &&
    ["aceptado", "observado"].includes(c.estado) &&
    !c.sunat_cdr_legible;
  const estadoConsultable =
    c.estado === "por_confirmar" ||
    aceptadoSinCdr ||
    (opciones.incluirError === true && c.estado === "error");

  if (!estadoConsultable) return respuestaDesdeFila(c);

  const claimRows = opciones.forzar
    ? ((await sql`
        UPDATE comprobantes
        SET sunat_consulta_claim_at = NOW()
        WHERE id = ${id}::uuid
          AND (
            estado = 'por_confirmar'
            OR (estado IN ('aceptado', 'observado') AND NOT sunat_cdr_legible)
            OR (${opciones.incluirError === true} AND estado = 'error')
          )
          AND (
            sunat_consulta_claim_at IS NULL
            OR sunat_consulta_claim_at < NOW() - make_interval(mins => ${MINUTOS_CLAIM_CONSULTA})
          )
        RETURNING id, sunat_consulta_claim_at
      `) as Array<{
        id: string;
        sunat_consulta_claim_at: string | Date;
      }>)
    : ((await sql`
        UPDATE comprobantes
        SET sunat_consulta_claim_at = NOW()
        WHERE id = ${id}::uuid
          AND (
            estado = 'por_confirmar'
            OR (estado IN ('aceptado', 'observado') AND NOT sunat_cdr_legible)
          )
          AND (
            sunat_siguiente_consulta_at IS NULL
            OR sunat_siguiente_consulta_at <= NOW()
          )
          AND (
            sunat_consulta_claim_at IS NULL
            OR sunat_consulta_claim_at < NOW() - make_interval(mins => ${MINUTOS_CLAIM_CONSULTA})
          )
        RETURNING id, sunat_consulta_claim_at
      `) as Array<{
        id: string;
        sunat_consulta_claim_at: string | Date;
      }>);

  if (claimRows.length === 0) {
    c = (await cargarFila(id)) ?? c;
    return respuestaDesdeFila(c);
  }

  const claimAt = claimRows[0].sunat_consulta_claim_at;

  try {
    const empresa = c.empresa as EmpresaId;
    const config = getSunatConfig(empresa);
    if (config.ruc !== c.ruc_emisor) {
      throw new ConciliacionCpeNoPermitidaError(
        "El RUC guardado no coincide con la empresa emisora configurada."
      );
    }

    const consulta = await consultarEstadoCpe(config, {
      ruc: c.ruc_emisor,
      tipo: c.tipo,
      serie: c.serie,
      numero: c.numero,
      fechaEmision: c.fecha_emision,
      monto: c.monto_total == null ? undefined : Number(c.monto_total),
    });
    const codigo = consulta.codigoRespuesta ?? null;
    const mensajeConsulta =
      consulta.descripcion ??
      consulta.error ??
      "SUNAT todavía no devuelve un resultado definitivo.";

    if (
      consulta.estado === EstadoSunat.ACEPTADA ||
      consulta.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES
    ) {
      const estadoDB =
        consulta.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES
          ? "observado"
          : "aceptado";
      const mensaje =
        consulta.tieneCdr === true
          ? mensajeConsulta
          : c.tipo === "03"
            ? "SUNAT confirmó que la boleta está aceptada. La Consulta Integrada no entrega CDR."
            : "SUNAT confirmó que el comprobante está aceptado. La constancia CDR aún no está disponible y se recuperará automáticamente.";
      const rowsActualizados = (await sql`
        UPDATE comprobantes
        SET estado = ${estadoDB},
            cdr_base64 = COALESCE(${consulta.cdrBase64 ?? null}, cdr_base64),
            sunat_cdr_legible = sunat_cdr_legible OR ${consulta.tieneCdr === true},
            observaciones = COALESCE(${consulta.observaciones?.join(" | ") ?? null}, observaciones),
            mensaje_sunat = ${mensaje},
            sunat_codigo_consulta = ${codigo},
            sunat_ultima_consulta_at = NOW(),
            sunat_siguiente_consulta_at = CASE
              WHEN ${c.tipo === "01"}
                AND NOT (sunat_cdr_legible OR ${consulta.tieneCdr === true})
                THEN NOW() + make_interval(mins => ${MINUTOS_CDR_PENDIENTE})
              ELSE NULL
            END,
            sunat_consultas_count = sunat_consultas_count + 1,
            sunat_no_existe_consecutivos = 0,
            sunat_consulta_claim_at = NULL,
            sunat_postproceso_estado = CASE
              WHEN estado IN ('por_confirmar', 'error') THEN 'pendiente'
              ELSE sunat_postproceso_estado
            END,
            sunat_postproceso_error = CASE
              WHEN estado IN ('por_confirmar', 'error') THEN NULL
              ELSE sunat_postproceso_error
            END
        WHERE id = ${id}::uuid
          AND (
            estado IN ('por_confirmar', 'error')
            OR (estado IN ('aceptado', 'observado') AND NOT sunat_cdr_legible)
          )
        RETURNING id
      `) as Array<{ id: string }>;

      if (rowsActualizados.length > 0) {
        const actualizada = await cargarFila(id);
        if (actualizada) await completarPostprocesoAceptado(actualizada);
      }
    } else if (consulta.estado === EstadoSunat.RECHAZADA) {
      const rowsActualizados = (await sql`
        UPDATE comprobantes
        SET estado = 'rechazado',
            cdr_base64 = COALESCE(${consulta.cdrBase64 ?? null}, cdr_base64),
            sunat_cdr_legible = sunat_cdr_legible OR ${consulta.tieneCdr === true},
            observaciones = COALESCE(${consulta.observaciones?.join(" | ") ?? null}, observaciones),
            mensaje_sunat = ${mensajeConsulta},
            sunat_codigo_consulta = ${codigo},
            sunat_ultima_consulta_at = NOW(),
            sunat_siguiente_consulta_at = NULL,
            sunat_consultas_count = sunat_consultas_count + 1,
            sunat_no_existe_consecutivos = 0,
            sunat_consulta_claim_at = NULL
        WHERE id = ${id}::uuid AND estado IN ('por_confirmar', 'error')
        RETURNING id
      `) as Array<{ id: string }>;
      if (rowsActualizados.length > 0) {
        await notificarComprobanteConProblema({
          comprobanteId: c.id,
          serieNumero: c.serie_numero,
          tipo: c.tipo,
          estado: "RECHAZADA",
          mensajeSunat: mensajeConsulta,
          pedidoId: c.pedido_id,
          empresa: c.empresa,
          asesorId: c.pedido_asesor_id,
        });
      }
    } else if (consulta.estado === EstadoSunat.ANULADA) {
      await sql`
        UPDATE comprobantes
        SET estado = 'anulado',
            mensaje_sunat = ${mensajeConsulta},
            sunat_codigo_consulta = ${codigo},
            sunat_ultima_consulta_at = NOW(),
            sunat_siguiente_consulta_at = NULL,
            sunat_consultas_count = sunat_consultas_count + 1,
            sunat_no_existe_consecutivos = 0,
            sunat_consulta_claim_at = NULL
        WHERE id = ${id}::uuid AND estado IN ('por_confirmar', 'error')
      `;
    } else if (codigo === "0011") {
      const creado = new Date(c.created_at).getTime();
      const yaPasoEspera =
        Number.isFinite(creado) &&
        creado <= Date.now() - MINUTOS_PRIMERA_CONSULTA * 60_000;
      const ultimaConsulta = c.sunat_ultima_consulta_at
        ? new Date(c.sunat_ultima_consulta_at).getTime()
        : Number.NaN;
      const consultaSeparada =
        !Number.isFinite(ultimaConsulta) ||
        ultimaConsulta <=
          Date.now() - MINUTOS_MIN_ENTRE_NO_EXISTE * 60_000;
      // "Verificar ahora" puede pulsarse varias veces. Dos respuestas 0011
      // seguidas en segundos no son dos evidencias independientes.
      // Una respuesta obtenida antes de cumplir la espera inicial NO cuenta
      // como evidencia de ausencia. Tambien limpiamos cualquier conteo temprano
      // para exigir siempre dos consultas independientes despues de los 15 min.
      const siguienteConteo = !yaPasoEspera
        ? 0
        : consultaSeparada
          ? Number(c.sunat_no_existe_consecutivos ?? 0) + 1
          : Number(c.sunat_no_existe_consecutivos ?? 0);
      const noRegistrado =
        yaPasoEspera &&
        consultaSeparada &&
        siguienteConteo >= NO_EXISTE_CONSECUTIVOS_FINAL;
      await sql`
        UPDATE comprobantes
        SET estado = ${noRegistrado ? "no_registrado" : "por_confirmar"},
            mensaje_sunat = ${
              noRegistrado
                ? "En dos consultas separadas, SUNAT no encontró este número. Usa Reintentar envío: se conservará el mismo número. No emitas otro correlativo."
                : "SUNAT aún no encuentra este número. Se verificará otra vez automáticamente; no emitas otro comprobante."
            },
            sunat_codigo_consulta = '0011',
            sunat_ultima_consulta_at = NOW(),
            sunat_siguiente_consulta_at = ${
              noRegistrado ? null : new Date(Date.now() + MINUTOS_ENTRE_CONSULTAS * 60_000)
            },
            sunat_consultas_count = sunat_consultas_count + 1,
            sunat_no_existe_consecutivos = ${siguienteConteo},
            sunat_consulta_claim_at = NULL
        WHERE id = ${id}::uuid AND estado IN ('por_confirmar', 'error')
      `;
    } else {
      // Error al CONSULTAR no cambia el resultado legal. Se conserva incierto y
      // se vuelve a programar; nunca se habilita otro correlativo por un timeout.
      await sql`
        UPDATE comprobantes
        SET estado = 'por_confirmar',
            mensaje_sunat = ${
              consulta.requiereRevision
                ? mensajeConsulta
                : "No se pudo completar la consulta a SUNAT. El sistema volverá a verificar; no emitas otro comprobante."
            },
            sunat_codigo_consulta = ${codigo},
            sunat_ultima_consulta_at = NOW(),
            sunat_siguiente_consulta_at = NOW() + make_interval(mins => ${
              consulta.requiereRevision ? 360 : MINUTOS_ENTRE_CONSULTAS
            }),
            sunat_consultas_count = sunat_consultas_count + 1,
            sunat_no_existe_consecutivos = 0,
            sunat_consulta_claim_at = NULL,
            sunat_requiere_revision = sunat_requiere_revision OR ${
              consulta.requiereRevision === true
            },
            sunat_revision_motivo = CASE
              WHEN ${consulta.requiereRevision === true} THEN ${mensajeConsulta}
              ELSE sunat_revision_motivo
            END
        WHERE id = ${id}::uuid AND estado IN ('por_confirmar', 'error')
      `;
    }
  } finally {
    await sql`
      UPDATE comprobantes
      SET sunat_consulta_claim_at = NULL
      WHERE id = ${id}::uuid
        AND sunat_consulta_claim_at = ${claimAt}
    `.catch((error) => {
      console.error("No se pudo liberar el claim de consulta SUNAT:", error);
    });
  }

  c = (await cargarFila(id)) ?? c;
  return respuestaDesdeFila(c);
}

/** Filas que el cron puede consultar sin recorrer toda la tabla. */
export async function comprobantesPendientesDeConciliar(
  limite = 5
): Promise<string[]> {
  const sql = neon(process.env.DATABASE_URL!);

  // El cron no puede seleccionar una fila `emitiendo`, por eso el saneo debe
  // ocurrir ANTES del SELECT. Si la funcion murio tras enviar el ZIP, se
  // consulta el mismo numero; nunca se reenvia ni se habilita otro correlativo.
  await sql`
    UPDATE comprobantes
    SET estado = 'por_confirmar',
        mensaje_sunat =
          'El envio se interrumpio y SUNAT puede haber recibido el comprobante. No emitas otro; el sistema verificara este mismo numero.',
        sunat_siguiente_consulta_at = NOW()
    WHERE tipo IN ('01', '03')
      AND estado = 'emitiendo'
      AND created_at < NOW() - INTERVAL '15 minutes'
  `;

  const rows = (await sql`
    SELECT id
    FROM comprobantes
    WHERE tipo IN ('01', '03')
      AND (
        (
          estado = 'por_confirmar'
          AND (
            sunat_siguiente_consulta_at IS NULL
            OR sunat_siguiente_consulta_at <= NOW()
          )
        )
        OR (
          estado IN ('aceptado', 'observado')
          AND tipo = '01'
          AND NOT sunat_cdr_legible
          AND (
            sunat_siguiente_consulta_at IS NULL
            OR sunat_siguiente_consulta_at <= NOW()
          )
        )
        OR (
          estado IN ('aceptado', 'observado')
          AND (
            (
              sunat_postproceso_estado = 'pendiente'
              AND (
                sunat_postproceso_at IS NULL
                OR sunat_postproceso_at <=
                  NOW() - make_interval(mins => ${MINUTOS_ENTRE_CONSULTAS})
              )
            )
            OR (
              sunat_postproceso_estado = 'aplicando'
              AND sunat_postproceso_at < NOW() - make_interval(mins => ${MINUTOS_CLAIM_POSTPROCESO})
            )
          )
        )
      )
      AND (
        sunat_consulta_claim_at IS NULL
        OR sunat_consulta_claim_at < NOW() - make_interval(mins => ${MINUTOS_CLAIM_CONSULTA})
      )
    ORDER BY sunat_siguiente_consulta_at NULLS FIRST, created_at
    LIMIT ${Math.max(1, Math.min(10, limite))}
  `) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
