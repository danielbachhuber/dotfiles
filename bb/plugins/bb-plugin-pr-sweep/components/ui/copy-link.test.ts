import { describe, expect, it } from "vitest";
import { escapeHtml, linkHtml, linkMarkdown } from "./copy-link.js";

describe("escapeHtml", () => {
  it("escapes the characters that would break out of the markup", () => {
    expect(escapeHtml(`<a href="x">&`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });

  it("escapes the ampersand first, so an escape is not escaped twice", () => {
    // "&lt;" going in must come out as "&amp;lt;", not "&lt;".
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Add the widget endpoint")).toBe("Add the widget endpoint");
  });
});

describe("linkHtml", () => {
  it("builds an anchor a document or chat window can paste as a link", () => {
    expect(linkHtml("Add the widget endpoint", "https://github.com/acme/widgets/pull/1")).toBe(
      '<a href="https://github.com/acme/widgets/pull/1">Add the widget endpoint</a>',
    );
  });

  it("survives a title with angle brackets", () => {
    // A real one: "Consider switching <RichText> to use <UtilityText>". Unescaped,
    // a paste target swallows everything between the brackets.
    const html = linkHtml("Switch <RichText> to <UtilityText>", "https://example.test/1");
    expect(html).toContain("&lt;RichText&gt;");
    expect(html).not.toMatch(/<RichText>/);
  });

  it("cannot be talked out of its own href by a quote in the title", () => {
    const html = linkHtml('Fix "always on" questions', "https://example.test/1");
    expect(html).toBe('<a href="https://example.test/1">Fix &quot;always on&quot; questions</a>');
  });

  it("escapes the url too, not just the title", () => {
    const html = linkHtml("t", 'https://example.test/1?a=1&b="2"');
    expect(html).toContain("a=1&amp;b=&quot;2&quot;");
  });
});

describe("linkMarkdown", () => {
  it("is the plain-text flavour a comment or editor renders as a link", () => {
    expect(linkMarkdown("Add the widget endpoint", "https://example.test/1")).toBe(
      "[Add the widget endpoint](https://example.test/1)",
    );
  });

  it("leaves the title's own characters intact", () => {
    // Markdown allows balanced brackets in link text, and real titles carry
    // them: "implement the oRPC contract on Postgres/Kysely [RFC]".
    expect(linkMarkdown("Ship it [RFC]", "https://example.test/1")).toBe(
      "[Ship it [RFC]](https://example.test/1)",
    );
  });
});
