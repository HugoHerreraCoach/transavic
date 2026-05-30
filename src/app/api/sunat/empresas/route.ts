// src/app/api/sunat/empresas/route.ts
// GET — datos PÚBLICOS del emisor (RUC + razón social) de ambas empresas.
// Lo usa el form de emisión cuando se renderiza fuera de su página server
// (ej. embebido en un modal desde la lista de pedidos). No expone secretos
// (certificado, clave SOL) — solo lo que ya aparece en cualquier comprobante.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSunatConfig } from "@/lib/sunat/config-transavic";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!["asesor", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const tra = getSunatConfig("transavic");
  const avi = getSunatConfig("avicola");
  return NextResponse.json({
    transavic: { ruc: tra.ruc, razonSocial: tra.razonSocial },
    avicola: { ruc: avi.ruc, razonSocial: avi.razonSocial },
  });
}
