// src/app/api/dashboard/pedidos/route.ts
import { fetchFilteredPedidos } from "@/lib/data";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") || "";
    const fecha = searchParams.get("fecha") || "";
    const currentPage = Number(searchParams.get("page")) || 1;

    const result = await fetchFilteredPedidos(query, fecha, currentPage);

    return NextResponse.json(result);
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { message: "Error al obtener los pedidos" },
      { status: 500 }
    );
  }
}