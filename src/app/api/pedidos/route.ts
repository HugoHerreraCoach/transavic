// src/app/api/pedidos/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { crearNotificacionParaRol } from "@/lib/notificaciones";
import { derivarEInsertarItemsDesdeDetalle } from "@/lib/parse-detalle-pedido";

// Definimos un esquema de validación con Zod para asegurar los datos
const PedidoSchema = z.object({
  cliente: z.string().min(1, { message: "El cliente es requerido." }),
  clienteId: z.string().uuid().nullable().optional(),
  whatsapp: z.string().optional(),
  direccion: z.string().optional(),
  direccionMapa: z.string().optional(),
  distrito: z.string(),
  tipoCliente: z.string(),
  detalle: z.string().min(1, { message: "El detalle es requerido." }),
  horaEntrega: z.string().optional(),
  razonSocial: z.string().optional(),
  rucDni: z.string().optional(),
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
    notas: z.string().optional().nullable(),
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
    // Solo admin y asesoras pueden crear pedidos (producción/repartidor no).
    if (!["admin", "asesor"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "No tienes permiso para crear pedidos." },
        { status: 403 }
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
      clienteId,
      whatsapp,
      direccion,
      direccionMapa,
      distrito,
      tipoCliente,
      detalle,
      horaEntrega,
      razonSocial,
      rucDni,
      notas,
      empresa,
      fecha,
      latitude,
      longitude,
      asesorId,
      items,
    } = parsedData.data;

    // Seguridad: una asesora SIEMPRE crea a su propio nombre (no puede crear a
    // nombre de otra aunque manipule el form). El admin sí respeta el asesor elegido.
    const finalAsesorId =
      session.user.role === "asesor" ? session.user.id : asesorId;

    const fecha_pedido = fecha;
    const sql = neon(connectionString);

    // Insert the order and get it back
    const insertedPedido = await sql`
      INSERT INTO pedidos (cliente, cliente_id, whatsapp, direccion, direccion_mapa, distrito, tipo_cliente, detalle, hora_entrega, razon_social, ruc_dni, notas, empresa, fecha_pedido, latitude, longitude, asesor_id)
      VALUES (${cliente}, ${clienteId ?? null}, ${whatsapp}, ${direccion}, ${direccionMapa}, ${distrito}, ${tipoCliente}, ${detalle}, ${horaEntrega}, ${razonSocial}, ${rucDni}, ${notas}, ${empresa}, ${fecha_pedido}, ${latitude}, ${longitude}, ${finalAsesorId})
      RETURNING id
    `;

    // If structured items were sent, save them con SNAPSHOT del precio vigente
    if (items && items.length > 0 && insertedPedido[0]?.id) {
      const pedidoId = insertedPedido[0].id;
      for (const item of items) {
        // Snapshot del precio vigente al momento de crear el pedido
        const productoRow = await sql`
          SELECT precio_venta FROM productos WHERE id = ${item.productoId}
        `;
        const precio_unitario = productoRow[0]?.precio_venta
          ? Number(productoRow[0].precio_venta)
          : null;
        
        // Se permite precio nulo o 0 si el producto es un regalo o no tiene precio en catálogo.
        // La responsabilidad recae en la asesora de revisar sus metas, o en Producción de pesar y cobrar.
        const subtotal = precio_unitario !== null 
          ? Number((precio_unitario * item.cantidad).toFixed(2))
          : null;

        await sql`
          INSERT INTO pedido_items (pedido_id, producto_id, producto_nombre, cantidad, unidad, unidad_pedido, precio_unitario, subtotal, notas)
          VALUES (${pedidoId}, ${item.productoId}, ${item.nombre}, ${item.cantidad}, ${item.unidad}, ${item.unidad}, ${precio_unitario}, ${subtotal}, ${item.notas || null})
        `;
      }
    } else if (insertedPedido[0]?.id && detalle) {
      // Sin ítems estructurados (detalle escrito a mano, o "Duplicar pedido" de
      // versiones viejas): derivarlos del TEXTO para que el pedido NUNCA nazca
      // sin pedido_items — sin ellos Producción no puede registrar pesos (modal
      // vacío, caso Manuel lince/Nikuya 11 jun 2026) y el pedido no cuenta en el
      // Resumen del día. No bloqueante: si el texto no parsea, el pedido igual se crea.
      try {
        await derivarEInsertarItemsDesdeDetalle(sql, insertedPedido[0].id as string, detalle);
      } catch (e) {
        console.error("No se pudieron derivar los ítems del detalle:", e);
      }
    }

    // Notificar a Producción (no bloqueante: si falla, el pedido ya está creado)
    if (insertedPedido[0]?.id) {
      await crearNotificacionParaRol("produccion", {
        tipo: "pedido_creado",
        titulo: "Nuevo pedido recibido",
        mensaje: `Cliente: ${cliente} · ${distrito ?? "sin distrito"} · ${horaEntrega ?? "sin horario"}`,
        link: "/dashboard/produccion",
        pedidoId: insertedPedido[0].id as string,
      });
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
