import { describe, it, expect } from "vitest";
import remarkAttrParser, { type Attrs } from "@/lib/remark-attr-parser";
import { remark } from "remark";

describe("remark-attr-parser", () => {
  describe("parseAttrs", () => {
    it("parses width as pixels", () => {
      const markdown = "![img](test.jpg){ width=300 }";
      const result = processMarkdown(markdown);
      expect(result.imageAttrs?.width).toBe("300");
    });

    it("parses width as percentage", () => {
      const markdown = "![img](test.jpg){ width=50% }";
      const result = processMarkdown(markdown);
      expect(result.imageAttrs?.width).toBe("50%");
    });

    it("parses height", () => {
      const markdown = "![img](test.jpg){ height=200 }";
      const result = processMarkdown(markdown);
      expect(result.imageAttrs?.height).toBe("200");
    });

    it("parses align", () => {
      const markdown = "![img](test.jpg){ align=left }";
      const result = processMarkdown(markdown);
      expect(result.imageAttrs?.align).toBe("left");
    });

    it("parses multiple attributes", () => {
      const markdown = "![img](test.jpg){ width=300 height=200 align=center }";
      const result = processMarkdown(markdown);
      expect(result.imageAttrs).toEqual({
        width: "300",
        height: "200",
        align: "center",
      });
    });

    it("ignores invalid attribute values", () => {
      const markdown = "![img](test.jpg){ width=abc align=invalid }";
      const result = processMarkdown(markdown);
      expect(result.imageAttrs).toBeUndefined();
    });

    it("handles attributes in any order", () => {
      const markdown = "![img](test.jpg){ align=right width=400 }";
      const result = processMarkdown(markdown);
      expect(result.imageAttrs?.align).toBe("right");
      expect(result.imageAttrs?.width).toBe("400");
    });
  });

  describe("code block parsing", () => {
    it("parses attributes from mermaid code block", () => {
      const markdown = "```mermaid { width=500 }\ngraph LR\n  A --> B\n```";
      const result = processMarkdown(markdown);
      expect(result.codeAttrs?.width).toBe("500");
      expect(result.codeLang).toBe("mermaid");
    });

    it("parses align from code block", () => {
      const markdown =
        "```mermaid { width=600 align=left }\ngraph LR\n  A --> B\n```";
      const result = processMarkdown(markdown);
      expect(result.codeAttrs).toEqual({
        width: "600",
        align: "left",
      });
    });

    it("handles code block without attributes", () => {
      const markdown = "```mermaid\ngraph LR\n  A --> B\n```";
      const result = processMarkdown(markdown);
      expect(result.codeAttrs).toBeUndefined();
      expect(result.codeLang).toBe("mermaid");
    });
  });

  describe("edge cases", () => {
    it("handles image without attribute block", () => {
      const markdown = "![img](test.jpg)";
      const result = processMarkdown(markdown);
      expect(result.imageAttrs).toBeUndefined();
    });

    it("removes attribute block from text after image", () => {
      const markdown = "![img](test.jpg){ width=300 }";
      const result = processMarkdown(markdown);
      expect(result.remainingText).toBe("");
    });

    it("preserves text after attribute block", () => {
      const markdown = "![img](test.jpg){ width=300 } more text";
      const result = processMarkdown(markdown);
      expect(result.remainingText).toBe("more text");
    });

    it("does not parse malformed attribute block", () => {
      const markdown = "![img](test.jpg){ width }";
      const result = processMarkdown(markdown);
      expect(result.imageAttrs).toBeUndefined();
    });
  });
});

// Helper to process markdown and extract attrs
function processMarkdown(markdown: string) {
  const processor = remark().use(remarkAttrParser);
  const tree = processor.parse(markdown);
  // Use runSync to apply transformations
  const transformedTree = processor.runSync(tree);

  let imageAttrs: Attrs | undefined;
  let codeAttrs: Attrs | undefined;
  let codeLang: string | undefined;
  let remainingText = "";

  for (const node of transformedTree.children) {
    if (node.type === "paragraph") {
      for (const child of node.children) {
        if (child.type === "image") {
          imageAttrs = (child.data as { attrs?: Attrs })?.attrs;
        }
        if (child.type === "text") {
          remainingText = child.value;
        }
      }
    }
    if (node.type === "code") {
      codeAttrs = (node.data as { attrs?: Attrs })?.attrs;
      codeLang = node.lang ?? undefined;
    }
  }

  return { imageAttrs, codeAttrs, codeLang, remainingText };
}
