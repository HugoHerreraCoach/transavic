// src/app/api/gastos/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateGastoSchema = z.object({
  fecha: z.string().min(1),
  categoria: z.string().min(1),
  descripcion: z.string().optional().nullable(),
  monto: z.number().positive(),
  cuenta_id: z.string().uuid(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // Los gastos son información sensible del negocio: solo quien gestiona la caja.
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no definida");
  const sql = neon(connectionString);

  try {
    const list = await sql`
      SELECT g.id, TO_CHAR(g.fecha, 'DD/MM/YYYY') as fecha_formateada, g.categoria, g.descripcion, g.monto, g.metodo_pago,
             u.name as created_by_name
      FROM gastos g
      LEFT JOIN users u ON g.created_by = u.id
      ORDER BY g.fecha DESC, g.created_at DESC
      LIMIT 50
    `;
    return NextResponse.json(list.map(g => ({
      ...g,
      monto: Number(g.monto)
    })));
  } catch (error) {
    console.error("Error en GET /api/gastos:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado para registrar gastos" }, { status: 403 });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no definida");
  const sql = neon(connectionString);

  try {
    const body = await req.json();
    const parsed = CreateGastoSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos de gasto inválidos", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { fecha, categoria, descripcion, monto, cuenta_id } = parsed.data;

    // 1. Obtener detalles de la cuenta bancaria / caja chica
    const accounts = await sql`
      SELECT id, nombre, saldo FROM cuentas_bancarias WHERE id = ${cuenta_id} LIMIT 1
    `;
    if (accounts.length === 0) {
      return NextResponse.json({ error: "La cuenta de origen no existe" }, { status: 400 });
    }

    const cuentaNombre = accounts[0].nombre;

    // 2. Insertar el Gasto
    const insertedGasto = await sql`
      INSERT INTO gastos (fecha, categoria, descripcion, monto, metodo_pago, created_by)
      VALUES (${fecha}::date, ${categoria}, ${descripcion || null}, ${monto}, ${cuentaNombre}, ${session.user.id})
      RETURNING id
    `;
    const gasto_id = insertedGasto[0].id;

    // 3. Descontar saldo de la cuenta bancaria / caja
    await sql`
      UPDATE cuentas_bancarias
      SET saldo = saldo - ${monto},
          updated_at = (NOW() AT TIME ZONE 'America/Lima')
      WHERE id = ${cuenta_id}
    `;

    // 4. Registrar la transacción en el ledger general
    const conceptoTransaccion = `Gasto: ${categoria}` + (descripcion ? ` - ${descripcion}` : "");
    await sql`
      INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto, referencia_id)
      VALUES (${cuenta_id}, ${session.user.id}, 'egreso', ${monto}, ${conceptoTransaccion}, ${gasto_id})
    `;

    return NextResponse.json({ message: "Gasto registrado exitosamente", gasto_id }, { status: 201 });
  } catch (error) {
    console.error("Error en POST /api/gastos:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
