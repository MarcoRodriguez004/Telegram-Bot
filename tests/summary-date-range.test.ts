import { describe, expect, it } from "vitest";
import { getSummaryDateRange } from "../src/shared/dates";

const now = new Date("2026-09-07T19:30:00.000Z");

describe("summary date ranges", () => {
  it("returns UTC boundaries for a local day", () => {
    expect(getSummaryDateRange("today", now, "America/Mexico_City")).toEqual({
      startAt: "2026-09-07T06:00:00.000Z",
      endAt: "2026-09-08T06:00:00.000Z",
    });
  });

  it("starts the week on Monday", () => {
    expect(getSummaryDateRange("week", now, "America/Mexico_City")).toEqual({
      startAt: "2026-09-07T06:00:00.000Z",
      endAt: "2026-09-14T06:00:00.000Z",
    });
  });

  it("returns the whole local month", () => {
    expect(getSummaryDateRange("month", now, "America/Mexico_City")).toEqual({
      startAt: "2026-09-01T06:00:00.000Z",
      endAt: "2026-10-01T06:00:00.000Z",
    });
  });
});
