// src/app/api/clientes/verificar/route.ts
// GET — verificación anti-duplicados de clientes para las asesoras.
//
// ⚠️ ÚNICO endpoint de clientes SIN scoping por asesora: la consulta es GLOBAL
// a propósito (el objetivo es detectar que el prospecto YA es cliente de OTRA
// asesora). Para proteger la cartera, la respuesta es MÍNIMA: solo "existe" +
// el nombre de la asesora responsable + qué campo coincidió. JAMÁS se devuelven
// datos del cliente ajeno (dirección, teléfono, etc.); `cliente_id` solo viaja
// cuando el cliente es de la propia consultante (para ofrecer "usar ese cliente").
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export interface DuplicadoCliente {
  match: "ruc_dni" | "whatsapp" | "nombre";
  exacto: boolean;
  asesora_nombre: string | null;
  es_mio: boolean;
  cliente_id: string | null;
  cliente_nombre: string | null; // solo si es_mio
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["admin", "asesor"].includes(session.user.role)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rucDni = (searchParams.get("ruc_dni") || "").trim();
    const whatsapp = (searchParams.get("whatsapp") || "").replace(/\D/g, "");
    const nombre = (searchParams.get("nombre") || "").trim();

    if (!rucDni && whatsapp.length < 6 && nombre.length < 3) {
      return NextResponse.json({ duplicados: [] });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const userId = session.user.id;
    const duplicados: DuplicadoCliente[] = [];

    // RUC/DNI — match exacto
    if (rucDni) {
      const rows = await sql`
        SELECT c.id, c.nombre, c.asesor_id, u.name AS asesor_name
        FROM clientes c LEFT JOIN users u ON u.id = c.asesor_id
        WHERE TRIM(COALESCE(c.ruc_dni, '')) = ${rucDni}
        LIMIT 3
      `;
      for (const r of rows) {
        const esMio = r.asesor_id === userId;
        duplicados.push({
          match: "ruc_dni",
          exacto: true,
          asesora_nombre: (r.asesor_name as string | null)?.trim() || null,
          es_mio: esMio,
          cliente_id: esMio ? (r.id as string) : null,
          cliente_nombre: esMio ? (r.nombre as string) : null,
        });
      }
    }

    // WhatsApp — match exacto por los últimos 9 dígitos (celular peruano, tolera +51)
    if (whatsapp.length >= 6) {
      const norm = whatsapp.slice(-9);
      const rows = await sql`
        SELECT c.id, c.nombre, c.asesor_id, u.name AS asesor_name
        FROM clientes c LEFT JOIN users u ON u.id = c.asesor_id
        WHERE RIGHT(regexp_replace(COALESCE(c.whatsapp, ''), '\\D', '', 'g'), 9) = ${norm}
          AND LENGTH(regexp_replace(COALESCE(c.whatsapp, ''), '\\D', '', 'g')) >= 6
        LIMIT 3
      `;
      for (const r of rows) {
        const esMio = r.asesor_id === userId;
        if (duplicados.some((d) => d.es_mio === esMio && d.match === "ruc_dni")) continue;
        duplicados.push({
          match: "whatsapp",
          exacto: true,
          asesora_nombre: (r.asesor_name as string | null)?.trim() || null,
          es_mio: esMio,
          cliente_id: esMio ? (r.id as string) : null,
          cliente_nombre: esMio ? (r.nombre as string) : null,
        });
      }
    }

    // Nombre — match blando (solo alerta, nunca bloquea)
    if (nombre.length >= 3 && duplicados.length === 0) {
      const rows = await sql`
        SELECT c.id, c.nombre, c.asesor_id, u.name AS asesor_name
        FROM clientes c LEFT JOIN users u ON u.id = c.asesor_id
        WHERE c.nombre ILIKE ${"%" + nombre + "%"}
        LIMIT 3
      `;
      for (const r of rows) {
        const esMio = r.asesor_id === userId;
        duplicados.push({
          match: "nombre",
          exacto: false,
          asesora_nombre: (r.asesor_name as string | null)?.trim() || null,
          es_mio: esMio,
          cliente_id: esMio ? (r.id as string) : null,
          cliente_nombre: esMio ? (r.nombre as string) : null,
        });
      }
    }

    return NextResponse.json({ duplicados });
  } catch (error) {
    console.error("Error en GET /api/clientes/verificar:", error);
    return NextResponse.json({ error: "Error al verificar el cliente" }, { status: 500 });
  }
}
