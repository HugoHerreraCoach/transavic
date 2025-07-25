// src/app/api/dashboard/pedidos/route.ts
import { fetchFilteredPedidos } from "@/lib/data";
import { NextResponse } from "next/server";
import { auth } from "@/auth"; // 👈 Importa 'auth'

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth(); // ✅ Obtenemos la sesión del usuario

    // Si no hay sesión o usuario, denegar acceso
    if (!session?.user) {
      return NextResponse.json({ message: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") || "";
    const fecha = searchParams.get("fecha") || "";
    const currentPage = Number(searchParams.get("page")) || 1;

    // ⚙️ Pasamos la sesión completa a la función de fetching
    const result = await fetchFilteredPedidos(
      query,
      fecha,
      currentPage,
      session
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { message: "Error al obtener los pedidos" },
      { status: 500 }
    );
  }
}