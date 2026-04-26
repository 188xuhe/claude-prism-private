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
  hProperties?: {
    "data-width"?: string;
    "data-height"?: string;
    "data-align"?: string;
  };
}

/**
 * Convert Attrs to hProperties for remark-rehype transfer
 */
function attrsToHProperties(attrs: Attrs): AttrNodeData["hProperties"] {
  const props: AttrNodeData["hProperties"] = {};
  if (attrs.width) props["data-width"] = attrs.width;
  if (attrs.height) props["data-height"] = attrs.height;
  if (attrs.align) props["data-align"] = attrs.align;
  return props;
}

/**
 * Remark plugin to parse `{ width=300 align=center }` attribute blocks.
 *
 * For images: attributes follow the image in a text node
 * For code blocks: attributes are in the meta field (after lang)
 */
export const remarkAttrParser: Plugin<[], Root> = () => {
  const transformer: Transformer<Root> = (tree) => {
    visit(tree, (node, index, parent) => {
      // Handle code blocks with attributes in meta field
      if (node.type === "code" && node.meta) {
        const result = parseCodeMeta(node.meta);
        if (result.attrs) {
          const hProps = attrsToHProperties(result.attrs);
          (node.data as AttrNodeData | undefined) = {
            attrs: result.attrs,
            hProperties: hProps,
          };
          node.meta = result.remaining;
        }
      }

      // Handle images with attributes in following text node
      if (node.type === "image" && parent && typeof index === "number") {
        const nextNode = parent.children[index + 1] as Text | undefined;
        if (nextNode?.type === "text") {
          const result = parseAttrBlock(nextNode.value);
          if (result.attrs) {
            const hProps = attrsToHProperties(result.attrs);
            (node.data as AttrNodeData | undefined) = {
              attrs: result.attrs,
              hProperties: hProps,
            };
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
 * Parse code block meta field: "{ width=500 }"
 * Returns: { attrs: { width: "500" }, remaining: "" }
 */
function parseCodeMeta(metaField: string): {
  attrs?: Attrs;
  remaining: string;
} {
  const match = metaField.match(/^\s*\{([^}]*)\}\s*/);
  if (!match) {
    return { remaining: metaField };
  }
  const attrString = match[1];
  const attrs = parseAttrs(attrString);
  const remaining = metaField.slice(match[0].length);
  // Only return attrs if there are valid attributes
  if (Object.keys(attrs).length === 0) {
    return { remaining: metaField };
  }
  return { attrs, remaining };
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
  // Only return attrs if there are valid attributes
  if (Object.keys(attrs).length === 0) {
    return { remaining: text };
  }
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
