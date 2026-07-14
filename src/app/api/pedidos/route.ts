// src/app/api/pedidos/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  matchProductoCatalogo,
  parseDetallePedido,
  type ProductoCatalogo,
} from "@/lib/parse-detalle-pedido";
import {
  claveItemPedido,
  decimalCanonicoNullable,
  redondearDecimalPedido,
} from "@/lib/pedidos-idempotencia";

// Definimos un esquema de validación con Zod para asegurar los datos
const PedidoSchema = z.object({
  // Lo genera el cliente y se conserva mientras reintenta. Es opcional para no
  // romper bundles antiguos durante el despliegue; esos clientes reciben uno server-side.
  id: z.string().uuid().optional(),
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
      id,
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
    const pedidoId = id ?? crypto.randomUUID();
    // La base persiste coordenadas con 8 decimales y cantidades con 2. Se
    // canonizan antes de insertar y antes de comparar un replay para que el
    // redondeo propio de NUMERIC no convierta un reintento genuino en 409.
    const latitudeCanonica =
      latitude === null || latitude === undefined
        ? null
        : redondearDecimalPedido(latitude, 8);
    const longitudeCanonica =
      longitude === null || longitude === undefined
        ? null
        : redondearDecimalPedido(longitude, 8);

    type ItemPreparado = {
      productoId: string | null;
      nombre: string;
      cantidad: number;
      unidad: string;
      notas: string | null;
    };

    let itemsPreparados: ItemPreparado[] = [];
    if (items && items.length > 0) {
      itemsPreparados = items.map((item) => ({
        productoId: item.productoId,
        nombre: item.nombre,
        cantidad: redondearDecimalPedido(item.cantidad, 2),
        unidad: item.unidad,
        notas: item.notas ?? null,
      }));
    } else {
      // Red de seguridad para detalle escrito a mano o pedidos duplicados desde
      // versiones antiguas. Se prepara ANTES del batch, pero se inserta dentro
      // de la misma transacción que la cabecera y la notificación.
      const parseados = parseDetallePedido(detalle);
      if (parseados.length > 0) {
        const catalogo = (await sql`
          SELECT id, nombre, precio_venta FROM productos
        `) as unknown as ProductoCatalogo[];
        itemsPreparados = parseados.map((item) => ({
          productoId: matchProductoCatalogo(item.producto_nombre, catalogo)?.id ?? null,
          nombre: item.producto_nombre,
          cantidad: redondearDecimalPedido(item.cantidad, 2),
          unidad: item.unidad,
          notas: null,
        }));
      }
    }

    if (itemsPreparados.some((item) => item.cantidad <= 0)) {
      return NextResponse.json(
        { error: "La cantidad mínima que se puede registrar es 0.01." },
        { status: 400 }
      );
    }

    // Pedido + ítems + notificación en una sola transacción. El precio se lee
    // dentro de cada INSERT para congelar exactamente el valor vigente en el batch.
    const queries = [
      sql`
        INSERT INTO pedidos (
          id, cliente, cliente_id, whatsapp, direccion, direccion_mapa, distrito,
          tipo_cliente, detalle, hora_entrega, razon_social, ruc_dni, notas,
          empresa, fecha_pedido, latitude, longitude, asesor_id, origen
        )
        VALUES (
          ${pedidoId}, ${cliente}, ${clienteId ?? null}, ${whatsapp ?? null},
          ${direccion ?? null}, ${direccionMapa ?? null}, ${distrito}, ${tipoCliente},
          ${detalle}, ${horaEntrega ?? null}, ${razonSocial ?? null}, ${rucDni ?? null},
          ${notas ?? null}, ${empresa}, ${fecha_pedido}, ${latitudeCanonica},
          ${longitudeCanonica}, ${finalAsesorId}, 'asesor'
        )
      `,
      ...itemsPreparados.map((item) => sql`
        INSERT INTO pedido_items (
          pedido_id, producto_id, producto_nombre, cantidad, unidad, unidad_pedido,
          precio_unitario, subtotal, notas
        )
        VALUES (
          ${pedidoId}, ${item.productoId}, ${item.nombre}, ${item.cantidad},
          ${item.unidad}, ${item.unidad},
          (SELECT precio_venta FROM productos WHERE id = ${item.productoId}),
          ROUND(
            (SELECT precio_venta FROM productos WHERE id = ${item.productoId})
            * ${item.cantidad},
            2
          ),
          ${item.notas}
        )
      `),
      sql`
        INSERT INTO notificaciones (user_id, tipo, titulo, mensaje, link, pedido_id)
        SELECT
          u.id,
          'pedido_creado',
          'Nuevo pedido recibido',
          ${`Cliente: ${cliente} · ${distrito || "sin distrito"} · ${horaEntrega || "sin horario"}`},
          '/dashboard/produccion',
          ${pedidoId}
        FROM users u
        WHERE u.role = 'produccion'
      `,
    ];

    try {
      await sql.transaction(queries);
    } catch (error: unknown) {
      const dbError = error as { code?: string };
      if (dbError.code !== "23505") {
        throw error;
      }

      // Replay del mismo UUID: no volver a insertar ítems ni notificaciones.
      // Una colisión con otro payload se rechaza para no ocultar un error real.
      const existentes = (await sql`
        SELECT
          p.id,
          p.cliente,
          p.cliente_id,
          p.whatsapp,
          p.direccion,
          p.direccion_mapa,
          p.distrito,
          p.tipo_cliente,
          p.hora_entrega,
          p.razon_social,
          p.ruc_dni,
          p.notas,
          p.latitude,
          p.longitude,
          p.asesor_id,
          p.fecha_pedido::text AS fecha_pedido,
          p.detalle,
          p.empresa,
          p.origen,
          COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'productoId', pi.producto_id,
                'nombre', pi.producto_nombre,
                'cantidad', pi.cantidad,
                'unidad', pi.unidad_pedido,
                'notas', pi.notas
              )
              ORDER BY pi.producto_nombre, pi.cantidad, pi.unidad_pedido, pi.id
            )
            FROM pedido_items pi
            WHERE pi.pedido_id = p.id
          ), '[]'::jsonb) AS items
        FROM pedidos p
        WHERE p.id = ${pedidoId}
        LIMIT 1
      `) as Array<{
        id: string;
        cliente: string;
        cliente_id: string | null;
        whatsapp: string | null;
        direccion: string | null;
        direccion_mapa: string | null;
        distrito: string | null;
        tipo_cliente: string | null;
        hora_entrega: string | null;
        razon_social: string | null;
        ruc_dni: string | null;
        notas: string | null;
        latitude: number | string | null;
        longitude: number | string | null;
        asesor_id: string;
        fecha_pedido: string;
        detalle: string;
        empresa: string;
        origen: string | null;
        items: Array<{
          productoId: string | null;
          nombre: string;
          cantidad: number | string;
          unidad: string;
          notas: string | null;
        }>;
      }>;
      const existente = existentes[0];
      const texto = (valor: string | null | undefined) => valor ?? "";
      const compararProducto = Boolean(items && items.length > 0);
      const itemsExistentes = (existente?.items ?? [])
        .map((item) => claveItemPedido(item, compararProducto))
        .sort();
      const itemsRecibidos = itemsPreparados
        .map((item) => claveItemPedido(item, compararProducto))
        .sort();
      const mismoPayload =
        existente?.cliente === cliente &&
        texto(existente?.cliente_id) === texto(clienteId) &&
        texto(existente?.whatsapp) === texto(whatsapp) &&
        texto(existente?.direccion) === texto(direccion) &&
        texto(existente?.direccion_mapa) === texto(direccionMapa) &&
        texto(existente?.distrito) === texto(distrito) &&
        texto(existente?.tipo_cliente) === texto(tipoCliente) &&
        texto(existente?.hora_entrega) === texto(horaEntrega) &&
        texto(existente?.razon_social) === texto(razonSocial) &&
        texto(existente?.ruc_dni) === texto(rucDni) &&
        texto(existente?.notas) === texto(notas) &&
        decimalCanonicoNullable(existente?.latitude, 8) ===
          decimalCanonicoNullable(latitudeCanonica, 8) &&
        decimalCanonicoNullable(existente?.longitude, 8) ===
          decimalCanonicoNullable(longitudeCanonica, 8) &&
        existente?.asesor_id === finalAsesorId &&
        existente?.fecha_pedido === fecha_pedido &&
        existente?.detalle === detalle &&
        existente?.empresa === empresa &&
        (existente?.origen ?? "asesor") === "asesor" &&
        JSON.stringify(itemsExistentes) === JSON.stringify(itemsRecibidos);

      if (!mismoPayload) {
        return NextResponse.json(
          { error: "El identificador del pedido ya fue usado con otros datos." },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          message: "Pedido ya registrado",
          pedido_id: pedidoId,
          cliente: existente.cliente,
          idempotente: true,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        message: "Pedido creado exitosamente",
        pedido_id: pedidoId,
        cliente,
        idempotente: false,
      },
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
