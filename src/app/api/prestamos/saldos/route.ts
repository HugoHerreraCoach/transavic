// src/app/api/prestamos/saldos/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // Obtener todos los saldos cruzando con proveedores y productos
    const saldos = await sql`
      SELECT 
        ps.id,
        ps.proveedor_id,
        prov.razon_social AS proveedor_nombre,
        ps.producto_id,
        prod.nombre AS producto_nombre,
        ps.jabas,
        ps.peso_kg,
        ps.updated_at
      FROM prestamos_saldos ps
      JOIN proveedores prov ON ps.proveedor_id = prov.id
      JOIN productos prod ON ps.producto_id = prod.id
      ORDER BY prov.razon_social, prod.nombre
    `;

    return NextResponse.json({ saldos });
  } catch (error: unknown) {
    console.error("Error obteniendo saldos de préstamos:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
  }
}
