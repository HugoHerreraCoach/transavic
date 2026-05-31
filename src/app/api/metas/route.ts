// src/app/api/metas/route.ts
// GET /api/metas — meta del día + progreso real para la asesora logueada.
// Admin puede consultar con ?asesor_id=...
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  calcularMetaDiaria,
  ventasMesActual,
  ventasHoy,
  ventasSemana,
  rachaDiaria,
  getBonoMensual,
} from "@/lib/metas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const asesorIdParam = searchParams.get("asesor_id");

    // Asesora ve su propia meta; admin puede pedir cualquiera
    let asesorId = session.user.id;
    if (asesorIdParam && session.user.role === "admin") {
      asesorId = asesorIdParam;
    }

    const meta = await calcularMetaDiaria(asesorId);
    const [ventasMes, ventasDia, ventasSem, racha, bono] = await Promise.all([
      ventasMesActual(asesorId),
      ventasHoy(asesorId),
      ventasSemana(asesorId),
      rachaDiaria(asesorId),
      getBonoMensual(asesorId),
    ]);
    const metaSemanal = Number((meta.metaDiaria * 6).toFixed(2)); // lun–sáb

    return NextResponse.json({
      ...meta,
      ventasMesActual: ventasMes,
      ventasHoy: ventasDia,
      ventasSemana: ventasSem,
      metaSemanal,
      racha,
      bono, // bono personalizado al cumplir la meta del mes ("" si no hay)
      porcentajeAvanceMensual:
        meta.metaMensual > 0
          ? Math.round((ventasMes / meta.metaMensual) * 100)
          : 0,
      porcentajeAvanceDiario:
        meta.metaDiaria > 0
          ? Math.round((ventasDia / meta.metaDiaria) * 100)
          : 0,
      porcentajeAvanceSemanal:
        metaSemanal > 0 ? Math.round((ventasSem / metaSemanal) * 100) : 0,
      diferenciaVsMetaAcumulada: Number(
        (ventasMes - meta.metaAcumuladaHoy).toFixed(2)
      ),
    });
  } catch (error) {
    console.error("Error en GET /api/metas:", error);
    return NextResponse.json(
      { error: "Error al calcular meta" },
      { status: 500 }
    );
  }
}
