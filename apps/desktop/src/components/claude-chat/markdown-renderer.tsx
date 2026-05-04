import React, {
  type FC,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import mermaid from "mermaid";
import remarkAttrParser, { type Attrs } from "@/lib/remark-attr-parser";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  PlusIcon,
  PlayIcon,
  LoaderIcon,
  CheckIcon,
  XIcon,
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import "katex/dist/katex.min.css";

import { useDocumentStore } from "@/stores/document-store";

// Initialize mermaid once at module load time
// Note: mermaid is split into a separate chunk via vite.config.ts manualChunks
// Tauri 2 embedded assets require static imports - dynamic imports are not supported
mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "loose",
  suppressErrorRendering: true,
});

// ─── Shell Detection ───

const SHELL_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "fish",
  "terminal",
  "console",
]);

function looksLikeShellCommand(code: string): boolean {
  const firstLine = code
    .trim()
    .split("\n")[0]
    .replace(/^[$#]\s*/, "")
    .trim();
  const prefixes = [
    "wget",
    "curl",
    "tlmgr",
    "apt",
    "brew",
    "npm",
    "pip",
    "sudo",
    "mkdir",
    "cd ",
    "cp ",
    "mv ",
    "rm ",
    "git ",
    "make",
    "tar ",
    "unzip",
    "latexmk",
    "pdflatex",
    "xelatex",
    "bibtex",
  ];
  return prefixes.some((p) => firstLine.startsWith(p));
}

function isShellCodeBlock(language: string, code: string): boolean {
  if (SHELL_LANGUAGES.has(language.toLowerCase())) return true;
  if (!language && looksLikeShellCommand(code)) return true;
  return false;
}

// ─── Style Helpers ───

/**
 * Compute CSS styles from parsed attributes
 */
function computeStylesFromAttrs(attrs?: Attrs): {
  containerStyle: React.CSSProperties;
  imgStyle: React.CSSProperties;
} {
  const containerStyle: React.CSSProperties = {};
  const imgStyle: React.CSSProperties = { display: "block" };

  if (!attrs) {
    // Default: full width, centered
    containerStyle.width = "100%";
    containerStyle.margin = "0 auto";
    return { containerStyle, imgStyle };
  }

  // Width
  if (attrs.width) {
    const widthValue = attrs.width.endsWith("%")
      ? attrs.width
      : `${attrs.width}px`;
    containerStyle.width = widthValue;
    imgStyle.width = widthValue;
  }

  // Height (only for images)
  if (attrs.height) {
    imgStyle.height = `${attrs.height}px`;
  }

  // Alignment
  switch (attrs.align) {
    case "left":
      containerStyle.marginLeft = "0";
      containerStyle.marginRight = "auto";
      imgStyle.marginLeft = "0";
      imgStyle.marginRight = "auto";
      break;
    case "right":
      containerStyle.marginLeft = "auto";
      containerStyle.marginRight = "0";
      imgStyle.marginLeft = "auto";
      imgStyle.marginRight = "0";
      break;
    default:
      containerStyle.margin = "0 auto";
      imgStyle.margin = "0 auto";
      break;
  }

  return { containerStyle, imgStyle };
}

// ─── Mermaid Block ───

const MermaidBlock = React.memo(function MermaidBlock({
  code,
  attrs,
}: {
  code: string;
  attrs?: Attrs;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Compute styles from attrs
  const { containerStyle } = computeStylesFromAttrs(attrs);

  // Debounced mermaid rendering — wait 500ms after code stabilizes before
  // rendering. This prevents cascading mermaid.render() calls on every keystroke.
  useEffect(() => {
    if (!containerRef.current) return;

    const timerId = setTimeout(async () => {
      try {
        // Clear previous content
        containerRef.current!.innerHTML = "";

        // Pre-validate syntax without touching render state
        try {
          await mermaid.parse(code);
        } catch (parseErr) {
          const message =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          setError(message);
          return;
        }

        // Generate unique ID for this diagram
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // Render mermaid (statically imported at module load time)
        const { svg } = await mermaid.render(id, code);

        // Insert SVG and constrain its size
        const container = containerRef.current!;
        container.innerHTML = svg;

        // Ensure SVG fits within container
        const svgEl = container.querySelector("svg");
        if (svgEl) {
          if (!svgEl.hasAttribute("viewBox")) {
            const width = svgEl.getAttribute("width");
            const height = svgEl.getAttribute("height");
            if (width && height) {
              svgEl.setAttribute(
                "viewBox",
                `0 0 ${parseFloat(width)} ${parseFloat(height)}`,
              );
            }
          }
          svgEl.removeAttribute("width");
          svgEl.removeAttribute("height");
          svgEl.style.maxWidth = "100%";
          svgEl.style.width = "100%";
          svgEl.style.height = "auto";
          svgEl.style.display = "block";
        }

        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);

        // Reset Mermaid state so subsequent diagrams aren't affected
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "loose",
          suppressErrorRendering: true,
        });

        // Clean up mermaid's injected error elements from DOM
        document
          .querySelectorAll(".mermaid-error")
          .forEach((el) => el.remove());
        document.querySelectorAll(`[id^="mermaid-"]`).forEach((el) => {
          if (!el.closest(".mermaid-block")) {
            el.remove();
          }
        });
      }
    }, 500);

    return () => clearTimeout(timerId);
  }, [code]);

  // Always render container div — error shown as inline badge inside it.
  // This prevents the oscillation loop that occurred with conditional rendering.
  return (
    <div
      ref={containerRef}
      className="mermaid-block my-2 max-w-full overflow-hidden rounded-lg bg-muted/50 p-4"
      style={containerStyle}
    >
      {error && (
        <div className="mb-2 flex items-center gap-1.5 rounded-md bg-red-500/10 px-2 py-1 text-red-400 text-xs">
          <AlertTriangleIcon className="size-3 shrink-0" />
          <span className="font-medium">Mermaid syntax error</span>
          <span className="ml-1 max-w-[200px] truncate text-red-400/60">
            {error.length > 80 ? `${error.slice(0, 80)}...` : error}
          </span>
        </div>
      )}
    </div>
  );
});

