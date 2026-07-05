// src/app/api/caja-diaria/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Validación de apertura
const AperturaSchema = z.object({
  monto_apertura: z.number().min(0),
});

// Validación de cierre
const CierreSchema = z.object({
  monto_cierre_real: z.number().min(0),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no definida");
  const sql = neon(connectionString);

  try {
    // 1. Buscar caja abierta
    const activeBoxes = await sql`
      SELECT id, fecha, monto_apertura, estado, abierta_por, abierta_at, cuenta_id
      FROM caja_diaria
      WHERE estado = 'Abierta'
      LIMIT 1
    `;

    let activeBox = null;

    if (activeBoxes.length > 0) {
      const box = activeBoxes[0];
      const abiertaAt = box.abierta_at;

      // La cuenta de la caja: la fijada al abrir (cuenta_id); fallback por nombre
      // para cajas abiertas antes de la migración migrate-caja-cuenta-id.sql.
      let cashAccountId = box.cuenta_id as string | null;
      if (!cashAccountId) {
        const cashAccounts = await sql`
          SELECT id FROM cuentas_bancarias WHERE nombre = 'Caja Efectivo Planta' LIMIT 1
        `;
        cashAccountId = cashAccounts[0]?.id ?? null;
      }

      let ingresos = 0;
      let egresos = 0;
      let transacciones: Record<string, unknown>[] = [];

      if (cashAccountId) {
        // Calcular ingresos en efectivo desde la apertura
        const ingResult = await sql`
          SELECT COALESCE(SUM(monto), 0) as total
          FROM transacciones
          WHERE cuenta_id = ${cashAccountId}
            AND tipo = 'ingreso'
            AND concepto <> 'Apertura de Caja'
            AND created_at >= ${abiertaAt}
        `;
        ingresos = Number(ingResult[0].total);

        // Calcular egresos en efectivo desde la apertura
        const egrResult = await sql`
          SELECT COALESCE(SUM(monto), 0) as total
          FROM transacciones
          WHERE cuenta_id = ${cashAccountId}
            AND tipo = 'egreso'
            AND created_at >= ${abiertaAt}
        `;
        egresos = Number(egrResult[0].total);

        // Obtener transacciones generales del día para desglose (efectivo y bancos)
        transacciones = await sql`
          SELECT t.id, t.monto, t.tipo, t.concepto, t.created_at, cb.nombre as cuenta_nombre, cb.tipo as cuenta_tipo
          FROM transacciones t
          JOIN cuentas_bancarias cb ON t.cuenta_id = cb.id
          WHERE t.created_at >= ${abiertaAt}
          ORDER BY t.created_at DESC
        `;
      }

      activeBox = {
        id: box.id,
        fecha: box.fecha,
        monto_apertura: Number(box.monto_apertura),
        monto_ingresos: ingresos,
        monto_egresos: egresos,
        monto_estimado: Number(box.monto_apertura) + ingresos - egresos,
        estado: box.estado,
        abierta_at: box.abierta_at,
        cuenta_id: cashAccountId,
        transacciones
      };
    }

    // 2. Obtener historial de cajas cerradas
    const historial = await sql`
      SELECT c.id, c.fecha, c.monto_apertura, c.monto_ingresos, c.monto_egresos,
             c.monto_cierre_real, c.monto_cierre_calculado, c.estado, c.abierta_at, c.cerrada_at,
             u1.name as abierta_por_name, u2.name as cerrada_por_name
      FROM caja_diaria c
      LEFT JOIN users u1 ON c.abierta_por = u1.id
      LEFT JOIN users u2 ON c.cerrada_por = u2.id
      WHERE c.estado = 'Cerrada'
      ORDER BY c.fecha DESC
      LIMIT 15
    `;

    return NextResponse.json({
      active: activeBox !== null,
      caja: activeBox,
      historial: historial.map(h => ({
        ...h,
        monto_apertura: Number(h.monto_apertura),
        monto_ingresos: Number(h.monto_ingresos),
        monto_egresos: Number(h.monto_egresos),
        monto_cierre_real: Number(h.monto_cierre_real),
        monto_cierre_calculado: Number(h.monto_cierre_calculado),
      }))
    });
  } catch (error) {
    console.error("Error en GET /api/caja-diaria:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado para abrir caja" }, { status: 403 });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no definida");
  const sql = neon(connectionString);

  try {
    const body = await req.json();
    const parsed = AperturaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Monto de apertura inválido" }, { status: 400 });
    }

    const { monto_apertura } = parsed.data;

    // Verificar si ya hay una caja abierta
    const openBoxes = await sql`
      SELECT id FROM caja_diaria WHERE estado = 'Abierta' LIMIT 1
    `;
    if (openBoxes.length > 0) {
      return NextResponse.json({ error: "Ya existe una caja abierta" }, { status: 400 });
    }

    // Obtener o crear cuenta de efectivo
    let cashAccountId = "";
    const cashAccounts = await sql`
      SELECT id FROM cuentas_bancarias WHERE nombre = 'Caja Efectivo Planta' LIMIT 1
    `;
    if (cashAccounts.length > 0) {
      cashAccountId = cashAccounts[0].id;
    } else {
      const newAcc = await sql`
        INSERT INTO cuentas_bancarias (nombre, tipo, saldo)
        VALUES ('Caja Efectivo Planta', 'efectivo', 0)
        RETURNING id
      `;
      cashAccountId = newAcc[0].id;
    }

    // Apertura ATÓMICA: caja + saldo + transacción en una sola transacción de DB.
    // El índice único parcial ux_caja_diaria_unica_abierta (migrate-caja-unica-abierta.sql)
    // garantiza una sola caja abierta aunque dos requests lleguen a la vez.
    await sql.transaction([
      sql`
        INSERT INTO caja_diaria (fecha, monto_apertura, estado, abierta_por, abierta_at, cuenta_id)
        VALUES (
          (NOW() AT TIME ZONE 'America/Lima')::date,
          ${monto_apertura},
          'Abierta',
          ${session.user.id},
          (NOW() AT TIME ZONE 'America/Lima'),
          ${cashAccountId}
        )
      `,
      sql`
        UPDATE cuentas_bancarias
        SET saldo = ${monto_apertura},
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${cashAccountId}
      `,
      sql`
        INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto)
        VALUES (${cashAccountId}, ${session.user.id}, 'ingreso', ${monto_apertura}, 'Apertura de Caja')
      `,
    ]);

    return NextResponse.json({ message: "Caja abierta exitosamente" }, { status: 201 });
  } catch (error) {
    // 23505 = violación de unicidad (caja ya abierta hoy o abierta en simultáneo)
    if (error && typeof error === "object" && (error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Ya existe una caja abierta" }, { status: 409 });
    }
    console.error("Error en POST /api/caja-diaria:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado para cerrar caja" }, { status: 403 });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no definida");
  const sql = neon(connectionString);

  try {
    const body = await req.json();
    const parsed = CierreSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Monto de cierre inválido" }, { status: 400 });
    }

    const { monto_cierre_real } = parsed.data;

    // Obtener caja abierta activa
    const openBoxes = await sql`
      SELECT id, monto_apertura, abierta_at, cuenta_id
      FROM caja_diaria
      WHERE estado = 'Abierta'
      LIMIT 1
    `;
    if (openBoxes.length === 0) {
      return NextResponse.json({ error: "No hay ninguna caja abierta para cerrar" }, { status: 400 });
    }

    const activeBox = openBoxes[0];
    const abiertaAt = activeBox.abierta_at;
    const montoApertura = Number(activeBox.monto_apertura);

    // La cuenta fijada al abrir; fallback por nombre para cajas pre-migración.
    let cashAccountId = activeBox.cuenta_id as string | null;
    if (!cashAccountId) {
      const cashAccounts = await sql`
        SELECT id FROM cuentas_bancarias WHERE nombre = 'Caja Efectivo Planta' LIMIT 1
      `;
      cashAccountId = cashAccounts[0]?.id ?? null;
    }

    let ingresos = 0;
    let egresos = 0;

    if (cashAccountId) {
      // Calcular ingresos reales
      const ingResult = await sql`
        SELECT COALESCE(SUM(monto), 0) as total
        FROM transacciones
        WHERE cuenta_id = ${cashAccountId}
          AND tipo = 'ingreso'
          AND concepto <> 'Apertura de Caja'
          AND created_at >= ${abiertaAt}
      `;
      ingresos = Number(ingResult[0].total);

      // Calcular egresos reales
      const egrResult = await sql`
        SELECT COALESCE(SUM(monto), 0) as total
        FROM transacciones
        WHERE cuenta_id = ${cashAccountId}
          AND tipo = 'egreso'
          AND created_at >= ${abiertaAt}
      `;
      egresos = Number(egrResult[0].total);
    }

    const monto_cierre_calculado = montoApertura + ingresos - egresos;

    // Cerrar caja
    await sql`
      UPDATE caja_diaria
      SET estado = 'Cerrada',
          monto_ingresos = ${ingresos},
          monto_egresos = ${egresos},
          monto_cierre_real = ${monto_cierre_real},
          monto_cierre_calculado = ${monto_cierre_calculado},
          cerrada_por = ${session.user.id},
          cerrada_at = (NOW() AT TIME ZONE 'America/Lima'),
          updated_at = (NOW() AT TIME ZONE 'America/Lima')
      WHERE id = ${activeBox.id}
    `;

    // Sincronizar el saldo físico real en la cuenta
    if (cashAccountId) {
      await sql`
        UPDATE cuentas_bancarias
        SET saldo = ${monto_cierre_real},
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${cashAccountId}
      `;
    }

    return NextResponse.json({
      message: "Caja cerrada exitosamente",
      calculado: monto_cierre_calculado,
      real: monto_cierre_real,
      diferencia: monto_cierre_real - monto_cierre_calculado
    });
  } catch (error) {
    console.error("Error en PUT /api/caja-diaria:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
