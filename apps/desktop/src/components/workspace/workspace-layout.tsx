import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./sidebar";
import { LatexEditor } from "./editor/latex-editor";
import { MarkdownEditor } from "./editor/markdown-editor";
import { PdfPreview } from "./preview/pdf-preview";
import { MarkdownPreview } from "./preview/markdown-preview";
import { ImagePreviewWrapper } from "./preview/image-preview-wrapper";
import { useDocumentStore } from "@/stores/document-store";
import { BugIcon, ImageIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

export function WorkspaceLayout() {
  const initialized = useDocumentStore((s) => s.initialized);
  const activeFile = useDocumentStore((s) =>
    s.files.find((f) => f.id === s.activeFileId),
  );
  const isMarkdown = activeFile?.type === "md";
  const isImage = activeFile?.type === "image";
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);

  const handleToggleDevtools = async () => {
    try {
      const isOpen = await invoke<boolean>("toggle_devtools");
      setDevtoolsOpen(isOpen);
    } catch (err) {
      console.error("Failed to toggle devtools:", err);
    }
  };

  if (!initialized) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading project...</div>
      </div>
    );
  }

  return (
    <PanelGroup direction="horizontal" className="h-full">
      <Panel defaultSize={15} minSize={10} maxSize={25}>
        <Sidebar />
      </Panel>

      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring" />

      <Panel defaultSize={42.5} minSize={25}>
        {isImage ? (
          <div className="flex h-full items-center justify-center bg-muted/50">
            <div className="text-center text-muted-foreground">
              <ImageIcon className="mb-2 size-8 mx-auto" />
              <p className="text-sm">Image preview on the right</p>
            </div>
          </div>
        ) : isMarkdown ? (
          <MarkdownEditor />
        ) : (
          <LatexEditor />
        )}
      </Panel>

      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring" />

      <Panel defaultSize={42.5} minSize={25}>
        {isImage ? (
          <ImagePreviewWrapper />
        ) : isMarkdown ? (
          <MarkdownPreview />
        ) : (
          <PdfPreview />
        )}
      </Panel>

      {/* Dev mode: DevTools toggle button */}
      {import.meta.env.DEV && (
        <button
          onClick={handleToggleDevtools}
          className={`fixed bottom-4 right-4 z-50 flex size-10 items-center justify-center rounded-full shadow-lg transition-colors ${
            devtoolsOpen
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          title={devtoolsOpen ? "Close DevTools" : "Open DevTools"}
        >
          <BugIcon className="size-5" />
        </button>
      )}
    </PanelGroup>
  );
}
