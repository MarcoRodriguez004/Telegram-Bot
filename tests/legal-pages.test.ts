import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";

const env = {} as Env;

describe("public legal pages", () => {
  it("serves the privacy policy as a public HTML page", async () => {
    const response = await handleRequest(new Request("https://bot.test/privacy"), env);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body).toContain("Política de privacidad");
    expect(body).toContain("/borrar_datos CONFIRMAR");
  });

  it("serves data deletion instructions as a public HTML page", async () => {
    const response = await handleRequest(new Request("https://bot.test/data-deletion"), env);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Eliminación de datos");
    expect(body).toContain("/borrar_datos CONFIRMAR");
  });
});
