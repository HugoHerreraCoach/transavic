// src/app/api/incentivos/route.ts
// GET  — config + progreso de meta de equipo + ranking mensual (admin y asesor).
// POST — guarda la configuración de incentivos (solo admin).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import {
  getIncentivosConfig,
  saveIncentivosConfig,
  getVendidoEquipoSemana,
  getRankingMensual,
} from "@/lib/incentivos";
import { getRachaSemanal, type RachaSemanal } from "@/lib/metas";

export const dynamic = "force-dynamic";

const ConfigSchema = z.object({
  metaEquipoSemanal: z.object({
    activo: z.boolean(),
    criterio: z.enum(["monto", "pedidos"]),
    monto: z.number().min(0).max(10000000),
    premio: z.string().max(120),
  }),
  rankingMensual: z.object({
    activo: z.boolean(),
    criterio: z.enum(["monto", "pedidos"]),
    premios: z
      .array(
        z.object({
          puesto: z.number().int().min(1).max(20),
          premio: z.string().max(120),
        })
      )
      .max(20),
  }),
  rachaSemanal: z.object({
    activo: z.boolean(),
    diaFin: z.number().int().min(1).max(6),
    criterio: z.enum(["monto", "pedidos"]),
    minimoDiario: z.number().min(0).max(10000000),
    premio: z.string().max(120),
  }),
  metasIndividuales: z.object({ activo: z.boolean() }),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!["admin", "asesor"].includes(session.user.role))
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  const config = await getIncentivosConfig();

  let equipo: {
    activo: boolean;
    criterio: "monto" | "pedidos";
    meta: number;
    vendido: number;
    premio: string;
    porcentaje: number;
  } | null = null;
  if (config.metaEquipoSemanal.activo) {
    const criterio = config.metaEquipoSemanal.criterio;
    const vendido = await getVendidoEquipoSemana(criterio);
    const meta = config.metaEquipoSemanal.monto;
    equipo = {
      activo: true,
      criterio,
      meta,
      vendido,
      premio: config.metaEquipoSemanal.premio,
      porcentaje: meta > 0 ? Math.round((vendido / meta) * 100) : 0,
    };
  }

  let ranking: Array<{
    asesorId: string;
    nombre: string;
    valor: number;
    puesto: number;
    premio: string | null;
    esTu: boolean;
  }> = [];
  if (config.rankingMensual.activo) {
    const filas = await getRankingMensual(config.rankingMensual.criterio);
    const premioDe = (puesto: number) =>
      config.rankingMensual.premios.find((p) => p.puesto === puesto)?.premio ?? null;
    ranking = filas.map((f) => ({
      ...f,
      premio: premioDe(f.puesto),
      esTu: f.asesorId === session.user.id,
    }));
  }

  let racha:
    | (RachaSemanal & { activo: true; diaFin: number; premio: string })
    | null = null;
  if (config.rachaSemanal.activo) {
    const r = await getRachaSemanal(
      session.user.id,
      config.rachaSemanal.diaFin,
      config.rachaSemanal.criterio,
      config.rachaSemanal.minimoDiario
    );
    racha = {
      activo: true,
      diaFin: config.rachaSemanal.diaFin,
      premio: config.rachaSemanal.premio,
      ...r,
    };
  }

  return NextResponse.json({
    config,
    criterio: config.rankingMensual.criterio,
    equipo,
    ranking,
    racha,
    metasIndividuales: config.metasIndividuales,
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });

  let body;
  try {
    body = ConfigSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Datos inválidos", detalle: (err as Error).message },
      { status: 400 }
    );
  }

  // Ordenar premios por puesto antes de guardar (consistencia).
  body.rankingMensual.premios.sort((a, b) => a.puesto - b.puesto);
  await saveIncentivosConfig(body);
  return NextResponse.json({ message: "Configuración guardada" });
}
