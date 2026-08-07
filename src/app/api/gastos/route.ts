// src/app/api/gastos/route.ts
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FECHA_REGEX, fechaBonita, validarFechaGasto } from "@/lib/gastos/fecha-gasto";
import { cajaDelDiaCerrada, conceptoDeGasto, hoyLimaSql } from "@/lib/gastos/registro";

export const dynamic = "force-dynamic";

// `fecha` es OPCIONAL: sin ella el gasto es de hoy (el 99% de los casos). Cuando
// viene, se valida en serio — antes el schema era `z.string().min(1)` y aceptaba
// cualquier cosa, incluida una fecha futura o "ayer".
const CreateGastoSchema = z.object({
  fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (AAAA-MM-DD)").optional(),
  categoria: z.string().min(1),
  descripcion: z.string().optional().nullable(),
  monto: z.number().positive(),
  cuenta_id: z.string().uuid(),
});

export async function GET(req: NextRequest) {
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
    // Filtro opcional por rango de fechas (YYYY-MM-DD). Sin params se comporta
    // como siempre: los gastos más recientes.
    const esFechaValida = (v: string | null): v is string =>
      !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const desde = req.nextUrl.searchParams.get("desde");
    const hasta = req.nextUrl.searchParams.get("hasta");

    const condiciones: string[] = [];
    const params: string[] = [];
    if (esFechaValida(desde)) {
      params.push(desde);
      condiciones.push(`g.fecha >= $${params.length}::date`);
    }
    if (esFechaValida(hasta)) {
      params.push(hasta);
      condiciones.push(`g.fecha <= $${params.length}::date`);
    }
    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";

    const consulta = `
      SELECT g.id,
             TO_CHAR(g.fecha, 'YYYY-MM-DD') as fecha,
             TO_CHAR(g.fecha, 'DD/MM/YYYY') as fecha_formateada,
             g.categoria, g.descripcion, g.monto, g.metodo_pago,
             u.name as created_by_name
      FROM gastos g
      LEFT JOIN users u ON g.created_by = u.id
      ${where}
      ORDER BY g.fecha DESC, g.created_at DESC
      LIMIT 500
    `;
    const list = (await sql.query(consulta, params)) as Array<Record<string, unknown>>;
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

    const { categoria, descripcion, monto, cuenta_id } = parsed.data;

    // La fecha del gasto: la que mandó el usuario, o hoy. El "hoy" lo resuelve la
    // BASE en zona Lima — el reloj del navegador no es confiable (y con
    // toISOString(), después de las 19:00 de Lima devolvía la fecha de mañana).
    const hoy = await hoyLimaSql(sql);
    const fecha = parsed.data.fecha ?? hoy;

    const vf = validarFechaGasto(fecha, hoy);
    if (!vf.ok) {
      return NextResponse.json({ error: vf.motivo }, { status: 400 });
    }

    // 1. Obtener detalles de la cuenta bancaria / caja chica
    const accounts = await sql`
      SELECT id, nombre, tipo, saldo FROM cuentas_bancarias WHERE id = ${cuenta_id} LIMIT 1
    `;
    if (accounts.length === 0) {
      return NextResponse.json({ error: "La cuenta de origen no existe" }, { status: 400 });
    }

    const cuentaNombre = accounts[0].nombre as string;

    // 2. No contradecir un arqueo ya firmado: si ese día la caja de esta cuenta
    //    se cerró, el gasto cambiaría un cuadre que alguien ya dio por bueno.
    if (await cajaDelDiaCerrada(sql, fecha, cuenta_id)) {
      return NextResponse.json(
        {
          error: `La caja del ${fechaBonita(fecha)} ya fue cerrada, así que no se puede agregar un gasto a ese día. Regístralo con otra fecha o pide el ajuste al administrador.`,
          codigo: "caja_cerrada",
        },
        { status: 409 }
      );
    }

    // 3. Las tres escrituras van juntas o no van: un gasto sin su movimiento en
    //    el ledger deja la cuenta descuadrada (CLAUDE.md §11).
    const gasto_id = crypto.randomUUID();
    const concepto = conceptoDeGasto(categoria, descripcion);

    await sql.transaction([
      sql`
        INSERT INTO gastos (id, fecha, categoria, descripcion, monto, metodo_pago, created_by)
        VALUES (${gasto_id}, ${fecha}::date, ${categoria}, ${descripcion || null}, ${monto}, ${cuentaNombre}, ${session.user.id})
      `,
      sql`
        UPDATE cuentas_bancarias
        SET saldo = saldo - ${monto},
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${cuenta_id}
      `,
      // `fecha` y un `created_at` SINTÉTICO en el día del gasto (patrón del POS,
      // api/pos/route.ts): así un gasto atrasado NO entra al arqueo de la caja de
      // hoy, que filtra por `created_at >= abierta_at`.
      sql`
        INSERT INTO transacciones (cuenta_id, usuario_id, tipo, monto, concepto, referencia_id, fecha, created_at)
        VALUES (
          ${cuenta_id}, ${session.user.id}, 'egreso', ${monto}, ${concepto}, ${gasto_id},
          ${fecha}::date,
          (${fecha}::date + (NOW() AT TIME ZONE 'America/Lima')::time) AT TIME ZONE 'America/Lima'
        )
      `,
    ]);

    return NextResponse.json(
      { message: "Gasto registrado exitosamente", gasto_id, fecha, es_retroactivo: fecha !== hoy },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error en POST /api/gastos:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
