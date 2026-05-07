import { describe, it, expect } from "vitest";
import { todayISO } from "./daily-note";

describe("todayISO", () => {
  it("formats a known date as yyyy-mm-dd in local time", () => {
    expect(todayISO(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(todayISO(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("zero-pads single-digit month and day", () => {
    expect(todayISO(new Date(2024, 2, 7))).toBe("2024-03-07");
  });
});
