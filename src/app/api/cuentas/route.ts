import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CuentaSchema = z.object({
  nombre: z.string().trim().min(1, "El nombre es obligatorio"),
  tipo: z.enum(["banco", "efectivo", "billetera"]),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  try {
    const cuentas = await sql`
      SELECT id, nombre, tipo, saldo, activa, created_at, updated_at
      FROM cuentas_bancarias
      ORDER BY created_at ASC
    `;
    return NextResponse.json(cuentas);
  } catch (error) {
    console.error("Error al obtener cuentas:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Solo el admin puede crear cuentas" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = CuentaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { nombre, tipo } = parsed.data;

    const sql = neon(process.env.DATABASE_URL!);
    const result = await sql`
      INSERT INTO cuentas_bancarias (nombre, tipo, saldo)
      VALUES (${nombre}, ${tipo}, 0)
      RETURNING id, nombre, tipo, saldo, activa
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error("Error al crear cuenta:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
