// src/app/api/pedidos/[id]/entregar/route.ts
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { crearNotificacion } from "@/lib/notificaciones";
import { calcularMetaDiaria, ventasHoy } from "@/lib/metas";
import { aUnitCodeSunat } from "@/lib/sunat/unidades";

export const dynamic = "force-dynamic";

const EntregarSchema = z.object({
  resultado: z.enum(["Entregado", "Fallido"]),
  razon_fallo: z.string().min(5, "La razón debe tener al menos 5 caracteres.").optional(),
}).refine(
  (data) => data.resultado !== "Fallido" || (data.razon_fallo && data.razon_fallo.length >= 5),
  { message: "Debes indicar la razón por la que no se entregó.", path: ["razon_fallo"] }
);

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 2];

    if (!id) {
      return NextResponse.json({ error: "ID del pedido no encontrado" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = EntregarSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { resultado, razon_fallo } = parsed.data;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL no definida");

    const sql = neon(connectionString);

    // Verificar que el pedido existe
    const pedidoResult = await sql`
      SELECT id, estado, repartidor_id FROM pedidos WHERE id = ${id}
    `;

    if (pedidoResult.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }

    const pedido = pedidoResult[0];

    // Verificar permisos: debe ser el repartidor asignado o un admin
    if (session.user.role !== "admin" && pedido.repartidor_id !== session.user.id) {
      return NextResponse.json({ error: "Este pedido no está asignado a ti." }, { status: 403 });
    }

    // Permitir entrega desde Asignado (entrega directa) o En_Camino (flujo normal)
    const estadosPermitidos = ["Asignado", "En_Camino", "Pendiente"];
    if (!estadosPermitidos.includes(pedido.estado as string)) {
      return NextResponse.json(
        { error: `No se puede entregar desde estado "${pedido.estado}".` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const entregadoPor = session.user.name || "Desconocido";

    if (resultado === "Entregado") {
      await sql`
        UPDATE pedidos
        SET estado = 'Entregado',
            entregado = TRUE,
            entregado_por = ${entregadoPor},
            entregado_at = ${now},
            razon_fallo = NULL
        WHERE id = ${id}
      `;
    } else {
      await sql`
        UPDATE pedidos
        SET estado = 'Fallido',
            entregado = FALSE,
            razon_fallo = ${razon_fallo ?? null},
            entregado_por = ${entregadoPor},
            entregado_at = ${now}
        WHERE id = ${id}
      `;
    }

    // Si fue Entregado: la cobranza NO se crea al entregar — la genera SOLO el
    // COMPROBANTE emitido (boleta/factura). Entregar un pedido ya no registra deuda;
    // para cobrar hay que emitir la boleta/factura (decisión de Antonio, jun 2026).
    // Acá queda únicamente la auto-emisión SUNAT (apagada por defecto).
    if (resultado === "Entregado") {
      // AUTO-EMISIÓN DE COMPROBANTE SUNAT (configurable, no bloqueante).
      // Se activa con AUTO_EMITIR_COMPROBANTE=true en .env. Por defecto OFF para
      // que Antonio decida cuándo facturar cada pedido. Si lo activa:
      //   - Cliente con RUC válido (11 dígitos) → Factura
      //   - Cliente sin RUC → Boleta
      //   - Si ya existe comprobante para este pedido, no duplica
      if (process.env.AUTO_EMITIR_COMPROBANTE === "true") {
        try {
          const dupCheck = (await sql`
            SELECT id FROM comprobantes WHERE pedido_id = ${id}::uuid LIMIT 1
          `) as Array<{ id: string }>;
          if (dupCheck.length === 0) {
            const { emitirComprobante } = await import("@/lib/sunat");
            const { TipoComprobante, TipoDocumentoIdentidad } = await import(
              "@/lib/sunat/types"
            );
            const { empresaFromPedidoString } = await import(
              "@/lib/sunat/config-transavic"
            );
            const datos = (await sql`
              SELECT cliente, razon_social, ruc_dni, empresa
              FROM pedidos WHERE id = ${id}
            `) as Array<{
              cliente: string;
              razon_social: string | null;
              ruc_dni: string | null;
              empresa: string;
            }>;
            const items = (await sql`
              SELECT producto_nombre,
                COALESCE(cantidad_real, cantidad)::numeric AS cantidad,
                unidad,
                COALESCE(precio_unitario, 0)::numeric AS precio_unitario
              FROM pedido_items WHERE pedido_id = ${id}
            `) as Array<{
              producto_nombre: string;
              cantidad: string | number;
              unidad: string;
              precio_unitario: string | number;
            }>;
            const { esRucValido, esReceptorIdentificado } = await import(
              "@/lib/sunat/validacion-cliente"
            );
            const doc = (datos[0]?.ruc_dni ?? "").trim();
            const tieneRuc = esRucValido(doc); // RUC con dígito verificador correcto
            const identificado = esReceptorIdentificado(doc); // DNI u RUC válido
            const nombreCliente = (
              datos[0]?.razon_social ?? datos[0]?.cliente ?? ""
            ).trim();
            const tipo = tieneRuc ? TipoComprobante.FACTURA : TipoComprobante.BOLETA;
            const empresa = empresaFromPedidoString(datos[0]?.empresa ?? "Transavic");
            const IGV_FACTOR = 1.18;
            await emitirComprobante({
              empresa,
              tipo,
              pedidoId: id,
              cliente: identificado
                ? {
                    tipoDocumento: tieneRuc
                      ? TipoDocumentoIdentidad.RUC
                      : TipoDocumentoIdentidad.DNI,
                    numDocumento: doc,
                    razonSocial: (nombreCliente || "CLIENTES VARIOS").toUpperCase(),
                  }
                : {
                    // Sin documento válido → boleta a NOMBRE del cliente (tipo "0",
                    // número "0"), sin inventar un DNI de ceros. Si no hay nombre,
                    // "CLIENTES VARIOS".
                    tipoDocumento: TipoDocumentoIdentidad.SIN_DOCUMENTO,
                    numDocumento: "0",
                    razonSocial: nombreCliente
                      ? nombreCliente.toUpperCase()
                      : "CLIENTES VARIOS",
                  },
              items: items.map((it) => ({
                descripcion: it.producto_nombre,
                unidadMedida: aUnitCodeSunat(it.unidad),
                cantidad: Number(it.cantidad),
                precioUnitario: Number(
                  (Number(it.precio_unitario) / IGV_FACTOR).toFixed(4)
                ),
                igvPorcentaje: 18,
              })),
            });
          }
        } catch (e) {
          console.error("Auto-emisión SUNAT falló (no bloqueante):", e);
        }
      }
    }

    // Notificar a la asesora del pedido (no bloqueante)
    const asesorInfo = await sql`
      SELECT cliente, asesor_id FROM pedidos WHERE id = ${id}
    `;
    if (asesorInfo.length > 0 && asesorInfo[0].asesor_id) {
      if (resultado === "Entregado") {
        await crearNotificacion({
          userId: asesorInfo[0].asesor_id as string,
          tipo: "pedido_entregado",
          titulo: "✅ Pedido entregado",
          mensaje: `Cliente: ${asesorInfo[0].cliente} · Entregado por ${entregadoPor}`,
          link: "/dashboard",
          pedidoId: id,
        });

        // ¿Esta entrega hizo que la asesora cruce su meta del día? Avisar UNA sola
        // vez (mismo cálculo que /api/metas → consistente con su barra de progreso).
        // No bloqueante: si algo falla, la entrega igual queda registrada.
        try {
          const asesorId = asesorInfo[0].asesor_id as string;
          const [vendidoHoy, meta] = await Promise.all([
            ventasHoy(asesorId),
            calcularMetaDiaria(asesorId),
          ]);
          if (meta.metaDiaria > 0 && vendidoHoy >= meta.metaDiaria) {
            const yaAvisado = (await sql`
              SELECT 1 FROM notificaciones
              WHERE user_id = ${asesorId}
                AND tipo = 'meta_diaria_alcanzada'
                AND DATE(created_at AT TIME ZONE 'America/Lima')
                    = (NOW() AT TIME ZONE 'America/Lima')::date
              LIMIT 1
            `) as Array<unknown>;
            if (yaAvisado.length === 0) {
              await crearNotificacion({
                userId: asesorId,
                tipo: "meta_diaria_alcanzada",
                titulo: "🎯 ¡Meta del día alcanzada!",
                mensaje: `Llegaste a tu meta de hoy (S/ ${meta.metaDiaria.toFixed(2)}). ¡Bien ahí! 🎉`,
                link: "/dashboard/mis-metas",
              });
            }
          }
        } catch (e) {
          console.error("Chequeo de meta diaria falló (no crítico):", e);
        }
      } else {
        await crearNotificacion({
          userId: asesorInfo[0].asesor_id as string,
          tipo: "pedido_fallido",
          titulo: "❌ Pedido NO entregado",
          mensaje: `Cliente: ${asesorInfo[0].cliente} · Razón: ${razon_fallo ?? "sin razón"}`,
          link: "/dashboard",
          pedidoId: id,
        });
      }
    }

    return NextResponse.json({
      message: resultado === "Entregado" ? "Pedido entregado exitosamente" : "Pedido marcado como no entregado",
      estado: resultado,
    });
  } catch (error) {
    console.error("Error al entregar pedido:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PATCH: Revertir entrega (deshacer Entregado/Fallido → Asignado)
export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const id = segments[segments.length - 2];

    if (!id) {
      return NextResponse.json({ error: "ID del pedido no encontrado" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    const pedidoResult = await sql`
      SELECT id, estado, repartidor_id FROM pedidos WHERE id = ${id}
    `;

    if (pedidoResult.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }

    const pedido = pedidoResult[0];

    // Solo admin o el repartidor asignado
    if (session.user.role !== "admin" && pedido.repartidor_id !== session.user.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    // Solo se puede revertir Entregado o Fallido
    if (pedido.estado !== "Entregado" && pedido.estado !== "Fallido") {
      return NextResponse.json(
        { error: `Solo se puede revertir desde "Entregado" o "Fallido". Estado actual: "${pedido.estado}"` },
        { status: 400 }
      );
    }

    await sql`
      UPDATE pedidos
      SET estado = 'Asignado',
          entregado = FALSE,
          entregado_por = NULL,
          entregado_at = NULL,
          razon_fallo = NULL,
          inicio_viaje_at = NULL,
          hora_llegada_estimada = NULL
      WHERE id = ${id}
    `;

    return NextResponse.json({
      message: "Entrega revertida. El pedido vuelve a Asignado.",
      estado: "Asignado",
    });
  } catch (error) {
    console.error("Error al revertir entrega:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

