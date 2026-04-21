import { describe, expect, it } from "vitest";
import { parseStyle, safeSvgAttr } from "./drawio-renderer";

describe("parseStyle", () => {
  it("returns an empty object for null / empty input", () => {
    expect(parseStyle(null)).toEqual({});
    expect(parseStyle("")).toEqual({});
  });

  it("parses semicolon-separated key=value pairs", () => {
    expect(parseStyle("fillColor=#fff;strokeColor=#000;")).toEqual({
      fillColor: "#fff",
      strokeColor: "#000",
    });
  });

  it("treats bare tokens as shape identifiers", () => {
    // drawio uses bare tokens for shape types — they get value "1"
    expect(parseStyle("ellipse;fillColor=#eee")).toEqual({
      ellipse: "1",
      fillColor: "#eee",
    });
  });

  it("keeps only the key up to the first =", () => {
    // Values may themselves contain `=` (e.g. font styling)
    expect(parseStyle("shadow=1;html=1;whiteSpace=wrap")).toEqual({
      shadow: "1",
      html: "1",
      whiteSpace: "wrap",
    });
  });

  it("ignores empty segments from leading / trailing / doubled semicolons", () => {
    expect(parseStyle(";;fillColor=#fff;;")).toEqual({ fillColor: "#fff" });
  });
});

describe("safeSvgAttr", () => {
  it("strips quotes, angle brackets, ampersands, semicolons, and parens (non-rgb)", () => {
    // The stripped set is ['"<>&;()] — `=` is intentionally kept because
    // drawio-style attribute values can legitimately contain it. The output
    // is used as an SVG attribute value, so `"` and `<` are the real risks.
    expect(safeSvgAttr(`red" onload="alert(1)`)).toBe("red onload=alert1");
  });

  it("preserves rgb(...) when the entire value is an rgb literal", () => {
    expect(safeSvgAttr("rgb(10, 20, 30)")).toBe("rgb(10, 20, 30)");
    expect(safeSvgAttr("rgba(0,0,0,0.5)")).toBe("rgba(0,0,0,0.5)");
  });

  it("strips parentheses when the value is not a pure rgb literal", () => {
    // "rgb(...) url(evil)" → parentheses all stripped because isRgb is false
    expect(safeSvgAttr("rgb(0,0,0) url(evil)")).toBe("rgb0,0,0 urlevil");
  });

  it("leaves hex colors untouched", () => {
    expect(safeSvgAttr("#ff00aa")).toBe("#ff00aa");
  });
});
