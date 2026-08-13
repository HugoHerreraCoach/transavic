import { describe, expect, it } from "vitest";
import { ordenarPorEquidad, type AsesoraRotacion } from "@/lib/chatbot/equidad-leads";

function asesora(over: Partial<AsesoraRotacion> & { name: string }): AsesoraRotacion {
  return {
    id: `id-${over.name}`,
    orden_rotacion: 1,
    leads_recibidos_hoy: 0,
    ultimo_lead_at: null,
    ...over,
  };
}

/** Quién recibe el próximo lead. */
const proxima = (lista: AsesoraRotacion[]) => [...lista].sort(ordenarPorEquidad)[0].name;

describe("ordenarPorEquidad", () => {
  it("le toca a la que menos leads lleva hoy", () => {
    const pool = [
      asesora({ name: "Jhoselyn", leads_recibidos_hoy: 3 }),
      asesora({ name: "Saraí", leads_recibidos_hoy: 1 }),
    ];
    expect(proxima(pool)).toBe("Saraí");
  });

  it("empatadas en carga, gana la que hace más tiempo que no recibe", () => {
    const pool = [
      asesora({
        name: "Jhoselyn",
        leads_recibidos_hoy: 2,
        ultimo_lead_at: "2026-08-13T15:00:00Z",
      }),
      asesora({
        name: "Saraí",
        leads_recibidos_hoy: 2,
        ultimo_lead_at: "2026-08-13T09:00:00Z",
      }),
    ];
    expect(proxima(pool)).toBe("Saraí");
  });

  it("quien nunca recibió va primero, aunque la otra tenga la misma carga", () => {
    const pool = [
      asesora({
        name: "Jhoselyn",
        leads_recibidos_hoy: 0,
        ultimo_lead_at: "2026-08-13T09:00:00Z",
      }),
      asesora({ name: "Saraí", leads_recibidos_hoy: 0, ultimo_lead_at: null }),
    ];
    expect(proxima(pool)).toBe("Saraí");
  });

  it("la carga manda sobre la antigüedad", () => {
    // Jhoselyn no recibe hace días, pero hoy ya lleva 5; Saraí lleva 1.
    const pool = [
      asesora({
        name: "Jhoselyn",
        leads_recibidos_hoy: 5,
        ultimo_lead_at: "2026-08-01T09:00:00Z",
      }),
      asesora({
        name: "Saraí",
        leads_recibidos_hoy: 1,
        ultimo_lead_at: "2026-08-13T18:00:00Z",
      }),
    ];
    expect(proxima(pool)).toBe("Saraí");
  });

  it("acepta Date además de string", () => {
    const pool = [
      asesora({ name: "Jhoselyn", ultimo_lead_at: new Date("2026-08-13T15:00:00Z") }),
      asesora({ name: "Saraí", ultimo_lead_at: new Date("2026-08-13T09:00:00Z") }),
    ];
    expect(proxima(pool)).toBe("Saraí");
  });

  it("trata null en la carga como cero", () => {
    const pool = [
      asesora({ name: "Jhoselyn", leads_recibidos_hoy: null }),
      asesora({ name: "Saraí", leads_recibidos_hoy: 2 }),
    ];
    expect(proxima(pool)).toBe("Jhoselyn");
  });

  it("con todo empatado desempata por nombre y es determinista", () => {
    const pool = [asesora({ name: "Saraí" }), asesora({ name: "Jhoselyn" })];
    // Mismo resultado sin importar el orden de entrada: si no, dos servidores
    // podrían elegir distinto para el mismo lead.
    expect(proxima(pool)).toBe("Jhoselyn");
    expect(proxima([...pool].reverse())).toBe("Jhoselyn");
  });

  it("reparte parejo a lo largo del día", () => {
    // Simula 6 leads seguidos: cada asignación sube la carga de quien lo recibe.
    const pool = [asesora({ name: "Jhoselyn" }), asesora({ name: "Saraí" })];
    const recibidos: string[] = [];
    for (let i = 0; i < 6; i++) {
      const elegida = [...pool].sort(ordenarPorEquidad)[0];
      recibidos.push(elegida.name);
      elegida.leads_recibidos_hoy = (elegida.leads_recibidos_hoy ?? 0) + 1;
      elegida.ultimo_lead_at = new Date(2026, 7, 13, 10, i).toISOString();
    }
    // Alterna, y termina 3 y 3.
    expect(recibidos).toEqual([
      "Jhoselyn",
      "Saraí",
      "Jhoselyn",
      "Saraí",
      "Jhoselyn",
      "Saraí",
    ]);
    expect(pool.map((a) => a.leads_recibidos_hoy)).toEqual([3, 3]);
  });

  it("una asesora que arranca atrasada se empareja sola", () => {
    // Jhoselyn viene de un día con 3; Saraí con 0. Los próximos 3 son de Saraí.
    const pool = [
      asesora({ name: "Jhoselyn", leads_recibidos_hoy: 3 }),
      asesora({ name: "Saraí", leads_recibidos_hoy: 0 }),
    ];
    const recibidos: string[] = [];
    for (let i = 0; i < 3; i++) {
      const elegida = [...pool].sort(ordenarPorEquidad)[0];
      recibidos.push(elegida.name);
      elegida.leads_recibidos_hoy = (elegida.leads_recibidos_hoy ?? 0) + 1;
    }
    expect(recibidos).toEqual(["Saraí", "Saraí", "Saraí"]);
    expect(pool.map((a) => a.leads_recibidos_hoy)).toEqual([3, 3]);
  });
});
