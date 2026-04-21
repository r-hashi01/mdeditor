import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  renderMarp,
  safeBgImage,
  safeClassName,
  safeCssValue,
  splitSlides,
} from "./marp-renderer";

describe("parseFrontmatter", () => {
  it("returns empty directives when no frontmatter is present", () => {
    const { directives, body } = parseFrontmatter("# just a heading\n");
    expect(directives).toEqual({});
    expect(body).toBe("# just a heading\n");
  });

  it("parses simple key:value directives", () => {
    const { directives, body } = parseFrontmatter(
      "---\ntheme: gaia\npaginate: true\n---\n# slide",
    );
    expect(directives).toEqual({ theme: "gaia", paginate: "true" });
    expect(body).toBe("# slide");
  });

  it("collects indented continuation lines after `key: |`", () => {
    const input = ["---", "style: |", "  section { color: red }", "  h1 { font-size: 2em }", "---", "# s"].join("\n");
    const { directives } = parseFrontmatter(input);
    expect(directives.style).toContain("section { color: red }");
    expect(directives.style).toContain("h1 { font-size: 2em }");
  });

  it("requires frontmatter to begin at the very start of the document", () => {
    const { directives, body } = parseFrontmatter("\n---\ntheme: gaia\n---\n# s");
    // Leading blank line → not frontmatter, pass through untouched.
    expect(directives).toEqual({});
    expect(body.startsWith("\n---")).toBe(true);
  });
});

describe("splitSlides", () => {
  it("splits on `---` on its own line", () => {
    const slides = splitSlides("slide 1\n\n---\n\nslide 2\n\n---\n\nslide 3");
    expect(slides).toHaveLength(3);
    expect(slides[0].content).toBe("slide 1");
    expect(slides[2].content).toBe("slide 3");
  });

  it("extracts HTML-comment directives per slide", () => {
    const slides = splitSlides("<!-- _backgroundColor: #fff -->\ntext");
    expect(slides[0].directives).toEqual({ _backgroundColor: "#fff" });
    expect(slides[0].content).toBe("text");
  });

  it("does not split on `---` that is inline with text", () => {
    const slides = splitSlides("hello --- world");
    expect(slides).toHaveLength(1);
  });
});

describe("safeCssValue", () => {
  it("strips characters that would escape a quoted style attribute", () => {
    // `/` is intentionally preserved (needed for legitimate values like url paths);
    // the dangerous set is ;"'<>{}\
    expect(safeCssValue(`red;}</style><script>`)).toBe("red/stylescript");
  });

  it("leaves plain color names and hex untouched", () => {
    expect(safeCssValue("#ff00aa")).toBe("#ff00aa");
    expect(safeCssValue("rebeccapurple")).toBe("rebeccapurple");
  });
});

describe("safeBgImage", () => {
  it("allows https://… url()", () => {
    expect(safeBgImage("url(https://example.com/x.png)")).toBe(
      "url(https://example.com/x.png)",
    );
  });

  it("allows data:image/… url()", () => {
    expect(safeBgImage("url(data:image/png;base64,AAAA)")).toBe(
      // `;` is stripped by safeCssValue, but the scheme check runs on the
      // already-stripped string — documents the actual behavior.
      "url(data:image/pngbase64,AAAA)",
    );
  });

  it("rejects javascript:, file: and other schemes", () => {
    expect(safeBgImage("url(javascript:alert(1))")).toBe("");
    expect(safeBgImage("url(file:///etc/passwd)")).toBe("");
  });

  it("rejects when any url() inside the value is unsafe", () => {
    const v = "url(https://ok.example) url(javascript:evil)";
    expect(safeBgImage(v)).toBe("");
  });
});

describe("safeClassName", () => {
  it("keeps ascii letters, digits, hyphen, underscore, and space", () => {
    expect(safeClassName("lead center slide-1_v2")).toBe("lead center slide-1_v2");
  });

  it("strips quotes, angle brackets, and dots", () => {
    expect(safeClassName(`bad" onerror="x`)).toBe("bad onerrorx");
    expect(safeClassName("<script>")).toBe("script");
    expect(safeClassName("a.b.c")).toBe("abc");
  });
});

describe("renderMarp (integration)", () => {
  it("produces one <section> per slide with marp-slide class", () => {
    const { html, slideCount } = renderMarp("# One\n\n---\n\n# Two");
    expect(slideCount).toBe(2);
    expect(html.match(/<section /g)?.length).toBe(2);
    expect(html).toContain(`class="marp-slide"`);
  });

  it("applies a selected theme", () => {
    const { css } = renderMarp("---\ntheme: gaia\n---\n# s");
    expect(css).toContain(".marp-slide");
    // gaia theme uses a blue background
    expect(css).toContain("#0288d1");
  });

  it("blocks </style> escape attempts inside frontmatter style", () => {
    const input = ["---", "style: |", "  </style><script>alert(1)</script>", "---", "# s"].join("\n");
    const { css } = renderMarp(input);
    expect(css.toLowerCase()).not.toContain("</style>");
    expect(css).toContain("/* blocked */");
  });

  it("neutralizes @import inside user style", () => {
    const input = ["---", "style: |", "  @import url(https://evil.example/x.css);", "---", "# s"].join("\n");
    const { css } = renderMarp(input);
    expect(css).toContain("/* @import blocked */");
    expect(css).not.toMatch(/@import\s+url\(https/i);
  });

  it("inlines frontmatter directives as sanitized style attributes on a slide", () => {
    const input = [
      "---",
      "backgroundColor: '#fff;}</style><img src=x>'",
      "---",
      "# s",
    ].join("\n");
    const { html } = renderMarp(input);
    // dangerous characters were stripped before the value was interpolated
    expect(html).not.toMatch(/<\/style>/i);
    expect(html).not.toMatch(/<img /i);
  });
});
