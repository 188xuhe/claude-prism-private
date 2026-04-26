import { visit } from "unist-util-visit";
import type { Plugin, Transformer } from "unified";
import type { Root, Image, Code, Text } from "mdast";

export interface Attrs {
  width?: string; // "300" or "50%"
  height?: string; // "200"
  align?: "left" | "center" | "right";
}

export interface AttrNodeData {
  attrs?: Attrs;
}

/**
 * Remark plugin to parse `{ width=300 align=center }` attribute blocks.
 *
 * For images: attributes follow the image in a text node
 * For code blocks: attributes are in the lang field after language name
 */
export const remarkAttrParser: Plugin<[], Root> = () => {
  const transformer: Transformer<Root> = (tree) => {
    visit(tree, (node, index, parent) => {
      // Handle code blocks with attributes in lang field
      if (node.type === "code" && node.lang) {
        const result = parseCodeLang(node.lang);
        if (result.attrs) {
          (node.data as AttrNodeData | undefined) = { attrs: result.attrs };
          node.lang = result.lang;
        }
      }

      // Handle images with attributes in following text node
      if (node.type === "image" && parent && typeof index === "number") {
        const nextNode = parent.children[index + 1] as Text | undefined;
        if (nextNode?.type === "text") {
          const result = parseAttrBlock(nextNode.value);
          if (result.attrs) {
            (node.data as AttrNodeData | undefined) = { attrs: result.attrs };
            // Remove the attribute block text
            if (result.remaining === "") {
              parent.children.splice(index + 1, 1);
            } else {
              nextNode.value = result.remaining;
            }
          }
        }
      }
    });
    return tree;
  };
  return transformer;
};

/**
 * Parse code block lang field: "mermaid { width=500 }"
 * Returns: { lang: "mermaid", attrs: { width: "500" } }
 */
function parseCodeLang(langField: string): { lang: string; attrs?: Attrs } {
  const match = langField.match(/^(\w+)\s*\{([^}]*)\}$/);
  if (!match) {
    return { lang: langField };
  }
  const lang = match[1];
  const attrString = match[2];
  const attrs = parseAttrs(attrString);
  return { lang, attrs };
}

/**
 * Parse attribute block text: "{ width=300 align=center }"
 * Returns: { attrs: { ... }, remaining: "..." }
 */
function parseAttrBlock(text: string): { attrs?: Attrs; remaining: string } {
  const match = text.match(/^\s*\{([^}]*)\}\s*/);
  if (!match) {
    return { remaining: text };
  }
  const attrString = match[1];
  const attrs = parseAttrs(attrString);
  const remaining = text.slice(match[0].length);
  return { attrs, remaining };
}

/**
 * Parse individual attributes: "width=300 align=center"
 */
function parseAttrs(attrString: string): Attrs {
  const attrs: Attrs = {};
  const parts = attrString.trim().split(/\s+/);

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (!key || !value) continue;

    if (key === "width") {
      // Allow "300" or "50%"
      if (/^\d+$/.test(value) || /^\d+%$/.test(value)) {
        attrs.width = value;
      }
    } else if (key === "height") {
      if (/^\d+$/.test(value)) {
        attrs.height = value;
      }
    } else if (key === "align") {
      if (value === "left" || value === "center" || value === "right") {
        attrs.align = value;
      }
    }
  }

  return attrs;
}

export default remarkAttrParser;