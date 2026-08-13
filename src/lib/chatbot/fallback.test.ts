import { describe, expect, it } from "vitest";
import {
  botDebeResponder,
  mensajeCierreFueraDeHorario,
  textoDias,
  textoHorario,
} from "@/lib/chatbot/fallback";
import { CONFIG_BOT_DEFAULT, type ConfigBot } from "@/lib/chatbot/config-bot";

const cfg = (over: Partial<ConfigBot> = {}): ConfigBot => ({
  ...CONFIG_BOT_DEFAULT,
  ...over,
});

describe("botDebeResponder", () => {
  it("por defecto el bot cubre el hueco: calla de día, habla de noche", () => {
    // El default es "fuera_horario" — decisión de Hugo (13 ago 2026).
    expect(CONFIG_BOT_DEFAULT.cuando_responde).toBe("fuera_horario");
    expect(botDebeResponder({ cfg: cfg(), dentroDeAtencion: true })).toBe(false);
    expect(botDebeResponder({ cfg: cfg(), dentroDeAtencion: false })).toBe(true);
  });

  it('en modo "siempre" responde a cualquier hora', () => {
    const c = cfg({ cuando_responde: "siempre" });
    expect(botDebeResponder({ cfg: c, dentroDeAtencion: true })).toBe(true);
    expect(botDebeResponder({ cfg: c, dentroDeAtencion: false })).toBe(true);
  });

  it("el interruptor general lo apaga aunque sea de noche", () => {
    const c = cfg({ activo: false });
    expect(botDebeResponder({ cfg: c, dentroDeAtencion: false })).toBe(false);
    expect(botDebeResponder({ cfg: c, dentroDeAtencion: true })).toBe(false);
  });

  it('el interruptor general manda también sobre "siempre"', () => {
    const c = cfg({ activo: false, cuando_responde: "siempre" });
    expect(botDebeResponder({ cfg: c, dentroDeAtencion: false })).toBe(false);
  });
});

describe("textoHorario", () => {
  it("arma el horario que ve el cliente", () => {
    // Default: lunes a sábado, 8:00 a 20:00.
    expect(textoHorario(cfg())).toBe("lunes a sábado de 8:00 a 20:00");
  });

  it("refleja un horario personalizado", () => {
    const c = cfg({
      dias_atencion: [1, 2, 3, 4, 5],
      atencion_hora_inicio: 9,
      atencion_hora_fin: 18,
    });
    expect(textoHorario(c)).toBe("lunes a viernes de 9:00 a 18:00");
  });
});

describe("textoDias", () => {
  it("colapsa los días consecutivos en un rango", () => {
    expect(textoDias([1, 2, 3, 4, 5, 6])).toBe("lunes a sábado");
  });

  it("enumera los días sueltos", () => {
    expect(textoDias([1, 3, 5])).toBe("lunes, miércoles, viernes");
  });

  it("un solo día no se escribe como rango", () => {
    expect(textoDias([7])).toBe("domingo");
  });

  it("sin días válidos no inventa un horario falso", () => {
    expect(textoDias([])).toBe("todos los días");
    expect(textoDias([0, 9])).toBe("todos los días");
  });

  it("ordena y deduplica", () => {
    expect(textoDias([3, 1, 2, 2])).toBe("lunes a miércoles");
  });
});

describe("mensajeCierreFueraDeHorario", () => {
  it("dice el horario y que retoman al abrir", () => {
    const texto = mensajeCierreFueraDeHorario(cfg());
    expect(texto).toContain("lunes a sábado de 8:00 a 20:00");
    expect(texto.toLowerCase()).toContain("apenas empecemos el día");
  });

  it("no promete una respuesta inmediata", () => {
    const texto = mensajeCierreFueraDeHorario(cfg()).toLowerCase();
    // El punto del mensaje es NO dejar al cliente esperando a alguien que no está.
    expect(texto).not.toContain("en breve");
    expect(texto).not.toContain("en unos minutos");
    expect(texto).not.toContain("ahora mismo");
  });
});
