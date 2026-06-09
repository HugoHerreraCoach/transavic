// GET /api/sunat/entorno — expone SOLO el entorno SUNAT activo (beta | production).
// No es dato sensible (no expone credenciales). Lo usa el modal de Guía de Remisión
// (cliente) para mostrar el banner correcto (Beta vs Producción), ya que el modal se
// abre desde varios client components y no recibe el entorno por props.
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const environment = (process.env.SUNAT_ENVIRONMENT || "beta").toLowerCase();
  const esProduccion = environment === "production";

  return NextResponse.json({ environment, esProduccion });
}
