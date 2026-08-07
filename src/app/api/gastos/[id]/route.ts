// src/app/api/gastos/[id]/route.ts
//
// Corregir o borrar un gasto. Hasta el 6 ago 2026 esto NO existía: un gasto mal
// cargado (monto equivocado, categoría equivocada o —el caso real— con la fecha
// de hoy en vez de la del día en que se gastó) quedaba así para siempre.
//
// Las tres tablas se mueven JUNTAS o no se mueven (CLAUDE.md §11): el gasto, el
// saldo de la cuenta y la fila del ledger. Si se cambia de cuenta, se devuelve la
// plata a la vieja y se descuenta de la nueva.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FECHA_REGEX, fechaBonita, validarFechaGasto } from "@/lib/gastos/fecha-gasto";
import { cajaDelDiaCerrada, conceptoDeGasto, hoyLimaSql } from "@/lib/gastos/registro";

export const dynamic = "force-dynamic";

const UpdateGastoSchema = z
  .object({
    fecha: z.string().regex(FECHA_REGEX, "Formato de fecha inválido (AAAA-MM-DD)").optional(),
    categoria: z.string().min(1).optional(),
    descripcion: z.string().optional().nullable(),
    monto: z.number().positive().optional(),
    cuenta_id: z.string().uuid().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "No se enviaron cambios.",
  });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idDesdeUrl(req: NextRequest): string | null {
  const partes = req.nextUrl.pathname.split("/").filter(Boolean);
  const id = partes[partes.length - 1];
  return id && UUID_REGEX.test(id) ? id : null;
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "admin" && session.user.role !== "produccion")) {
    return NextResponse.json({ error: "No autorizado para corregir gastos" }, { status: 403 });
  }

  const id = idDesdeUrl(req);
  if (!id) return NextResponse.json({ error: "Identificador de gasto inválido" }, { status: 400 });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no definida");
  const sql = neon(connectionString);

  try {
    const parsed = UpdateGastoSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos inválidos", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Estado actual: hace falta para revertir el saldo y para saber de qué cuenta salió.
    const actuales = await sql`
      SELECT g.id, TO_CHAR(g.fecha, 'YYYY-MM-DD') AS fecha, g.categoria, g.descripcion,
             g.monto, g.metodo_pago,
             (SELECT t.cuenta_id FROM transacciones t WHERE t.referencia_id = g.id LIMIT 1) AS cuenta_id
      FROM gastos g WHERE g.id = ${id}
    `;
    if (actuales.length === 0) {
      return NextResponse.json({ error: "El gasto no existe" }, { status: 404 });
    }
    const previo = actuales[0] as {
      fecha: string;
      categoria: string;
      descripcion: string | null;
      monto: string | number;
      cuenta_id: string | null;
    };

    const hoy = await hoyLimaSql(sql);
    const fecha = parsed.data.fecha ?? previo.fecha;
    const vf = validarFechaGasto(fecha, hoy);
    if (!vf.ok) return NextResponse.json({ error: vf.motivo }, { status: 400 });

    const montoPrevio = Number(previo.monto);
    const monto = parsed.data.monto ?? montoPrevio;
    const categoria = parsed.data.categoria ?? previo.categoria;
    const descripcion =
      parsed.data.descripcion !== undefined ? parsed.data.descripcion : previo.descripcion;
    const cuentaNueva = parsed.data.cuenta_id ?? previo.cuenta_id;

    if (!cuentaNueva) {
      return NextResponse.json(
        { error: "Este gasto no tiene una cuenta asociada; no se puede corregir automáticamente." },
        { status: 409 }
      );
    }

    const cuentas = await sql`
      SELECT id, nombre FROM cuentas_bancarias WHERE id = ${cuentaNueva} LIMIT 1
    `;
    if (cuentas.length === 0) {
      return NextResponse.json({ error: "La cuenta de origen no existe" }, { status: 400 });
    }
    const cuentaNombre = cuentas[0].nombre as string;

    // No tocar un arqueo firmado: ni el día del que sale ni el día al que entra.
    for (const [f, c] of [
      [previo.fecha, previo.cuenta_id],
      [fecha, cuentaNueva],
    ] as const) {
      if (c && (await cajaDelDiaCerrada(sql, f, c))) {
        return NextResponse.json(
          {
            error: `La caja del ${fechaBonita(f)} ya fue cerrada: corregir este gasto cambiaría un cuadre ya firmado. Pide el ajuste al administrador.`,
            codigo: "caja_cerrada",
          },
          { status: 409 }
        );
      }
    }

    const concepto = conceptoDeGasto(categoria, descripcion);
    const cambioDeCuenta = previo.cuenta_id !== cuentaNueva;

    const sentencias = [
      sql`
        UPDATE gastos
        SET fecha = ${fecha}::date,
            categoria = ${categoria},
            descripcion = ${descripcion || null},
            monto = ${monto},
            metodo_pago = ${cuentaNombre},
            updated_by = ${session.user.id},
            updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${id}
      `,
      sql`
        UPDATE transacciones
        SET cuenta_id = ${cuentaNueva},
            monto = ${monto},
            concepto = ${concepto},
            fecha = ${fecha}::date,
            created_at = (${fecha}::date + (NOW() AT TIME ZONE 'America/Lima')::time) AT TIME ZONE 'America/Lima'
        WHERE referencia_id = ${id}
      `,
    ];

    // El dinero: si cambió de cuenta se devuelve entero a la vieja y se descuenta
    // entero de la nueva; si no, solo se ajusta la diferencia.
    if (cambioDeCuenta) {
      if (previo.cuenta_id) {
        sentencias.push(sql`
          UPDATE cuentas_bancarias SET saldo = saldo + ${montoPrevio},
                 updated_at = (NOW() AT TIME ZONE 'America/Lima')
          WHERE id = ${previo.cuenta_id}
        `);
      }
      sentencias.push(sql`
        UPDATE cuentas_bancarias SET saldo = saldo - ${monto},
               updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${cuentaNueva}
      `);
    } else if (Math.abs(monto - montoPrevio) > 0.001) {
      const delta = Math.round((monto - montoPrevio) * 100) / 100;
      sentencias.push(sql`
        UPDATE cuentas_bancarias SET saldo = saldo - ${delta},
               updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${cuentaNueva}
      `);
    }

    await sql.transaction(sentencias);

    return NextResponse.json({ message: "Gasto corregido", id, fecha });
  } catch (error) {
    console.error("Error en PATCH /api/gastos/[id]:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Solo un administrador puede borrar un gasto" }, { status: 403 });
  }

  const id = idDesdeUrl(req);
  if (!id) return NextResponse.json({ error: "Identificador de gasto inválido" }, { status: 400 });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no definida");
  const sql = neon(connectionString);

  try {
    const filas = await sql`
      SELECT g.id, TO_CHAR(g.fecha, 'YYYY-MM-DD') AS fecha, g.monto,
             (SELECT t.cuenta_id FROM transacciones t WHERE t.referencia_id = g.id LIMIT 1) AS cuenta_id
      FROM gastos g WHERE g.id = ${id}
    `;
    if (filas.length === 0) {
      return NextResponse.json({ error: "El gasto no existe" }, { status: 404 });
    }
    const gasto = filas[0] as { fecha: string; monto: string | number; cuenta_id: string | null };
    const monto = Number(gasto.monto);

    if (gasto.cuenta_id && (await cajaDelDiaCerrada(sql, gasto.fecha, gasto.cuenta_id))) {
      return NextResponse.json(
        {
          error: `La caja del ${fechaBonita(gasto.fecha)} ya fue cerrada: borrar este gasto cambiaría un cuadre ya firmado.`,
          codigo: "caja_cerrada",
        },
        { status: 409 }
      );
    }

    const sentencias = [
      sql`DELETE FROM transacciones WHERE referencia_id = ${id}`,
      sql`DELETE FROM gastos WHERE id = ${id}`,
    ];
    if (gasto.cuenta_id) {
      // Devolver la plata a la cuenta: el gasto nunca existió.
      sentencias.unshift(sql`
        UPDATE cuentas_bancarias SET saldo = saldo + ${monto},
               updated_at = (NOW() AT TIME ZONE 'America/Lima')
        WHERE id = ${gasto.cuenta_id}
      `);
    }
    await sql.transaction(sentencias);

    return NextResponse.json({ message: "Gasto eliminado", id });
  } catch (error) {
    console.error("Error en DELETE /api/gastos/[id]:", error);
    return NextResponse.json({ error: "Error de servidor" }, { status: 500 });
  }
}
