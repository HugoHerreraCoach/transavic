// src/app/api/reportes/ventas/export-xlsx/route.ts
// GET — descarga el reporte de ventas como .xlsx (mismo dato que la pantalla).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { obtenerReporteVentas, etiquetaPeriodo } from "@/lib/reportes/datos-ventas";
import { generarBufferExcelVentas } from "@/lib/reportes/excel-ventas";

export const dynamic = "force-dynamic";

const esFecha = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const hoy = hoyLocal();
  const desde = esFecha(sp.get("desde")) ? sp.get("desde")! : hoy.slice(0, 8) + "01";
  const hasta = esFecha(sp.get("hasta")) ? sp.get("hasta")! : hoy;

  try {
    const reporte = await obtenerReporteVentas(desde, hasta);
    const buf = generarBufferExcelVentas(reporte, etiquetaPeriodo(desde, hasta));
    const filename = `reporte-ventas-${desde}_al_${hasta}.xlsx`;

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (error) {
    console.error("Error en export-xlsx ventas:", error);
    return NextResponse.json({ error: "Error al generar el Excel" }, { status: 500 });
  }
}
