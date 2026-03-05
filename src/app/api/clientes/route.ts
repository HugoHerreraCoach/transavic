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
    const filterAsesor = searchParams.get("asesor_id")?.trim(); // Admin puede filtrar por asesora
    const offset = (page - 1) * limit;

    // Construir condiciones dinámicamente
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // Scoping por rol
    if (userRole !== "admin") {
      conditions.push(`c.asesor_id = $${paramIndex}`);
      params.push(userId);
      paramIndex++;
    } else if (filterAsesor) {
      // Admin filtrando por asesora específica
      conditions.push(`c.asesor_id = $${paramIndex}`);
      params.push(filterAsesor);
      paramIndex++;
    }

    // Búsqueda por texto
    if (search) {
      conditions.push(`(
        c.nombre ILIKE $${paramIndex}
        OR c.ruc_dni ILIKE $${paramIndex}
        OR c.whatsapp ILIKE $${paramIndex}
        OR c.distrito ILIKE $${paramIndex}
        OR c.razon_social ILIKE $${paramIndex}
      )`);
      params.push('%' + search + '%');
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Query principal con JOIN para asesor_name
    const queryData = `
      SELECT c.*, u.name as asesor_name
      FROM clientes c
      LEFT JOIN users u ON c.asesor_id = u.id
      ${whereClause}
      ORDER BY c.nombre ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const clientes = await sql.query(queryData, params);

    // Count query (mismos filtros sin LIMIT/OFFSET)
    const countParams = params.slice(0, -2); // sin limit y offset
    const countQuery = `SELECT COUNT(*) FROM clientes c ${whereClause}`;
    const countResult = await sql.query(countQuery, countParams);

    const total = Number(countResult[0].count);

    // Si es admin, también devolver lista de asesoras para el filtro
    let asesoras = null;
    if (userRole === "admin") {
      asesoras = await sql`
        SELECT id, name FROM users WHERE role IN ('asesor', 'admin') ORDER BY name ASC
      `;
    }

    return NextResponse.json({
      data: clientes,
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      },
      asesoras, // null para asesoras, array para admins
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

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");
    const sql = neon(connectionString);

    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const { nombre, razon_social, ruc_dni, whatsapp, direccion, direccion_mapa, distrito, tipo_cliente, hora_entrega, notas, empresa, latitude, longitude, asesor_id } = parsed.data;

    // Determinar asesor_id:
    // - Admin puede asignar a quien quiera; si no envía, se asigna a sí mismo
    // - Asesora siempre se asigna a sí misma
    const finalAsesorId = session.user.role === "admin" && asesor_id
      ? asesor_id
      : session.user.id;

    const result = await sql`
      INSERT INTO clientes (nombre, razon_social, ruc_dni, whatsapp, direccion, direccion_mapa, distrito, tipo_cliente, hora_entrega, notas, empresa, latitude, longitude, asesor_id)
      VALUES (${nombre}, ${razon_social ?? null}, ${ruc_dni ?? null}, ${whatsapp ?? null}, ${direccion ?? null}, ${direccion_mapa ?? null}, ${distrito ?? 'La Victoria'}, ${tipo_cliente ?? 'Frecuente'}, ${hora_entrega ?? null}, ${notas ?? null}, ${empresa ?? 'Transavic'}, ${latitude ?? null}, ${longitude ?? null}, ${finalAsesorId})
      RETURNING *, (SELECT name FROM users WHERE id = ${finalAsesorId}) as asesor_name
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error("Error POST /api/clientes:", error);
    return NextResponse.json({ error: "Error al crear cliente" }, { status: 500 });
  }
}
