import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const TransaccionSchema = z.object({
  cuenta_id: z.string().uuid(),
  tipo: z.enum(["ingreso", "egreso"]),
  monto: z.number().positive(),
  concepto: z.string().min(2),
  referencia_id: z.string().uuid().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = TransaccionSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { cuenta_id, tipo, monto, concepto, referencia_id } = result.data;
    const usuario_id = session.user.id;

    const sql = neon(process.env.DATABASE_URL!);
    
    // Necesitamos asegurarnos de actualizar el saldo y registrar la transacción.
    // Usaremos unpooled para soportar la transacción si es necesario, 
    // pero con HTTP neon driver, las transacciones explícitas (BEGIN/COMMIT) requieren endpoints especiales o queries múltiples en una.
    // Lo más seguro es usar un CTE o una query encadenada para actualizar el saldo y luego insertar.
    
    // Neon HTTP client permite arrays de queries o múltiples statements si se envían juntos, 
    // pero la forma más segura atómica es un CTE en PostgreSQL:
    const res = await sql`
      WITH update_cuenta AS (
        UPDATE cuentas_bancarias
        SET saldo = saldo + CASE WHEN ${tipo} = 'ingreso' THEN ${monto} ELSE -${monto} END,
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${cuenta_id}
        RETURNING id
      )
      INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto, referencia_id)
      SELECT id, ${usuario_id}, ${tipo}, ${monto}, ${concepto}, ${referencia_id || null}
      FROM update_cuenta
      RETURNING *;
    `;

    if (res.length === 0) {
      return NextResponse.json({ error: "Cuenta no encontrada o error al actualizar" }, { status: 404 });
    }

    return NextResponse.json(res[0], { status: 201 });
  } catch (error) {
    console.error("Error al registrar transacción:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
