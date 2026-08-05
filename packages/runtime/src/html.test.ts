import { describe, expect, it } from "vitest";

import { htmlMarkupToText, removeHtmlElementContents } from "./html";

describe("removeHtmlElementContents", () => {
  it("removes blocked element contents case-insensitively", () => {
    expect(
      removeHtmlElementContents(
        '<p>Keep</p><SCRIPT type="text/javascript">drop()</script ><p>After</p>',
        ["script"],
      ),
    ).toBe("<p>Keep</p> <p>After</p>");
  });

  it("does not confuse tag-name prefixes with blocked elements", () => {
    expect(
      removeHtmlElementContents(
        "<scripture>keep</scripture><script>drop()</script>",
        ["script"],
      ),
    ).toBe("<scripture>keep</scripture> ");
  });

  it("drops the remainder after an unterminated blocked element", () => {
    expect(
      removeHtmlElementContents("<p>Keep</p><style>untrusted", ["style"]),
    ).toBe("<p>Keep</p> ");
  });
});

describe("htmlMarkupToText", () => {
  it("converts block and list markup without changing ordinary angle brackets", () => {
    expect(
      htmlMarkupToText("<p>One<br>Two</p><ul><li>Three</li></ul> 1 < 2", {
        blockTags: ["p", "li"],
        listItemTags: ["li"],
      }),
    ).toBe(" One\nTwo\n - Three\n  1 < 2");
  });

  it("keeps unterminated markup as text", () => {
    expect(htmlMarkupToText("before <tag after")).toBe("before <tag after");
  });
});
