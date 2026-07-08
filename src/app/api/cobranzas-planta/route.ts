// src/app/api/cobranzas-planta/route.ts
// GET — cobranzas (deudas) + resumen de clientes con saldo de la operación 3
// (Venta en Planta / POS). La vista de cobranzas de planta usa AMBOS:
// las deudas (una fila por venta a crédito) y el resumen por cliente ("saldito").
// admin + produccion (el POS/planta lo operan los dos). Aislado de `facturas`.
import { auth } from "@/auth";
import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import {
  listaCobranzasPlanta,
  listaClientesPlantaConSaldo,
} from "@/lib/planta/saldos";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "produccion") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    const clienteIdRaw = req.nextUrl.searchParams.get("cliente_id");
    let clienteId: string | undefined;
    if (clienteIdRaw) {
      if (!/^[0-9a-f-]{36}$/i.test(clienteIdRaw)) {
        return NextResponse.json({ error: "cliente_id inválido" }, { status: 400 });
      }
      clienteId = clienteIdRaw;
    }

    const sql = neon(process.env.DATABASE_URL!);

    const cobranzas = await listaCobranzasPlanta(sql, clienteId);
    const todosClientes = await listaClientesPlantaConSaldo(sql);
    const clientes = clienteId
      ? todosClientes.filter((c) => c.id === clienteId)
      : todosClientes;

    return NextResponse.json({ cobranzas, clientes });
  } catch (error: unknown) {
    console.error("Error al listar cobranzas de planta:", error);
    return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
  }
}
