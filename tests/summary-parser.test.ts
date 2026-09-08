import { describe, expect, it } from "vitest";
import { parseIntent } from "../src/router/parser";

describe("summary parser", () => {
  it("defaults /resumen to today", () => {
    expect(parseIntent("/resumen")).toEqual({ action: "summary", range: "today" });
  });

  it("accepts week and month ranges", () => {
    expect(parseIntent("resumen semana")).toEqual({ action: "summary", range: "week" });
    expect(parseIntent("/resumen mes")).toEqual({ action: "summary", range: "month" });
  });

  it("rejects unsupported summary ranges", () => {
    expect(parseIntent("/resumen año")).toEqual({ action: "unknown", reason: "invalid_summary_range" });
  });
});
