import { useState, useCallback, useEffect } from "react";
import {
  LoaderIcon,
  AlertCircleIcon,
  FileTextIcon,
  DownloadIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/claude-chat/markdown-renderer";
import { useDocumentStore } from "@/stores/document-store";
import {
  usePandocSetupStore,
  setupPandocEventListeners,
  cleanupPandocEventListeners,
} from "@/stores/pandoc-setup-store";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("markdown-preview");

export function MarkdownPreview() {
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const files = useDocumentStore((s) => s.files);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const activeFile = files.find((f) => f.id === activeFileId);
  // Subscribe to contentGeneration to force re-renders when content changes
  const contentGeneration = useDocumentStore((s) => s.contentGeneration);

  // Get content from the active file - contentGeneration in dependency ensures updates
  const activeFileContent = activeFile?.content ?? "";

  // Pandoc setup state
  const pandocStatus = usePandocSetupStore((s) => s.status);
  const pandocVersion = usePandocSetupStore((s) => s.version);
  const pandocError = usePandocSetupStore((s) => s.error);
  const installOutput = usePandocSetupStore((s) => s.installOutput);
  const checkPandocStatus = usePandocSetupStore((s) => s.checkStatus);
  const installPandoc = usePandocSetupStore((s) => s.install);

  // Debug log for content changes
  useEffect(() => {
    log.info("Preview content updated", { length: activeFileContent.length, generation: contentGeneration });
  }, [activeFileContent, contentGeneration]);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Setup event listeners and check pandoc status on mount
  useEffect(() => {
    // First set up listeners, then check status
    setupPandocEventListeners().then(() => {
      checkPandocStatus();
    });

    return () => {
      cleanupPandocEventListeners();
    };
  }, [checkPandocStatus]);

  const handleExport = useCallback(async () => {
    if (!activeFile || !projectRoot) return;

    if (pandocStatus !== "ready") {
      // If not ready, trigger installation
      if (pandocStatus === "not-installed" || pandocStatus === "error") {
        installPandoc();
      }
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      log.info("Starting PDF export with pandoc", { file: activeFile.name });

      // Call pandoc to convert markdown to PDF
      const pdfBytes = await invoke<ArrayBuffer>("compile_markdown_to_pdf", {
        workDir: projectRoot,
        mdFile: activeFile.name,
      });

      log.info("PDF generated", { size: pdfBytes.byteLength });

      // Ask user where to save
      const defaultName = activeFile.name.replace(/\.md$/i, ".pdf");
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (savePath) {
        // Write PDF file
        await writeFile(savePath, new Uint8Array(pdfBytes));
        log.info("PDF saved", { path: savePath });
      }

      setIsExporting(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setExportError(message);
      log.error("PDF export failed", { error: message });
      setIsExporting(false);
    }
  }, [activeFile, projectRoot, pandocStatus, installPandoc]);

  // Clear error when file changes
  useEffect(() => {
    setExportError(null);
  }, [activeFile?.id]);

  // Render status indicator
  const renderStatus = () => {
    switch (pandocStatus) {
      case "checking":
        return (
          <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1">
            <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
            <span className="font-medium text-muted-foreground text-xs">Checking...</span>
          </div>
        );
      case "installing":
        return (
          <div className="flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2 py-1">
            <LoaderIcon className="size-3.5 animate-spin text-blue-500" />
            <span className="font-medium text-blue-600 text-xs">
              Installing pandoc...
            </span>
          </div>
        );
      case "ready":
        return (
          <span className="text-muted-foreground text-xs">
            v{pandocVersion}
          </span>
        );
      case "error":
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs text-orange-500"
            onClick={installPandoc}
            title="Retry pandoc installation"
          >
            <AlertCircleIcon className="size-3.5" />
            Retry Install
          </Button>
        );
      default:
        return null;
    }
  };

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
              {renderStatus()}
              {!isExporting && pandocStatus === "ready" && (
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
        </div>
      </div>

      {/* Installation progress */}
      {pandocStatus === "installing" && installOutput.length > 0 && (
        <div className="shrink-0 max-h-24 overflow-auto border-b border-border bg-blue-500/5 p-2">
          <pre className="font-mono text-blue-600 text-xs whitespace-pre-wrap">
            {installOutput.join("\n")}
          </pre>
        </div>
      )}

      {/* Error banner */}
      {(pandocError || exportError) && activeFile?.type === "md" && (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-4 py-2">
          <div className="flex items-center gap-2">
            <AlertCircleIcon className="size-4 text-destructive" />
            <span className="text-destructive text-sm">{exportError || pandocError}</span>
          </div>
        </div>
      )}

      {/* Preview content */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
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
  );
}