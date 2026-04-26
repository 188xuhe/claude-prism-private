import { useState, useEffect } from "react";
import { MinusIcon, PlusIcon, FileTextIcon } from "lucide-react";
import { useDocumentStore } from "@/stores/document-store";
import { ImagePreview } from "@/components/workspace/editor/image-preview";
import { Button } from "@/components/ui/button";
import { readFile } from "@tauri-apps/plugin-fs";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("image-preview-wrapper");

export function ImagePreviewWrapper() {
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const files = useDocumentStore((s) => s.files);
  const activeFile = files.find((f) => f.id === activeFileId);

  const [scale, setScale] = useState(1.0);
  const [loadingDataUrl, setLoadingDataUrl] = useState<string | null>(null);

  // Load image dataUrl for large images that weren't pre-loaded
  useEffect(() => {
    if (!activeFile || activeFile.type !== "image") {
      setLoadingDataUrl(null);
      return;
    }

    // If already has dataUrl, use it
    if (activeFile.dataUrl) {
      setLoadingDataUrl(null);
      return;
    }

    // Load image content dynamically for large images
    const loadImage = async () => {
      try {
        log.info("Loading large image dynamically", {
          path: activeFile.absolutePath,
        });
        const bytes = await readFile(activeFile.absolutePath);
        const ext = activeFile.name.split(".").pop()?.toLowerCase() || "png";
        const mimeMap: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          bmp: "image/bmp",
        };
        const mime = mimeMap[ext] || "image/png";
        const base64 = btoa(
          bytes.reduce((data, byte) => data + String.fromCharCode(byte), ""),
        );
        const dataUrl = `data:${mime};base64,${base64}`;
        setLoadingDataUrl(dataUrl);
        log.info("Large image loaded", { size: bytes.length });
      } catch (err) {
        log.error("Failed to load large image", { error: String(err) });
        setLoadingDataUrl(null);
      }
    };

    loadImage();
  }, [activeFile]);

  // Debug logging
  useEffect(() => {
    log.info("ImagePreviewWrapper state", {
      activeFileId,
      activeFileType: activeFile?.type,
      activeFileName: activeFile?.name,
      hasDataUrl: !!activeFile?.dataUrl,
      hasAbsolutePath: !!activeFile?.absolutePath,
      hasLoadingDataUrl: !!loadingDataUrl,
    });
  }, [activeFileId, activeFile, loadingDataUrl]);

  if (!activeFile || activeFile.type !== "image") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-muted/50">
        <FileTextIcon className="mb-4 size-12 text-muted-foreground/50" />
        <p className="text-muted-foreground text-sm">
          Select an image file to preview
        </p>
      </div>
    );
  }

  const zoomIn = () => setScale((s) => Math.min(4, s + 0.25));
  const zoomOut = () => setScale((s) => Math.max(0.25, s - 0.25));

  return (
    <div className="flex h-full flex-col bg-muted/50">
      {/* Toolbar */}
      <div className="flex min-h-[calc(40px+var(--titlebar-height))] shrink-0 items-center border-border border-b bg-background px-2 pt-[var(--titlebar-height)]">
        <div className="flex items-center gap-2">
          <FileTextIcon className="size-4 text-muted-foreground" />
          <span className="font-medium text-muted-foreground text-sm">
            {activeFile.name}
          </span>
        </div>
        <div data-tauri-drag-region className="min-w-4 flex-1 self-stretch" />
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={zoomOut}
            disabled={scale <= 0.25}
            title="Zoom out"
          >
            <MinusIcon className="size-3.5" />
          </Button>
          <span className="min-w-[3rem] text-center text-muted-foreground text-xs">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={zoomIn}
            disabled={scale >= 4}
            title="Zoom in"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Image content */}
      <div className="min-h-0 flex-1">
        {loadingDataUrl ? (
          <ImagePreview
            file={{ ...activeFile, dataUrl: loadingDataUrl }}
            scale={scale}
            onScaleChange={setScale}
            cropMode={false}
            onCropModeChange={() => {}}
          />
        ) : activeFile?.dataUrl ? (
          <ImagePreview
            file={activeFile}
            scale={scale}
            onScaleChange={setScale}
            cropMode={false}
            onCropModeChange={() => {}}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-muted-foreground text-sm">
              Loading image...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
