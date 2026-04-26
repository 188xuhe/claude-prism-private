import { type FC, useCallback, useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import mermaid from "mermaid";
import remarkAttrParser, { type Attrs } from "@/lib/remark-attr-parser";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
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

// Initialize mermaid with error suppression
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
    case "center":
    default:
      containerStyle.margin = "0 auto";
      imgStyle.margin = "0 auto";
      break;
  }

  return { containerStyle, imgStyle };
}

// ─── Mermaid Block ───

const MermaidBlock: FC<{ code: string; attrs?: Attrs }> = ({ code, attrs }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Compute styles from attrs
  const { containerStyle } = computeStylesFromAttrs(attrs);

  useEffect(() => {
    if (!containerRef.current) return;

    const render = async () => {
      try {
        // Clear previous content
        containerRef.current!.innerHTML = "";

        // Clean up any mermaid error elements from previous failed renders
        document
          .querySelectorAll(".mermaid-error")
          .forEach((el) => el.remove());

        // Generate unique ID for this diagram
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // Render mermaid
        const { svg } = await mermaid.render(id, code);

        // Insert SVG and constrain its size
        const container = containerRef.current!;
        container.innerHTML = svg;

        // Ensure SVG fits within container
        const svgEl = container.querySelector("svg");
        if (svgEl) {
          // Critical: set viewBox if not present to enable proper scaling
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
          // Force constrained sizing
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
        containerRef.current!.innerHTML = "";

        // Clean up mermaid's injected error elements from DOM
        document
          .querySelectorAll(".mermaid-error")
          .forEach((el) => el.remove());
        // Also remove any elements with the generated id that mermaid may have created
        document.querySelectorAll(`[id^="mermaid-"]`).forEach((el) => {
          if (!el.closest(".mermaid-block")) {
            el.remove();
          }
        });
      }
    };

    render();
  }, [code]);

  if (error) {
    // Truncate error message to prevent overflow
    const truncatedError =
      error.length > 200 ? `${error.slice(0, 200)}...` : error;
    return (
      <div className="mermaid-block my-2 max-w-full overflow-hidden rounded-lg border border-destructive/30 bg-destructive/10 p-3">
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span className="font-medium">Mermaid syntax error</span>
        </div>
        <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-destructive/80 text-xs">
          {truncatedError}
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-block my-2 max-w-full overflow-hidden rounded-lg bg-muted/50 p-4"
      style={containerStyle}
    />
  );
};

// ─── Markdown Renderer ───

interface MarkdownRendererProps {
  content: string;
  className?: string;
  projectRoot?: string | null;
}

export const MarkdownRenderer: FC<MarkdownRendererProps> = ({
  content,
  className,
  projectRoot,
}) => {
  return (
    <ReactMarkdown
      key={projectRoot ? `with-root-${projectRoot}` : "no-root"}
      remarkPlugins={[remarkAttrParser, remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      className={className ?? "prose prose-sm dark:prose-invert max-w-none"}
      components={{
        // Handle relative image paths - convert to Tauri asset URLs
        img({ src, alt }) {
          console.log("[MarkdownRenderer] img handler called", {
            src,
            projectRoot,
            hasProjectRoot: !!projectRoot,
          });

          // Skip external URLs and data URLs
          if (
            !src ||
            src.startsWith("http://") ||
            src.startsWith("https://") ||
            src.startsWith("data:")
          ) {
            return <img src={src} alt={alt} />;
          }

          // For relative paths, we need projectRoot to convert to Tauri asset URL
          // If projectRoot is not available yet, show a placeholder
          if (!projectRoot) {
            console.log(
              "[MarkdownRenderer] projectRoot is null, showing placeholder",
            );
            return (
              <span className="inline-block rounded bg-muted px-2 py-1 text-muted-foreground text-sm">
                [Image loading...]
              </span>
            );
          }

          // Convert relative path to Tauri asset URL
          const normalizedSrc = src.replace(/\\/g, "/");
          const absolutePath = normalizedSrc.startsWith("/")
            ? normalizedSrc
            : `${projectRoot}/${normalizedSrc}`;
          const assetUrl = convertFileSrc(absolutePath);
          console.log("[MarkdownRenderer] converted to assetUrl", {
            absolutePath,
            assetUrl,
          });
          return <img src={assetUrl} alt={alt} />;
        },
        pre({ children }) {
          return <>{children}</>;
        },
        code({ className: codeClassName, children, node, ...props }) {
          const match = /language-(\w+)/.exec(codeClassName || "");
          const language = match?.[1];
          const code = String(children).replace(/\n$/, "");
          const isBlock =
            node?.position &&
            node.position.start.line !== node.position.end.line;

          if (!match && !isBlock) {
            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          }

          // Handle mermaid diagrams
          if (language === "mermaid") {
            return <MermaidBlock code={code} />;
          }

          return <CodeBlock language={language || ""} code={code} />;
        },
        // Add data-source-line for scroll sync
        p({ node, children }) {
          const line = node?.position?.start?.line;
          return <p data-source-line={line}>{children}</p>;
        },
        h1({ node, children }) {
          const line = node?.position?.start?.line;
          return <h1 data-source-line={line}>{children}</h1>;
        },
        h2({ node, children }) {
          const line = node?.position?.start?.line;
          return <h2 data-source-line={line}>{children}</h2>;
        },
        h3({ node, children }) {
          const line = node?.position?.start?.line;
          return <h3 data-source-line={line}>{children}</h3>;
        },
        h4({ node, children }) {
          const line = node?.position?.start?.line;
          return <h4 data-source-line={line}>{children}</h4>;
        },
        h5({ node, children }) {
          const line = node?.position?.start?.line;
          return <h5 data-source-line={line}>{children}</h5>;
        },
        h6({ node, children }) {
          const line = node?.position?.start?.line;
          return <h6 data-source-line={line}>{children}</h6>;
        },
        li({ node, children }) {
          const line = node?.position?.start?.line;
          return <li data-source-line={line}>{children}</li>;
        },
        blockquote({ node, children }) {
          const line = node?.position?.start?.line;
          return <blockquote data-source-line={line}>{children}</blockquote>;
        },
      }}
    >
      {content}
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

const CodeBlock: FC<{ language: string; code: string }> = ({
  language,
  code,
}) => {
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
};

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
