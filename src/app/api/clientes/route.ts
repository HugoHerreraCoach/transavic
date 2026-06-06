// src/app/api/clientes/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  nombre: z.string().min(1),
  razon_social: z.string().optional().nullable(),
  ruc_dni: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  direccion_mapa: z.string().optional().nullable(),
  distrito: z.string().optional().nullable(),
  tipo_cliente: z.string().optional().nullable(),
  hora_entrega: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
  empresa: z.string().optional().nullable(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  asesor_id: z.string().uuid().optional().nullable(),
  plazo_pago_dias: z.number().int().min(0).max(90).optional(),
});

export async function GET(request: Request) {
  try {
    // Auth: obtener sesión
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = session.user.id;
    const userRole = session.user.role;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");

    // ── Autocomplete (búsqueda rápida para nuevo-pedido) ──
    if (q && q.trim()) {
      let clientes;
      if (userRole === "admin") {
        clientes = await sql`
          SELECT c.*, u.name as asesor_name
          FROM clientes c
          LEFT JOIN users u ON c.asesor_id = u.id
          WHERE c.nombre ILIKE ${'%' + q.trim() + '%'}
          ORDER BY c.nombre ASC
          LIMIT 8
        `;
      } else {
        // Asesoras solo ven sus propios clientes
        clientes = await sql`
          SELECT c.*, u.name as asesor_name
          FROM clientes c
          LEFT JOIN users u ON c.asesor_id = u.id
          WHERE c.nombre ILIKE ${'%' + q.trim() + '%'}
            AND c.asesor_id = ${userId}
          ORDER BY c.nombre ASC
          LIMIT 8
        `;
      }
      return NextResponse.json(clientes);
    }

    // ── Listado paginado ──
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "15")));
    const search = searchParams.get("search")?.trim();
    const filterAsesor = searchParams.get("asesor_id")?.trim();
    const sinAsesora = userRole === "admin" && searchParams.get("sin_asesora") === "true";
    const distrito = searchParams.get("distrito")?.trim() || "";
    const offset = (page - 1) * limit;

    // Condiciones base: scoping por rol + búsqueda de texto
    const baseC: string[] = [];
    const baseP: unknown[] = [];
    if (userRole !== "admin") {
      baseC.push(`c.asesor_id = $${baseP.length + 1}`);
      baseP.push(userId);
    }
    if (search) {
      baseC.push(`(c.nombre ILIKE $${baseP.length + 1} OR c.ruc_dni ILIKE $${baseP.length + 1} OR c.whatsapp ILIKE $${baseP.length + 1} OR c.distrito ILIKE $${baseP.length + 1} OR c.razon_social ILIKE $${baseP.length + 1})`);
      baseP.push('%' + search + '%');
    }

    // Condiciones completas para la query principal y conteo
    const allC = [...baseC]; const allP = [...baseP];
    if (sinAsesora) {
      // Clientes sin asesora asignada O asignados a un usuario que no es role='asesor' (ej. admin)
      allC.push(`(c.asesor_id IS NULL OR NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.id = c.asesor_id AND u2.role = 'asesor'))`);
    } else if (userRole === "admin" && filterAsesor) {
      allC.push(`c.asesor_id = $${allP.length + 1}`); allP.push(filterAsesor);
    }
    if (distrito) { allC.push(`c.distrito = $${allP.length + 1}`); allP.push(distrito); }
    const whereClause = allC.length > 0 ? `WHERE ${allC.join(' AND ')}` : '';

    // Query principal con JOIN para asesor_name
    const queryData = `
      SELECT c.*, u.name as asesor_name
      FROM clientes c
      LEFT JOIN users u ON c.asesor_id = u.id
      ${whereClause}
      ORDER BY c.nombre ASC
      LIMIT $${allP.length + 1} OFFSET $${allP.length + 2}
    `;
    allP.push(limit, offset);
    const clientes = await sql.query(queryData, allP);

    // Count (mismos filtros sin LIMIT/OFFSET)
    const countParams = allP.slice(0, -2);
    const countQuery = `SELECT COUNT(*) FROM clientes c ${whereClause}`;
    const countResult = await sql.query(countQuery, countParams);
    const total = Number(countResult[0].count);

    // Lista de asesoras (admin)
    let asesoras = null;
    if (userRole === "admin") {
      asesoras = await sql`
        SELECT id, name FROM users WHERE role IN ('asesor', 'admin') ORDER BY name ASC
      `;
    }

    // ── Resumen de distribución ──
    // porAsesora: base + distrito (sin filterAsesor → distribución entre asesoras para ese distrito)
    const asesorC = [...baseC]; const asesorP = [...baseP];
    if (distrito) { asesorC.push(`c.distrito = $${asesorP.length + 1}`); asesorP.push(distrito); }
    const condAsesor = asesorC.length > 0
      ? `${asesorC.join(' AND ')} AND u.role = 'asesor'`
      : `u.role = 'asesor'`;

    // porDistrito: base + filterAsesor (sin distrito → distribución entre distritos para esa asesora)
    const distC = [...baseC]; const distP = [...baseP];
    if (userRole === "admin" && filterAsesor) { distC.push(`c.asesor_id = $${distP.length + 1}`); distP.push(filterAsesor); }
    const condDist = distC.length > 0
      ? `${distC.join(' AND ')} AND c.distrito IS NOT NULL`
      : `c.distrito IS NOT NULL`;

    const [resumenAsesoraRows, resumenDistritoRows] = await Promise.all([
      userRole === "admin"
        ? sql.query(
            `SELECT u.name AS nombre, COUNT(*)::int AS total
             FROM clientes c
             LEFT JOIN users u ON c.asesor_id = u.id
             WHERE ${condAsesor}
             GROUP BY u.name
             ORDER BY total DESC`,
            asesorP
          )
        : Promise.resolve([]),
      sql.query(
        `SELECT c.distrito, COUNT(*)::int AS total
         FROM clientes c
         WHERE ${condDist}
         GROUP BY c.distrito
         ORDER BY total DESC`,
        distP
      ),
    ]);

    return NextResponse.json({
      data: clientes,
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      },
      asesoras,
      resumen: {
        porAsesora: resumenAsesoraRows as { nombre: string; total: number }[],
        porDistrito: resumenDistritoRows as { distrito: string; total: number }[],
      },
    });
  } catch (error) {
    console.error("Error GET /api/clientes:", error);
    return NextResponse.json({ error: "Error al obtener clientes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // Auth
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    // Solo admin y asesoras crean clientes (producción/repartidor no).
    if (!["admin", "asesor"].includes(session.user.role)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const { nombre, razon_social, ruc_dni, whatsapp, direccion, direccion_mapa, distrito, tipo_cliente, hora_entrega, notas, empresa, latitude, longitude, asesor_id, plazo_pago_dias } = parsed.data;

    // Determinar asesor_id:
    // - Admin puede asignar a quien quiera; si no envía, se asigna a sí mismo
    // - Asesora siempre se asigna a sí misma
    const finalAsesorId = session.user.role === "admin" && asesor_id
      ? asesor_id
      : session.user.id;

    const result = await sql`
      INSERT INTO clientes (nombre, razon_social, ruc_dni, whatsapp, direccion, direccion_mapa, distrito, tipo_cliente, hora_entrega, notas, empresa, latitude, longitude, asesor_id, plazo_pago_dias)
      VALUES (${nombre}, ${razon_social ?? null}, ${ruc_dni ?? null}, ${whatsapp ?? null}, ${direccion ?? null}, ${direccion_mapa ?? null}, ${distrito ?? 'La Victoria'}, ${tipo_cliente ?? 'Frecuente'}, ${hora_entrega ?? null}, ${notas ?? null}, ${empresa ?? 'Transavic'}, ${latitude ?? null}, ${longitude ?? null}, ${finalAsesorId}, ${plazo_pago_dias ?? 0})
      RETURNING *, (SELECT name FROM users WHERE id = ${finalAsesorId}) as asesor_name
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error("Error POST /api/clientes:", error);
    return NextResponse.json({ error: "Error al crear cliente" }, { status: 500 });
  }
}
