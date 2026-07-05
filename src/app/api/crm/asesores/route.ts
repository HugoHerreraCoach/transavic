// src/app/api/crm/asesores/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { role } = session.user;
    if (role !== "admin" && role !== "asesor") {
      return NextResponse.json({ error: "Permiso denegado" }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const asesores = await sql`
      SELECT id, name FROM public.users
      WHERE role = 'asesor' OR role = 'admin'
      ORDER BY name ASC
    `;

    return NextResponse.json({ success: true, asesores });
  } catch (error) {
    console.error("Error al obtener asesores en CRM:", error);
    return NextResponse.json({ error: "Error al cargar asesores" }, { status: 500 });
  }
}
