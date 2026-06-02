// src/app/api/comprobantes/emitir/route.ts
// POST — emite comprobante para un pedido (factura o boleta).
import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { emitirComprobante } from "@/lib/sunat";
import {
  TipoComprobante,
  TipoDocIdentidad,
  EstadoSunat,
} from "@/lib/sunat/types";
import { empresaFromPedidoString } from "@/lib/sunat/config-transavic";
import { notificarComprobanteConProblema } from "@/lib/notificaciones";

export const dynamic = "force-dynamic";

const Schema = z.object({
  pedido_id: z.string().uuid(),
  tipo: z.enum(["01", "03"]),
  formaPago: z.enum(["Contado", "Credito"]).default("Contado"),
  plazoDias: z.number().int().min(0).max(120).default(0),
  yaCobrado: z.boolean().default(false),
  // Datos del receptor desde el form (al facturar desde el modal). Si no vienen,
  // se usan los del pedido en DB. Evita el error SUNAT 2021 (razón social vacía).
  cliente_override: z
    .object({
      numDocumento: z.string().trim().optional(),
      razonSocial: z.string().trim().optional(),
      direccion: z.string().trim().max(250).optional(),
    })
    .optional(),
  // Items opcionales: si se pasan, se usan estos (para edits "antes de emitir").
  // Si no, se usan los items del pedido tal cual están en DB.
  items_override: z
    .array(
      z.object({
        producto_nombre: z.string(),
        cantidad: z.number().positive(),
        unidad: z.string(),
        precio_unitario: z.number().positive(),
        codigo: z.string().trim().optional(),
      })
    )
    .optional(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!["asesor", "admin"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Solo asesores o admin pueden emitir comprobantes" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Cargar pedido + verificar ownership
    const pedidoRows = (await sql`
      SELECT cliente_id, cliente, razon_social, ruc_dni, empresa, asesor_id
      FROM pedidos WHERE id = ${parsed.data.pedido_id}
    `) as Array<{
      cliente_id: string | null;
      cliente: string;
      razon_social: string | null;
      ruc_dni: string | null;
      empresa: string;
      asesor_id: string | null;
    }>;

    if (pedidoRows.length === 0) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    const pedido = pedidoRows[0];

    if (session.user.role === "asesor" && pedido.asesor_id !== session.user.id) {
      return NextResponse.json(
        { error: "No puedes emitir comprobantes de pedidos ajenos" },
        { status: 403 }
      );
    }

    // Datos del receptor: preferir lo que mandó el form (cliente_override) y, si
    // no, lo del pedido. Se usa `||` (no `??`) a propósito: un razon_social ""
    // (string vacío) cae al nombre del cliente → evita el error SUNAT 2021
    // ("RegistrationName del receptor vacío").
    const ov = parsed.data.cliente_override;
    const cliNumDoc = (ov?.numDocumento?.trim() || pedido.ruc_dni || "").trim();
    const cliRazon = (
      ov?.razonSocial?.trim() ||
      pedido.razon_social?.trim() ||
      pedido.cliente ||
      ""
    ).trim();
    const cliDireccion = ov?.direccion?.trim() || undefined;
    const tieneRuc = /^\d{11}$/.test(cliNumDoc);

    // Validación: factura requiere RUC del cliente (11 dígitos) + razón social.
    if (parsed.data.tipo === "01" && !tieneRuc) {
      return NextResponse.json(
        {
          error:
            "Para emitir FACTURA el cliente debe tener RUC (11 dígitos). Para personas naturales emitir BOLETA.",
        },
        { status: 400 }
      );
    }
    if (parsed.data.tipo === "01" && !cliRazon) {
      return NextResponse.json(
        { error: "La factura requiere la razón social del cliente." },
        { status: 400 }
      );
    }

    // Cargar items (de override o de DB)
    let items: Array<{
      producto_nombre: string;
      cantidad: number;
      unidad: string;
      precio_unitario: number;
      codigo?: string;
    }>;
    if (parsed.data.items_override) {
      items = parsed.data.items_override;
    } else {
      const rows = (await sql`
        SELECT producto_nombre,
          COALESCE(cantidad_real, cantidad)::numeric AS cantidad,
          unidad,
          COALESCE(precio_unitario, 0)::numeric AS precio_unitario
        FROM pedido_items
        WHERE pedido_id = ${parsed.data.pedido_id}
      `) as Array<{
        producto_nombre: string;
        cantidad: string | number;
        unidad: string;
        precio_unitario: string | number;
      }>;
      items = rows.map((r) => ({
        producto_nombre: r.producto_nombre,
        cantidad: Number(r.cantidad),
        unidad: r.unidad,
        precio_unitario: Number(r.precio_unitario),
      }));
    }

    if (items.length === 0 || items.every((it) => it.precio_unitario === 0)) {
      return NextResponse.json(
        {
          error:
            "Los items no tienen precio definido. Asegúrate de que los productos tengan precio en /dashboard/precios.",
        },
        { status: 400 }
      );
    }

    const empresa = empresaFromPedidoString(pedido.empresa);

    // ════════════════════════════════════════════════════════════════════
    // CONVENCIÓN CRÍTICA DE PRECIOS (decisión de negocio Transavic 2026):
    //
    // Los precios en `productos.precio_venta` y `pedido_items.precio_unitario`
    // se ALMACENAN CON IGV INCLUIDO (lo que Antonio cobra al cliente final).
    //
    // Razones:
    //   1. Antonio piensa en "vendo el pollo a S/12" (con IGV), no en
    //      "S/10.17 + IGV". Carga precios "como los cobra".
    //   2. Las asesoras ven precios CON IGV en el ticket que se manda por WA.
    //   3. SUNAT solo necesita el desglose en el XML (lo calculamos abajo).
    //
    // Por eso ANTES de mandar a SUNAT dividimos entre 1.18 para obtener el
    // valor neto (sin IGV). El IGV se suma automáticamente en xml-builder.
    //
    // Si esta convención cambia, actualizar:
    //   - CLAUDE.md §12 (gotchas)
    //   - /dashboard/precios (UI debería decir "Precio CON IGV")
    //   - scripts/seed-precios-2026.mjs (verificar)
    // ════════════════════════════════════════════════════════════════════
    const IGV_FACTOR = 1.18;

    // Código interno por producto (SellersItemIdentification): lookup en el
    // catálogo por nombre (código estable); fallback secuencial si el producto
    // no está catalogado. Así el XML siempre lleva el código del producto.
    const codRows = (await sql`
      SELECT LOWER(TRIM(nombre)) AS nom, codigo
      FROM productos WHERE codigo IS NOT NULL AND codigo <> ''
    `) as Array<{ nom: string; codigo: string }>;
    const codMap = new Map(codRows.map((r) => [r.nom, r.codigo]));

    const itemsSunat = items.map((it, idx) => {
      const precioConIgv = it.precio_unitario;
      const precioSinIgv = precioConIgv / IGV_FACTOR;
      // Sanity check: detectar precios sospechosos (negativos, infinitos, NaN)
      if (
        !Number.isFinite(precioSinIgv) ||
        precioSinIgv <= 0 ||
        precioConIgv > 100000
      ) {
        throw new Error(
          `Precio inválido para "${it.producto_nombre}": ${it.precio_unitario}. Revisar catálogo.`
        );
      }
      return {
        codigo:
          it.codigo ||
          codMap.get(it.producto_nombre.trim().toLowerCase()) ||
          `P${String(idx + 1).padStart(3, "0")}`,
        descripcion: it.producto_nombre,
        unidadMedida: it.unidad === "kg" ? "KGM" : "NIU",
        cantidad: it.cantidad,
        precioUnitario: Number(precioSinIgv.toFixed(4)),
        igvPorcentaje: 18,
      };
    });

    // Sanity check global: el total con IGV debe ser razonable (>0, <500K).
    const totalConIgv = items.reduce(
      (sum, it) => sum + it.precio_unitario * it.cantidad,
      0
    );
    if (totalConIgv <= 0 || totalConIgv > 500000) {
      return NextResponse.json(
        {
          error: `Total del comprobante fuera de rango (S/ ${totalConIgv.toFixed(2)}). Revisar precios y cantidades.`,
        },
        { status: 400 }
      );
    }

    // Regla SUNAT: una boleta > S/700 exige identificar al cliente con DNI o RUC.
    const esDniCliente = /^\d{8}$/.test(cliNumDoc);
    if (parsed.data.tipo === "03" && totalConIgv > 700 && !esDniCliente && !tieneRuc) {
      return NextResponse.json(
        {
          error:
            "Las boletas mayores a S/700 requieren el DNI o RUC del cliente (regla SUNAT). Edita el cliente y agrega su documento.",
        },
        { status: 400 }
      );
    }

    const resultado = await emitirComprobante({
      empresa,
      tipo: parsed.data.tipo as TipoComprobante,
      pedidoId: parsed.data.pedido_id,
      cliente: {
        tipoDocumento: tieneRuc ? TipoDocIdentidad.RUC : TipoDocIdentidad.DNI,
        numDocumento: cliNumDoc || "00000000",
        razonSocial: cliRazon,
        direccion: cliDireccion,
      },
      items: itemsSunat,
      formaPago: parsed.data.formaPago,
      plazoDias: parsed.data.plazoDias,
      emitidoPor: session.user.name?.trim() || undefined,
    });

    // P2.10 — Notificar al admin (y a la asesora del pedido) si SUNAT rechaza
    // o hay error de infra. Silencioso si falla — no rompe la respuesta.
    if (
      resultado.estado === EstadoSunat.RECHAZADA ||
      resultado.estado === EstadoSunat.ERROR
    ) {
      await notificarComprobanteConProblema({
        comprobanteId: "",
        serieNumero: resultado.serieNumero ?? null,
        tipo: parsed.data.tipo,
        estado: resultado.estado === EstadoSunat.RECHAZADA ? "RECHAZADA" : "ERROR",
        mensajeSunat: resultado.mensaje ?? null,
        pedidoId: parsed.data.pedido_id,
        empresa,
        asesorId: pedido.asesor_id ?? null,
      });
    }

    // Regla del negocio: por defecto TODA factura (tipo 01) crea una cobranza, sea
    // Contado o Crédito, porque en Transavic la mayoría se emite "Contado" pero el
    // cliente paga después. Excepción: el usuario marca `yaCobrado` (cash de mano)
    // → no se crea cobranza. Boletas (tipo 03) NUNCA crean cobranza (consumidor cash).
    // Solo se crea si SUNAT aceptó (o el comprobante quedó pendiente por falta de cert);
    // si fue rechazado/erró, no registramos deuda inválida ni duplicamos al reintentar.
    const emisionOk =
      resultado.estado === EstadoSunat.ACEPTADA ||
      resultado.estado === EstadoSunat.ACEPTADA_CON_OBSERVACIONES ||
      resultado.estado === EstadoSunat.PENDIENTE;
    const esCredito = parsed.data.formaPago === "Credito";
    const facturaContadoSinCobrar =
      parsed.data.tipo === "01" && !esCredito && !parsed.data.yaCobrado;
    const debeCrearCobranza =
      !!resultado.serieNumero && emisionOk && (esCredito || facturaContadoSinCobrar);

    if (debeCrearCobranza) {
      try {
        const { crearFacturaStandalone, plazoDeCobranza } = await import("@/lib/cobranzas");
        await crearFacturaStandalone({
          clienteNombre: pedido.razon_social ?? pedido.cliente,
          clienteId: pedido.cliente_id,
          asesorId: session.user.role === "asesor" ? session.user.id : null,
          monto: totalConIgv,
          // Crédito → plazo del form. Contado → plazo del CLIENTE
          // (plazo_pago_dias) o el default del negocio, en vez de vencer hoy.
          plazoDias: esCredito
            ? parsed.data.plazoDias
            : await plazoDeCobranza(pedido.cliente_id),
          numeroComprobante: resultado.serieNumero,
          pedidoId: parsed.data.pedido_id,
        });
      } catch (errCobranza) {
        console.error(
          "Comprobante emitido para pedido pero no se pudo crear la cobranza asociada:",
          errCobranza
        );
      }
    }

    // Recuperar el id del comprobante recién creado para que el ticket de éxito
    // muestre el botón "Descargar PDF" (igual que la emisión standalone).
    let comprobanteId: string | undefined;
    if (resultado.serieNumero) {
      try {
        const idRows = (await sql`
          SELECT id FROM comprobantes
          WHERE empresa = ${empresa} AND serie_numero = ${resultado.serieNumero}
          ORDER BY created_at DESC LIMIT 1
        `) as Array<{ id: string }>;
        comprobanteId = idRows[0]?.id;
      } catch {
        // si el lookup falla, el ticket igual ofrece "Ver comprobantes"
      }
    }

    return NextResponse.json({ ...resultado, id: comprobanteId });
  } catch (error) {
    console.error("Error en POST /api/comprobantes/emitir:", error);
    return NextResponse.json(
      { error: "Error al emitir comprobante" },
      { status: 500 }
    );
  }
}
