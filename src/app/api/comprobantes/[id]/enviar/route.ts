// src/app/api/comprobantes/[id]/enviar/route.ts
// Envía el comprobante (PDF + XML adjuntos) por email.
//
// Body JSON:
//   { "to": "cliente@ejemplo.com", "cc"?: "...", "mensaje"?: "texto personalizado" }
//
// El PDF se genera client-side y se envía en el request como base64 en
// `pdfBase64` (porque la lógica de PDF usa jsPDF que es browser-only).
//
// Body JSON completo:
//   {
//     "to": "cliente@ejemplo.com",
//     "pdfBase64": "<base64 del PDF generado en cliente>",
//     "cc"?: "...",
//     "mensaje"?: "texto personalizado",
//     "incluirXML"?: true
//   }

import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendEmail, isEmailConfigured } from "@/lib/email";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  to: z.string().email("Email destino inválido"),
  // Límite: 7MB de base64 ≈ 5MB de PDF binario. Vercel Hobby limita request a
  // 4.5MB y Pro a ~6MB. Sin este max, una asesora podría mandar 50MB y agotar
  // quota SMTP o convertir el servidor en remailer abuso.
  pdfBase64: z
    .string()
    .min(100, "PDF base64 requerido")
    .max(7_000_000, "PDF demasiado grande (máx ~5MB)"),
  cc: z.string().email().optional(),
  mensaje: z.string().max(2000).optional(),
  incluirXML: z.boolean().default(true),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      {
        error:
          "Email no configurado. Avisar a Hugo para configurar SMTP.",
      },
      { status: 503 }
    );
  }

  const role = session.user.role;
  if (role !== "admin" && role !== "asesor") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const userId = session.user.id;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  let body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Datos inválidos", detalle: (err as Error).message },
      { status: 400 }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);
  // Privacy boundary: solo el dueño del pedido (asesor) o admin puede enviar
  const rows = (role === "admin"
    ? ((await sql`
        SELECT c.serie_numero, c.ruc_emisor, c.tipo, c.empresa, c.monto_total,
               c.cliente_razon_social, c.xml_firmado_base64
        FROM comprobantes c
        WHERE c.id = ${id}::uuid LIMIT 1
      `) as unknown)
    : ((await sql`
        SELECT c.serie_numero, c.ruc_emisor, c.tipo, c.empresa, c.monto_total,
               c.cliente_razon_social, c.xml_firmado_base64
        FROM comprobantes c
        INNER JOIN pedidos p ON p.id = c.pedido_id
        WHERE c.id = ${id}::uuid AND p.asesor_id = ${userId}::uuid LIMIT 1
      `) as unknown)) as Array<{
    serie_numero: string;
    ruc_emisor: string;
    tipo: string;
    empresa: string;
    monto_total: string | number;
    cliente_razon_social: string | null;
    xml_firmado_base64: string | null;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Comprobante no encontrado" }, { status: 404 });
  }
  const c = rows[0];
  const tipoLabel = c.tipo === "01" ? "Factura" : c.tipo === "03" ? "Boleta" : "Comprobante";
  const empresaLabel = c.empresa === "transavic" ? "Transavic" : "Avícola de Tony";

  // Armar adjuntos
  const attachments = [
    {
      filename: `${c.ruc_emisor}-${c.tipo}-${c.serie_numero}.pdf`,
      content: body.pdfBase64,
      encoding: "base64" as const,
      contentType: "application/pdf",
    },
  ];

  if (body.incluirXML && c.xml_firmado_base64) {
    attachments.push({
      filename: `${c.ruc_emisor}-${c.tipo}-${c.serie_numero}.xml`,
      content: c.xml_firmado_base64,
      encoding: "base64" as const,
      contentType: "application/xml",
    });
  }

  const subject = `${tipoLabel} Electrónica ${c.serie_numero} — ${empresaLabel}`;
  const mensajeUsuario = body.mensaje || "";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #dc2626; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">🐔 ${empresaLabel}</h1>
        <p style="margin: 8px 0 0 0; opacity: 0.95;">${tipoLabel} Electrónica</p>
      </div>
      <div style="padding: 24px; background: #f9fafb;">
        <p>Estimado/a ${c.cliente_razon_social || "Cliente"},</p>
        <p>Adjuntamos su ${tipoLabel.toLowerCase()} electrónica:</p>
        <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 16px 0;">
          <table style="width: 100%; font-size: 14px;">
            <tr><td style="color: #6b7280;">Número:</td><td style="text-align: right; font-family: monospace; font-weight: bold;">${c.serie_numero}</td></tr>
            <tr><td style="color: #6b7280;">Tipo:</td><td style="text-align: right;">${tipoLabel}</td></tr>
            <tr><td style="color: #6b7280;">Monto total:</td><td style="text-align: right; font-weight: bold; color: #dc2626;">S/ ${Number(c.monto_total).toFixed(2)}</td></tr>
          </table>
        </div>
        ${mensajeUsuario ? `<p style="background: #fef3c7; padding: 12px; border-radius: 6px; border-left: 4px solid #f59e0b;">${mensajeUsuario.replace(/\n/g, "<br/>")}</p>` : ""}
        <p style="margin-top: 24px;">📎 Encontrará el PDF${body.incluirXML && c.xml_firmado_base64 ? " y el archivo XML firmado" : ""} en los adjuntos de este correo.</p>
        <p>Cualquier consulta, no dude en responder este correo.</p>
        <p style="margin-top: 32px;">Saludos cordiales,<br/><strong>${empresaLabel}</strong></p>
      </div>
      <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 11px;">
        Este correo fue enviado automáticamente desde el sistema de facturación electrónica.
      </div>
    </div>
  `;

  const text = `${tipoLabel} Electrónica ${c.serie_numero}

Estimado/a ${c.cliente_razon_social || "Cliente"},

Adjuntamos su ${tipoLabel.toLowerCase()} electrónica:
  • Número: ${c.serie_numero}
  • Monto total: S/ ${Number(c.monto_total).toFixed(2)}

${mensajeUsuario ? mensajeUsuario + "\n\n" : ""}Encontrará el PDF${body.incluirXML && c.xml_firmado_base64 ? " y el archivo XML firmado" : ""} en los adjuntos.

Saludos cordiales,
${empresaLabel}`;

  const result = await sendEmail({
    to: body.to,
    cc: body.cc,
    subject,
    html,
    text,
    attachments,
  });

  if (!result.exito) {
    return NextResponse.json(
      { error: result.error || "Falló el envío del email" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    exito: true,
    messageId: result.messageId,
    enviadoA: body.to,
    cc: body.cc,
    adjuntos: attachments.map((a) => a.filename),
  });
}
