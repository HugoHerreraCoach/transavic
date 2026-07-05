// src/app/api/settings/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    const settings = await sql`SELECT key, value FROM settings`;

    const result: Record<string, unknown> = {};
    for (const row of settings) {
      result[row.key as string] = row.value;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error en settings GET:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

const SettingSchema = z.object({
  key: z.enum([
    "base_location",
    "despacho_rutas_bloqueadas",
    "incentivos_config",
    "crm_quick_replies",
    "crm_whatsapp_templates",
    "crm_tags",
    "crm_welcome_bot",
    "crm_lead_distribution"
  ]),
  value: z.any(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = SettingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { key, value } = parsed.data;
    const sql = neon(process.env.DATABASE_URL!);


    await sql`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(value)}::jsonb, updated_at = NOW()
    `;

    return NextResponse.json({ message: "Configuración guardada.", key, value });
  } catch (error) {
    console.error("Error en settings POST:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
