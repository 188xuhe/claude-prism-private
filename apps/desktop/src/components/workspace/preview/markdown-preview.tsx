import { useState, useCallback, useEffect, useRef } from "react";
import {
  LoaderIcon,
  AlertCircleIcon,
  FileTextIcon,
  DownloadIcon,
  HistoryIcon,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { exportElementToPdf } from "@/lib/pdf-export";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { MarkdownRenderer } from "@/components/claude-chat/markdown-renderer";
import { FileHistoryPanel } from "@/components/workspace/file-history-panel";
import { useDocumentStore } from "@/stores/document-store";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("markdown-preview");

/** Slugify a heading title to match react-markdown's generated ID. */
function slugifyHeading(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function MarkdownPreview() {
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const files = useDocumentStore((s) => s.files);
  const activeFile = files.find((f) => f.id === activeFileId);
  // Subscribe to contentGeneration to force re-renders when content changes
  const contentGeneration = useDocumentStore((s) => s.contentGeneration);
  const scrollToHeading = useDocumentStore((s) => s.scrollToHeading);
  const clearScrollToHeading = useDocumentStore((s) => s.clearScrollToHeading);

  // Get content from the active file - contentGeneration in dependency ensures updates
  const activeFileContent = activeFile?.content ?? "";

  // Debug log for content changes
  useEffect(() => {
    log.info("Preview content updated", {
      length: activeFileContent.length,
      generation: contentGeneration,
    });
  }, [activeFileContent, contentGeneration]);

  // Scroll to heading when triggered by Outline click
  useEffect(() => {
    if (!scrollToHeading || !previewContainerRef.current) return;

    const container = previewContainerRef.current;
    const slugId = slugifyHeading(scrollToHeading.title);

    // Try to find by ID first (react-markdown generates IDs)
    let headingEl = container.querySelector(`#${slugId}`) as HTMLElement | null;

    // If not found by ID, search by text content
    if (!headingEl) {
      const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
      for (const h of headings) {
        if (h.textContent?.trim() === scrollToHeading.title) {
          headingEl = h as HTMLElement;
          break;
        }
      }
    }

    if (headingEl) {
      headingEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    clearScrollToHeading();
  }, [scrollToHeading, clearScrollToHeading]);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    if (!activeFile || !previewContainerRef.current) return;

    setIsExporting(true);
    setExportError(null);

    try {
      log.info("Starting PDF export", { file: activeFile.name });

      // Get the content container (the scrollable div with rendered markdown)
      const contentContainer = previewContainerRef.current.querySelector(
        ".prose",
      ) as HTMLElement;
      if (!contentContainer) {
        throw new Error("Could not find content container");
      }

      // Ask user where to save
      const defaultName = activeFile.name.replace(/\.md$/i, ".pdf");
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (!savePath) {
        setIsExporting(false);
        return;
      }

      // Export the rendered content to PDF and get bytes
      const pdfBytes = await exportElementToPdf(contentContainer, {
        title: activeFile.name,
      });

      // Save PDF bytes to user-selected path using Tauri fs
      await writeFile(savePath, pdfBytes);

      log.info("PDF exported successfully", { path: savePath });
      setIsExporting(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setExportError(message);
      log.error("PDF export failed", { error: message });
      setIsExporting(false);
    }
  }, [activeFile]);

  // Clear error when file changes
  useEffect(() => {
    setExportError(null);
  }, [activeFile?.id]);

  return (
    <div className="flex h-full flex-col bg-muted/50">
      {/* Toolbar */}
      <div className="flex min-h-[calc(40px+var(--titlebar-height))] shrink-0 items-center border-border border-b bg-background px-2 pt-[var(--titlebar-height)]">
        <div className="flex items-center gap-2">
          <FileTextIcon className="size-4 text-muted-foreground" />
          <span className="font-medium text-muted-foreground text-sm">
            Preview
          </span>
        </div>
        <div data-tauri-drag-region className="min-w-4 flex-1 self-stretch" />
        <div className="flex shrink-0 items-center gap-2">
          {activeFile?.type === "md" && (
            <>
              {!isExporting && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  onClick={handleExport}
                  title="Export to PDF"
                >
                  <DownloadIcon className="size-3.5" />
                  Export PDF
                </Button>
              )}
              {isExporting && (
                <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
                  <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
                  <span className="font-medium text-muted-foreground text-xs">
                    Exporting...
                  </span>
                </div>
              )}
            </>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title="History"
              >
                <HistoryIcon className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96">
              {activeFile?.relativePath && (
                <FileHistoryPanel
                  filePath={activeFile.relativePath}
                  maxHeight="max-h-[32rem]"
                />
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Error banner */}
      {exportError && activeFile?.type === "md" && (
        <div className="shrink-0 border-border border-b bg-destructive/10 px-4 py-2">
          <div className="flex items-center gap-2">
            <AlertCircleIcon className="size-4 text-destructive" />
            <span className="text-destructive text-sm">{exportError}</span>
          </div>
        </div>
      )}

      {/* Preview content */}
      <div
        ref={previewContainerRef}
        className="min-h-0 flex-1 overflow-hidden p-4"
      >
        <div className="h-full overflow-auto">
          {activeFile?.type === "md" && activeFileContent ? (
            <MarkdownRenderer
              content={activeFileContent}
              className="prose prose-sm dark:prose-invert max-w-none"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center">
              <FileTextIcon className="mb-4 size-12 text-muted-foreground/50" />
              <p className="text-center text-muted-foreground text-sm">
                {activeFile?.type !== "md"
                  ? "Select a Markdown file to preview"
                  : "Empty file"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
