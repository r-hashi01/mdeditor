import { describe, it, expect } from "vitest";
import { parseFrontmatter, serializeFrontmatter, replaceFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns null when the document has no frontmatter", () => {
    expect(parseFrontmatter("# Heading\nbody")).toBeNull();
  });

  it("returns null when the closing delimiter is missing", () => {
    expect(parseFrontmatter("---\ntitle: x\nbody")).toBeNull();
  });

  it("parses scalar fields", () => {
    const r = parseFrontmatter("---\ntitle: Hello\ndraft: true\n---\nbody")!;
    expect(r.fields.map((f) => [f.key, f.value])).toEqual([
      ["title", "Hello"],
      ["draft", "true"],
    ]);
  });

  it("parses inline flow sequences", () => {
    const r = parseFrontmatter("---\ntags: [a, b, c]\n---\n")!;
    expect(r.fields[0]).toEqual({ key: "tags", value: ["a", "b", "c"], raw: false });
  });

  it("parses block sequences", () => {
    const r = parseFrontmatter("---\ntags:\n  - alpha\n  - beta\n---\n")!;
    expect(r.fields[0].value).toEqual(["alpha", "beta"]);
  });

  it("strips surrounding quotes from string values", () => {
    const r = parseFrontmatter("---\ntitle: \"Quoted\"\nslug: 'kebab-case'\n---\n")!;
    expect(r.fields.map((f) => f.value)).toEqual(["Quoted", "kebab-case"]);
  });

  it("preserves unrecognised lines as raw", () => {
    const r = parseFrontmatter("---\nfoo: bar\n  weird-indent: nope\n---\n")!;
    const raw = r.fields.find((f) => f.raw);
    expect(raw).toBeDefined();
    expect(raw?.value).toBe("  weird-indent: nope");
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips simple scalars", () => {
    const yaml = "title: Hello\ndraft: true";
    const fields = parseFrontmatter(`---\n${yaml}\n---\n`)!.fields;
    expect(serializeFrontmatter(fields)).toBe(yaml);
  });

  it("quotes ambiguous values that would otherwise parse as different types", () => {
    expect(serializeFrontmatter([{ key: "n", value: "42", raw: false }])).toBe('n: "42"');
    expect(serializeFrontmatter([{ key: "b", value: "true", raw: false }])).toBe('b: "true"');
  });

  it("emits inline flow sequences for arrays", () => {
    const out = serializeFrontmatter([{ key: "tags", value: ["a", "b"], raw: false }]);
    expect(out).toBe("tags: [a, b]");
  });

  it("preserves raw lines verbatim", () => {
    const out = serializeFrontmatter([{ key: "__raw_0", value: "  weird-indent: nope", raw: true }]);
    expect(out).toBe("  weird-indent: nope");
  });
});

describe("replaceFrontmatter", () => {
  it("replaces an existing block", () => {
    const src = "---\ntitle: old\n---\nbody";
    expect(replaceFrontmatter(src, "title: new")).toBe("---\ntitle: new\n---\nbody");
  });

  it("prepends a block when none exists", () => {
    const src = "# H\nbody";
    expect(replaceFrontmatter(src, "title: x")).toBe("---\ntitle: x\n---\n# H\nbody");
  });
});
