// src/app/api/consulta-documento/route.ts
// POST { tipo: "ruc" | "dni", numero: string } → datos del documento.
// El token de apisperu queda server-side; el número va en el body (no en la URL,
// para no dejar PII/documentos en logs ni en el historial del navegador).

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { consultarRuc, consultarDni } from "@/lib/apisperu";

export const dynamic = "force-dynamic";

const Schema = z.object({
  tipo: z.enum(["ruc", "dni"]),
  numero: z.string().regex(/^\d{8}$|^\d{11}$/, "El número debe tener 8 (DNI) u 11 (RUC) dígitos"),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!["asesor", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permisos para consultar documentos" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { tipo, numero } = parsed.data;
  const resultado =
    tipo === "ruc" ? await consultarRuc(numero) : await consultarDni(numero);

  if (!resultado.ok) {
    const status =
      resultado.code === "NO_ENCONTRADO"
        ? 404
        : resultado.code === "FORMATO"
          ? 400
          : resultado.code === "CUOTA"
            ? 429
            : resultado.code === "TOKEN"
              ? 503
              : 502; // RED / DESCONOCIDO → problema del proveedor
    return NextResponse.json({ error: resultado.mensaje, code: resultado.code }, { status });
  }

  return NextResponse.json(resultado);
}
