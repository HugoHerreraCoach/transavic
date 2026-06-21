// src/app/api/despacho/reordenar/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { fechaHoyLima } from "@/lib/sunat/fechas";

const ReordenarSchema = z.object({
  repartidor_id: z.string().uuid(),
  orden: z.array(z.object({
    pedido_id: z.string().uuid(),
    orden_ruta: z.number().int().positive(),
  })),
});

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = ReordenarSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { repartidor_id, orden } = parsed.data;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    // Verificar si la ruta del repartidor está bloqueada
    const hoy = fechaHoyLima();
    const configResult = await sql`SELECT value FROM settings WHERE key = 'despacho_rutas_bloqueadas'`;
    if (configResult.length > 0) {
      const val = configResult[0].value as { fecha: string; bloqueados: string[] };
      if (val.fecha === hoy && Array.isArray(val.bloqueados) && val.bloqueados.includes(repartidor_id)) {
        return NextResponse.json(
          { error: "La ruta de este repartidor está bloqueada por el administrador." },
          { status: 409 }
        );
      }
    }

    for (const item of orden) {
      await sql`
        UPDATE pedidos
        SET orden_ruta = ${item.orden_ruta}
        WHERE id = ${item.pedido_id}
          AND repartidor_id = ${repartidor_id}
      `;
    }

    return NextResponse.json({ message: "Ruta reordenada exitosamente." });
  } catch (error) {
    console.error("Error al reordenar ruta:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
