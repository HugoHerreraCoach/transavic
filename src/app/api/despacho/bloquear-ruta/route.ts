// src/app/api/despacho/bloquear-ruta/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { fechaHoyLima } from "@/lib/sunat/fechas";

export const dynamic = "force-dynamic";

const BloquearRutaSchema = z.object({
  repartidor_id: z.string().uuid("ID de repartidor inválido."),
  bloquear: z.boolean(),
});

interface RutasBloqueadasConfig {
  fecha: string;
  bloqueados: string[];
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = BloquearRutaSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { repartidor_id, bloquear } = parsed.data;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);
    const hoy = fechaHoyLima();

    // 1. Cargar estado actual
    const configResult = await sql`
      SELECT value FROM settings WHERE key = 'despacho_rutas_bloqueadas'
    `;

    const config: RutasBloqueadasConfig = {
      fecha: hoy,
      bloqueados: [],
    };

    if (configResult.length > 0) {
      const val = configResult[0].value as Partial<RutasBloqueadasConfig>;
      if (val.fecha === hoy) {
        config.bloqueados = Array.isArray(val.bloqueados) ? val.bloqueados : [];
      }
    }

    // 2. Modificar bloqueados
    const bloqueadosSet = new Set(config.bloqueados);
    if (bloquear) {
      bloqueadosSet.add(repartidor_id);
    } else {
      bloqueadosSet.delete(repartidor_id);
    }

    config.bloqueados = Array.from(bloqueadosSet);

    // 3. Persistir en base de datos
    await sql`
      INSERT INTO settings (key, value)
      VALUES ('despacho_rutas_bloqueadas', ${JSON.stringify(config)})
      ON CONFLICT (key)
      DO UPDATE SET value = ${JSON.stringify(config)}
    `;

    return NextResponse.json({
      message: bloquear ? "Ruta bloqueada exitosamente." : "Ruta desbloqueada exitosamente.",
      bloqueados: config.bloqueados,
    });
  } catch (error) {
    console.error("Error al bloquear ruta:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