/**
 * Extract attrs from hast node properties (set via hProperties from remark-rehype)
 */
function extractAttrsFromNode(node: unknown): {
  width?: string;
  height?: string;
  align?: "left" | "center" | "right";
} {
  // Try hast node properties first (from hProperties)
  const properties = (node as { properties?: Record<string, string> })
    ?.properties;
  if (properties) {
    return {
      width: properties["data-width"],
      height: properties["data-height"],
      align: properties["data-align"] as
        | "left"
        | "center"
        | "right"
        | undefined,
    };
  }
  // Fallback to mdast node data (direct access, for backwards compatibility)
  const attrs = (node as { data?: { attrs?: Attrs } })?.data?.attrs;
  return attrs ?? {};
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  projectRoot?: string | null;
}

// Plugin arrays are static — hoist to module scope so ReactMarkdown skips re-processing
const REMARK_PLUGINS = [remarkAttrParser, remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

export const MarkdownRenderer: FC<MarkdownRendererProps> = ({
  content,
  className,
  projectRoot,
}) => {
  // Throttle rendered content during streaming — ReactMarkdown is expensive
  // to re-run on every token. Update at ~150ms intervals, snap to final value.
  const [renderedContent, setRenderedContent] = useState(content);
  const rafRef = useRef<number>(0);
  const lastRenderRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastRenderRef.current;
    if (elapsed >= 150) {
      lastRenderRef.current = now;
      setRenderedContent(content);
    } else {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        lastRenderRef.current = Date.now();
        setRenderedContent(content);
      });
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [content]);

  // Stabilize components object — only recreate when projectRoot changes
  // (img handler closes over projectRoot; everything else is pure)
  const components = useMemo(
    () => ({
      img({ src, alt, node }: { src?: string; alt?: string; node?: unknown }) {
        const attrs = extractAttrsFromNode(node);
        const { imgStyle } = computeStylesFromAttrs(attrs);

        if (
          !src ||
          src.startsWith("http://") ||
          src.startsWith("https://") ||
          src.startsWith("data:")
        ) {
          return <img src={src} alt={alt} style={imgStyle} />;
        }

        if (!projectRoot) {
          return (
            <span className="inline-block rounded bg-muted px-2 py-1 text-muted-foreground text-sm">
              [Image loading...]
            </span>
          );
        }

        const normalizedSrc = src.replace(/\\/g, "/");
        const absolutePath = normalizedSrc.startsWith("/")
          ? normalizedSrc
          : `${projectRoot}/${normalizedSrc}`;
        const assetUrl = convertFileSrc(absolutePath);
        return <img src={assetUrl} alt={alt} style={imgStyle} />;
      },
      pre({ children }: { children?: React.ReactNode }) {
        return <>{children}</>;
      },
      code({
        className: codeClassName,
        children,
        node,
        ...props
      }: {
        className?: string;
        children?: React.ReactNode;
        node?: unknown;
      }) {
        const match = /language-(\w+)/.exec(codeClassName || "");
        const language = match?.[1];
        const code = String(children).replace(/\n$/, "");
        const nodePos = (
          node as {
            position?: { start: { line: number }; end: { line: number } };
          }
        )?.position;
        const isBlock = nodePos && nodePos.start.line !== nodePos.end.line;

        const attrs = extractAttrsFromNode(node);

        if (!match && !isBlock) {
          return (
            <code className={codeClassName} {...props}>
              {children}
            </code>
          );
        }

        if (language === "mermaid") {
          const sourceLine = nodePos?.start?.line ?? 0;
          return (
            <MermaidBlock
              key={`mermaid-${sourceLine}`}
              code={code}
              attrs={attrs}
            />
          );
        }

        return <CodeBlock language={language || ""} code={code} />;
      },
      p({ node, children }: { node?: unknown; children?: React.ReactNode }) {
        const line = (node as { position?: { start: { line: number } } })
          ?.position?.start?.line;
        return <p data-source-line={line}>{children}</p>;
      },
      h1({ node, children }: { node?: unknown; children?: React.ReactNode }) {
        const line = (node as { position?: { start: { line: number } } })
          ?.position?.start?.line;
        return <h1 data-source-line={line}>{children}</h1>;
      },
      h2({ node, children }: { node?: unknown; children?: React.ReactNode }) {
        const line = (node as { position?: { start: { line: number } } })
          ?.position?.start?.line;
        return <h2 data-source-line={line}>{children}</h2>;
      },
      h3({ node, children }: { node?: unknown; children?: React.ReactNode }) {
        const line = (node as { position?: { start: { line: number } } })
          ?.position?.start?.line;
        return <h3 data-source-line={line}>{children}</h3>;
      },
      h4({ node, children }: { node?: unknown; children?: React.ReactNode }) {
        const line = (node as { position?: { start: { line: number } } })
          ?.position?.start?.line;
        return <h4 data-source-line={line}>{children}</h4>;
      },
      h5({ node, children }: { node?: unknown; children?: React.ReactNode }) {
        const line = (node as { position?: { start: { line: number } } })
          ?.position?.start?.line;
        return <h5 data-source-line={line}>{children}</h5>;
      },
      h6({ node, children }: { node?: unknown; children?: React.ReactNode }) {
        const line = (node as { position?: { start: { line: number } } })
          ?.position?.start?.line;
        return <h6 data-source-line={line}>{children}</h6>;
      },
      li({ node, children }: { node?: unknown; children?: React.ReactNode }) {
        const line = (node as { position?: { start: { line: number } } })
          ?.position?.start?.line;
        return <li data-source-line={line}>{children}</li>;
      },
      blockquote({
        node,
        children,
      }: {
        node?: unknown;
        children?: React.ReactNode;
      }) {
        const line = (node as { position?: { start: { line: number } } })
          ?.position?.start?.line;
        return <blockquote data-source-line={line}>{children}</blockquote>;
      },
    }),
    [projectRoot],
  );

  return (
    <ReactMarkdown
      key={projectRoot ? `with-root-${projectRoot}` : "no-root"}
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      className={className ?? "prose prose-sm dark:prose-invert max-w-none"}
      components={components}
    >
      {renderedContent}
    </ReactMarkdown>
  );
};

