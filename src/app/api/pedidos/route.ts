// src/app/api/pedidos/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";

// Definimos un esquema de validación con Zod para asegurar los datos
const PedidoSchema = z.object({
  cliente: z.string().min(1, { message: "El cliente es requerido." }),
  whatsapp: z.string().optional(),
  direccion: z.string().optional(),
  distrito: z.string(),
  tipoCliente: z.string(),
  detalle: z.string().min(1, { message: "El detalle es requerido." }),
  horaEntrega: z.string().optional(),
  notas: z.string().optional(),
  empresa: z.string(),
  fecha: z.string(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  asesorId: z.string().uuid({ message: "El ID del asesor no es válido." }),
  items: z.array(z.object({
    productoId: z.string().uuid(),
    nombre: z.string(),
    cantidad: z.number().positive(),
    unidad: z.string(),
  })).optional(),
});

// Helper para convertir la fecha del formato '17 de julio de 2025' a '2025-07-17'
// function parseSpanishDate(dateString: string): string {
//   const months: { [key: string]: string } = {
//     enero: "01",
//     febrero: "02",
//     marzo: "03",
//     abril: "04",
//     mayo: "05",
//     junio: "06",
//     julio: "07",
//     agosto: "08",
//     septiembre: "09",
//     octubre: "10",
//     noviembre: "11",
//     diciembre: "12",
//   };
//   const parts = dateString.toLowerCase().split(" de ");
//   if (parts.length < 3) return new Date().toISOString().split("T")[0]; // Fallback
//   const day = parts[0].padStart(2, "0");
//   const month = months[parts[1]];
//   const year = parts[2];
//   return `${year}-${month}-${day}`;
// }

export async function POST(request: Request) {
  try {
    // Verificar autenticación
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "No autorizado. Debes iniciar sesión." },
        { status: 401 }
      );
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL no está definida");
    }

    const body = await request.json();
    const parsedData = PedidoSchema.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json(
        { error: parsedData.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const {
      cliente,
      whatsapp,
      direccion,
      distrito,
      tipoCliente,
      detalle,
      horaEntrega,
      notas,
      empresa,
      fecha,
      latitude,
      longitude,
      asesorId,
      items,
    } = parsedData.data;

    const fecha_pedido = fecha; 
    const sql = neon(connectionString);

    // Insert the order and get it back
    const insertedPedido = await sql`
      INSERT INTO pedidos (cliente, whatsapp, direccion, distrito, tipo_cliente, detalle, hora_entrega, notas, empresa, fecha_pedido, latitude, longitude, asesor_id)
      VALUES (${cliente}, ${whatsapp}, ${direccion}, ${distrito}, ${tipoCliente}, ${detalle}, ${horaEntrega}, ${notas}, ${empresa}, ${fecha_pedido}, ${latitude}, ${longitude}, ${asesorId})
      RETURNING id
    `;

    // If structured items were sent, save them
    if (items && items.length > 0 && insertedPedido[0]?.id) {
      const pedidoId = insertedPedido[0].id;
      for (const item of items) {
        await sql`
          INSERT INTO pedido_items (pedido_id, producto_id, producto_nombre, cantidad, unidad)
          VALUES (${pedidoId}, ${item.productoId}, ${item.nombre}, ${item.cantidad}, ${item.unidad})
        `;
      }
    }

    return NextResponse.json(
      { message: "Pedido creado exitosamente" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error en API:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: "Error interno del servidor", details: errorMessage },
      { status: 500 }
    );
  }
}
