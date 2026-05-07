import { describe, it, expect } from "vitest";
import { substitute } from "./templates";

describe("substitute", () => {
  const fixedDate = new Date(2026, 4, 7, 14, 5);

  it("replaces {{date}} {{time}} {{datetime}} {{title}}", () => {
    const r = substitute("{{date}} | {{time}} | {{datetime}} | {{title}}", { title: "post" }, fixedDate);
    expect(r.body).toBe("2026-05-07 | 14:05 | 2026-05-07 14:05 | post");
  });

  it("falls back to 'Untitled' when no title supplied", () => {
    const r = substitute("{{title}}", {}, fixedDate);
    expect(r.body).toBe("Untitled");
  });

  it("removes {{cursor}} and reports its offset", () => {
    const r = substitute("# {{title}}\n\n{{cursor}}body", { title: "x" }, fixedDate);
    expect(r.body).toBe("# x\n\nbody");
    expect(r.body.slice(r.cursorOffset)).toBe("body");
  });

  it("leaves cursorOffset at body.length when no marker", () => {
    const r = substitute("plain", {}, fixedDate);
    expect(r.cursorOffset).toBe("plain".length);
  });

  it("replaces all occurrences of repeated variables", () => {
    const r = substitute("{{date}} and {{date}}", {}, fixedDate);
    expect(r.body).toBe("2026-05-07 and 2026-05-07");
  });
});