// ─── Code Block ───

type RunState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "running" }
  | { status: "done"; exitCode: number; stdout: string; stderr: string }
  | { status: "error"; message: string };

const CodeBlock = React.memo(function CodeBlock({
  language,
  code,
}: {
  language: string;
  code: string;
}) {
  const insertAtCursor = useDocumentStore((s) => s.insertAtCursor);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const isLatex = language === "latex" || language === "tex";
  const isShell = isShellCodeBlock(language, code);

  const [runState, setRunState] = useState<RunState>({ status: "idle" });

  const handleInsert = useCallback(() => {
    insertAtCursor(code);
  }, [insertAtCursor, code]);

  // Strip leading $ or # prompts for execution
  const cleanedCommand = code
    .split("\n")
    .map((line) => line.replace(/^\$\s*/, ""))
    .join("\n")
    .trim();

  const handleRun = useCallback(() => {
    setRunState({ status: "confirming" });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!projectRoot) {
      setRunState({ status: "error", message: "No project open" });
      return;
    }
    setRunState({ status: "running" });
    try {
      const result = await invoke<{
        exit_code: number;
        stdout: string;
        stderr: string;
      }>("run_shell_command", { command: cleanedCommand, cwd: projectRoot });
      setRunState({
        status: "done",
        exitCode: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      // Refresh file tree to pick up any new/deleted files
      useDocumentStore
        .getState()
        .refreshFiles()
        .catch((err) => {
          console.error("Failed to refresh files:", err);
        });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setRunState({ status: "error", message });
    }
  }, [cleanedCommand, projectRoot]);

  const handleCancel = useCallback(() => {
    setRunState({ status: "idle" });
  }, []);

  return (
    <div className="not-prose group relative my-2">
      <pre className="overflow-x-auto rounded bg-muted p-3 text-sm">
        <code>{code}</code>
      </pre>

      {/* Hover-reveal buttons */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {isLatex && (
          <button
            type="button"
            onClick={handleInsert}
            className="flex items-center gap-0.5 rounded bg-primary px-1.5 py-0.5 text-primary-foreground text-xs"
          >
            <PlusIcon className="size-3" />
            Insert
          </button>
        )}
        {isShell && runState.status === "idle" && (
          <button
            type="button"
            onClick={handleRun}
            className="flex items-center gap-0.5 rounded bg-green-600 px-1.5 py-0.5 text-white text-xs"
          >
            <PlayIcon className="size-3" />
            Run
          </button>
        )}
      </div>

      {/* Inline confirmation */}
      {runState.status === "confirming" && (
        <div className="mt-1 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
            <AlertTriangleIcon className="size-3.5 text-yellow-500" />
            <span className="text-xs">
              Run in{" "}
              <code className="rounded bg-muted px-1 text-xs">
                {projectRoot?.split(/[/\\]/).pop()}/
              </code>
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              className="flex items-center gap-1 rounded bg-green-600 px-2.5 py-1 text-white text-xs"
            >
              <PlayIcon className="size-3" />
              Run
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded bg-muted px-2.5 py-1 text-muted-foreground text-xs hover:bg-muted/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Running spinner */}
      {runState.status === "running" && (
        <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-[#1e1e2e] px-3 py-2 text-sm">
          <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
          <span className="font-mono text-muted-foreground text-xs">
            Running...
          </span>
        </div>
      )}

      {/* Command output */}
      {runState.status === "done" && (
        <CommandOutput
          exitCode={runState.exitCode}
          stdout={runState.stdout}
          stderr={runState.stderr}
        />
      )}

      {/* Error */}
      {runState.status === "error" && (
        <div className="mt-1 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-xs">
          <XIcon className="size-3.5" />
          {runState.message}
        </div>
      )}
    </div>
  );
});

// ─── Command Output ───

const CommandOutput: FC<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> = ({ exitCode, stdout, stderr }) => {
  const [expanded, setExpanded] = useState(true);
  const success = exitCode === 0;
  const output = (stdout + (stderr ? `\n${stderr}` : "")).trim();
  const truncated =
    output.length > 2000 ? `${output.slice(0, 2000)}\n...` : output;

  return (
    <div className="mt-1 rounded-lg border border-border bg-[#1e1e2e] text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2"
        onClick={() => setExpanded(!expanded)}
      >
        {success ? (
          <CheckIcon className="size-3.5 text-green-500" />
        ) : (
          <XIcon className="size-3.5 text-red-400" />
        )}
        <span
          className={`font-mono text-xs ${success ? "text-green-300" : "text-red-300"}`}
        >
          {success ? "Command completed" : `Exited with code ${exitCode}`}
        </span>
        <span className="ml-auto">
          {expanded ? (
            <ChevronDownIcon className="size-3.5 text-gray-500" />
          ) : (
            <ChevronRightIcon className="size-3.5 text-gray-500" />
          )}
        </span>
      </button>
      {expanded && truncated && (
        <div className="max-h-40 overflow-auto border-border/50 border-t px-3 py-2">
          <pre className="whitespace-pre-wrap font-mono text-gray-300 text-xs">
            {truncated}
          </pre>
        </div>
      )}
    </div>
  );
};
