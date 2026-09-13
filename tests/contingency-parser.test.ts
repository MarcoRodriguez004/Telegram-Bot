import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

describe("contingency intents", () => {
  it("parses vehicle registration in natural language without storing a full plate", () => {
    expect(parseIntent("Registra mi vehículo, holograma 0 y placa terminada en 6")).toEqual({
      action: "register_vehicle",
      hologram: "0",
      plateLastDigit: 6,
    });
  });

  it("parses an optional vehicle label", () => {
    expect(parseIntent("/vehiculo familiar holograma 00 y placa terminada en 0")).toEqual({
      action: "register_vehicle",
      label: "familiar",
      hologram: "00",
      plateLastDigit: 0,
    });
  });

  it("parses the natural wording used to register a named vehicle", () => {
    expect(parseIntent("Registra este vehículo Focus holograma 0 con terminación 5")).toEqual({
      action: "register_vehicle",
      label: "Focus",
      hologram: "0",
      plateLastDigit: 5,
    });
  });

  it("parses both contingency notification modes", () => {
    expect(parseIntent("Avísame siempre cuando haya fase 1")).toEqual({
      action: "configure_contingency",
      mode: "always",
    });
    expect(parseIntent("Avísame solo si afecta a mi coche")).toEqual({
      action: "configure_contingency",
      mode: "vehicle",
    });
  });

  it("lists vehicles and opens contingency settings", () => {
    expect(parseIntent("/vehiculos")).toEqual({ action: "list_vehicles" });
    expect(parseIntent("/contingencia")).toEqual({ action: "show_contingency" });
  });
});
