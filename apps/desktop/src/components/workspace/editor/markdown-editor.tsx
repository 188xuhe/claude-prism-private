import { useCallback, useEffect, useRef, useState } from "react";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  scrollPastEnd,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
  indentLess,
  toggleComment,
} from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { oneDark, oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { defaultHighlightStyle } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { useTheme } from "next-themes";
import {
  search,
  highlightSelectionMatches,
  SearchQuery,
  setSearchQuery as setSearchQueryEffect,
  findNext,
  findPrevious,
} from "@codemirror/search";
import { forEachDiagnostic } from "@codemirror/lint";
import { RotateCcwIcon, TagIcon, CopyIcon, XIcon } from "lucide-react";
import { useDocumentStore } from "@/stores/document-store";
import { useHistoryStore } from "@/stores/history-store";
import { MarkdownToolbar } from "./markdown-toolbar";
import { SearchPanel } from "./search-panel";
import { ProblemsPanel, type DiagnosticItem } from "./problems-panel";
import { HistoryDiffView } from "./history-diff-view";
import { ClaudeChatDrawer } from "@/components/claude-chat/claude-chat-drawer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("markdown-editor");

/** Per-file editor state cache: fileId → { cursor, scrollTop } */
const editorStateCache = new Map<
  string,
  { cursor: number; scrollTop: number }
>();

/** Clear editor state cache (e.g., on project close). */
export function clearMdEditorStateCache(): void {
  editorStateCache.clear();
}

export function MarkdownEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const files = useDocumentStore((s) => s.files);
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const setContent = useDocumentStore((s) => s.setContent);
  const setCursorPosition = useDocumentStore((s) => s.setCursorPosition);
  const setSelectionRange = useDocumentStore((s) => s.setSelectionRange);
  const jumpToPosition = useDocumentStore((s) => s.jumpToPosition);
  const clearJumpRequest = useDocumentStore((s) => s.clearJumpRequest);
  const setEditorScrollLine = useDocumentStore((s) => s.setEditorScrollLine);

  // History review state
  const reviewingSnapshot = useHistoryStore((s) => s.reviewingSnapshot);
  const historyDiffResult = useHistoryStore((s) => s.diffResult);

  const activeFile = files.find((f) => f.id === activeFileId);
  const isTextFile = activeFile?.type === "md";
  const activeFileContent = activeFile?.content;
  const isLargeFileNotLoaded =
    isTextFile && activeFileContent === undefined && !!activeFile;
  const isContentLoaded = activeFileContent !== undefined;
  const loadFileContent = useDocumentStore((s) => s.loadFileContent);
  const refreshFiles = useDocumentStore((s) => s.refreshFiles);

  // Handle image paste - save to assets/images and insert markdown link
  const handleImagePaste = useCallback(
    async (file: File): Promise<boolean> => {
      if (!projectRoot || !viewRef.current) return false;

      try {
        // Create assets/images directory if not exists
        const assetsDir = await join(projectRoot, "assets", "images");
        await mkdir(assetsDir, { recursive: true });

        // Generate unique filename
        const timestamp = Date.now();
        const ext = file.name.split(".").pop() || "png";
        const fileName = `image-${timestamp}.${ext}`;
        const filePath = await join(assetsDir, fileName);

        // Read file content and save
        const arrayBuffer = await file.arrayBuffer();
        await writeFile(filePath, new Uint8Array(arrayBuffer));

        log.info("Image saved", { path: filePath });

        // Insert markdown image syntax at cursor position
        const view = viewRef.current;
        const { from } = view.state.selection.main;
        const relativePath = `assets/images/${fileName}`;
        const imageMarkdown = `![${file.name.replace(/\.[^.]+$/, "")}](${relativePath})`;

        view.dispatch({
          changes: { from, to: from, insert: imageMarkdown },
          selection: { anchor: from + imageMarkdown.length },
        });

        // Refresh file tree to show new image
        refreshFiles().catch((err) =>
          log.error("Failed to refresh files", { error: String(err) }),
        );

        return true;
      } catch (err) {
        log.error("Failed to save pasted image", { error: String(err) });
        return false;
      }
    },
    [projectRoot, refreshFiles],
  );

  // Paste event handler for images
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!isTextFile || !isContentLoaded) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await handleImagePaste(file);
          }
          return;
        }
      }
    };

    // Add paste listener to the editor container
    const container = containerRef.current;
    if (container) {
      container.addEventListener("paste", handlePaste);
      return () => container.removeEventListener("paste", handlePaste);
    }
  }, [isTextFile, isContentLoaded, handleImagePaste]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const diagnosticsRef = useRef<DiagnosticItem[]>([]);
  const isSearchOpenRef = useRef(false);
  const themeCompartmentRef = useRef(new Compartment());

  useEffect(() => {
    isSearchOpenRef.current = isSearchOpen;
  }, [isSearchOpen]);

  useEffect(() => {
    if (!searchQuery || !activeFileContent) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }
    const regex = new RegExp(
      searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    const matches = activeFileContent.match(regex);
    setMatchCount(matches?.length ?? 0);
    setCurrentMatch(matches && matches.length > 0 ? 1 : 0);
  }, [searchQuery, activeFileContent]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const query = new SearchQuery({
      search: searchQuery,
      caseSensitive: false,
      literal: true,
    });
    view.dispatch({ effects: setSearchQueryEffect.of(query) });
    if (searchQuery) findNext(view);
  }, [searchQuery]);

  const handleFindNext = () => {
    const view = viewRef.current;
    if (view) {
      findNext(view);
      view.focus();
    }
  };
  const handleFindPrevious = () => {
    const view = viewRef.current;
    if (view) {
      findPrevious(view);
      view.focus();
    }
  };

  const { resolvedTheme } = useTheme();

  // Main editor setup
  useEffect(() => {
    // Don't initialize editor until content is loaded (for lazy-loaded files)
    if (!containerRef.current || !isTextFile || !isContentLoaded) return;
    const currentContent = activeFileContent ?? "";

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setContent(update.state.doc.toString());
      }
      if (update.selectionSet) {
        const { from, to, head } = update.state.selection.main;
        setCursorPosition(head);
        if (from !== to) {
          setSelectionRange({ start: from, end: to });
        } else {
          setSelectionRange(null);
        }
      }

      // Sync diagnostics for Problems panel
      const diags: DiagnosticItem[] = [];
      forEachDiagnostic(update.state, (d, from) => {
        diags.push({
          from,
          to: d.to,
          severity: d.severity,
          message: d.message,
          line: update.state.doc.lineAt(from).number,
        });
      });
      if (
        diags.length !== diagnosticsRef.current.length ||
        diags.some(
          (d, i) =>
            d.from !== diagnosticsRef.current[i]?.from ||
            d.message !== diagnosticsRef.current[i]?.message,
        )
      ) {
        diagnosticsRef.current = diags;
        setDiagnostics(diags);
      }
    });

    const wrapSelection = (wrapper: string): boolean => {
      const { from, to } = viewRef.current!.state.selection.main;
      const selected = viewRef.current!.state.sliceDoc(from, to);
      viewRef.current!.dispatch({
        changes: { from, to, insert: wrapper + selected + wrapper },
        selection: { anchor: from + wrapper.length + selected.length },
      });
      return true;
    };

    const insertBlockPrefix = (prefix: string): boolean => {
      const { from } = viewRef.current!.state.selection.main;
      const line = viewRef.current!.state.doc.lineAt(from);
      viewRef.current!.dispatch({
        changes: { from: line.from, to: line.from, insert: prefix },
        selection: { anchor: line.from + prefix.length },
      });
      return true;
    };

    const editorKeymap = Prec.highest(
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            const state = useDocumentStore.getState();
            state.setIsSaving(true);
            state
              .saveCurrentFile()
              .finally(() => setTimeout(() => state.setIsSaving(false), 500));
            return true;
          },
        },
        {
          key: "Mod-f",
          run: () => {
            setIsSearchOpen(true);
            return true;
          },
        },
        {
          key: "Escape",
          run: () => {
            if (isSearchOpenRef.current) {
              setIsSearchOpen(false);
              return true;
            }
            return false;
          },
        },
        {
          key: "Mod-b",
          run: () => wrapSelection("**"),
        },
        {
          key: "Mod-i",
          run: () => wrapSelection("*"),
        },
        {
          key: "Mod-/",
          run: toggleComment,
        },
      ]),
    );

    const state = EditorState.create({
      doc: currentContent,
      extensions: [
        editorKeymap,
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        keymap.of([
          { key: "Tab", run: indentMore, shift: indentLess },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        markdown({ base: markdownLanguage }),
        themeCompartmentRef.current.of(
          resolvedTheme === "dark"
            ? [oneDark, syntaxHighlighting(oneDarkHighlightStyle)]
            : [syntaxHighlighting(defaultHighlightStyle)],
        ),
        search(),
        highlightSelectionMatches(),
        updateListener,
        EditorView.lineWrapping,
        scrollPastEnd(),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "14px",
            color: "var(--foreground)",
            backgroundColor: "var(--background)",
            WebkitBackfaceVisibility: "hidden",
            backfaceVisibility: "hidden",
          },
          ".cm-scroller": {
            overflow: "auto",
            WebkitTransform: "translateZ(0)",
            transform: "translateZ(0)",
          },
          ".cm-gutters": { paddingRight: "4px" },
          ".cm-lineNumbers .cm-gutterElement": {
            paddingLeft: "8px",
            paddingRight: "4px",
          },
          ".cm-content": {
            paddingLeft: "8px",
            paddingRight: "12px",
          },
          ".cm-searchMatch": {
            backgroundColor: "#facc15 !important",
            color: "#000 !important",
            borderRadius: "2px",
            boxShadow: "0 0 0 1px #eab308",
          },
          ".cm-searchMatch-selected": {
            backgroundColor: "#f97316 !important",
            color: "#fff !important",
            borderRadius: "2px",
            boxShadow: "0 0 0 2px #ea580c",
          },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: "rgba(100, 150, 255, 0.3)",
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    // Scroll sync: update store with current first visible line (throttled with RAF)
    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId !== null) return; // Already pending
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const view = viewRef.current;
        if (!view) return;
        const scrollTop = view.scrollDOM.scrollTop;
        // Get the line block at the scroll position
        const block = view.lineBlockAtHeight(scrollTop);
        const line = view.state.doc.lineAt(block.from).number;
        setEditorScrollLine(line);
      });
    };

    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });

    // Restore per-file cursor + scroll from cache
    const cached = editorStateCache.get(activeFileId);
    if (cached) {
      const pos = Math.min(cached.cursor, view.state.doc.length);
      view.dispatch({ selection: { anchor: pos, head: pos } });
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = cached.scrollTop;
      });
    }

    return () => {
      // Save per-file cursor + scroll before destroying
      editorStateCache.set(activeFileId, {
        cursor: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      });
      // Clean up scroll listener and pending RAF
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      view.destroy();
      viewRef.current = null;
    };
  }, [
    activeFileId,
    isTextFile,
    isContentLoaded,
    setContent,
    setCursorPosition,
    setSelectionRange,
    setEditorScrollLine,
  ]);

  // Dynamically switch editor theme
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const extensions =
      resolvedTheme === "dark"
        ? [oneDark, syntaxHighlighting(oneDarkHighlightStyle)]
        : [syntaxHighlighting(defaultHighlightStyle)];
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(extensions),
    });
  }, [resolvedTheme]);

  // Sync content from store
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !isTextFile) return;
    const content = activeFileContent ?? "";
    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: content },
      });
    }
  }, [activeFileContent, isTextFile]);

  // Jump to position
  useEffect(() => {
    const view = viewRef.current;
    if (!view || jumpToPosition === null) return;
    view.dispatch({
      selection: { anchor: jumpToPosition },
      effects: EditorView.scrollIntoView(jumpToPosition, { y: "center" }),
    });
    view.focus();
    clearJumpRequest();
  }, [jumpToPosition, clearJumpRequest]);

  // History review action handlers
  const handleHistoryRestore = useCallback(async () => {
    if (!reviewingSnapshot || !projectRoot) return;
    useHistoryStore.getState().stopReview();
    await useHistoryStore
      .getState()
      .restoreSnapshot(projectRoot, reviewingSnapshot.id);
    await useDocumentStore.getState().openProject(projectRoot);
    await useHistoryStore.getState().loadSnapshots(projectRoot);
  }, [reviewingSnapshot, projectRoot]);

  const [historyLabelDialogOpen, setHistoryLabelDialogOpen] = useState(false);
  const [historyLabelValue, setHistoryLabelValue] = useState("");

  const handleHistoryAddLabel = useCallback(async () => {
    const label = historyLabelValue.trim();
    if (!label || !reviewingSnapshot || !projectRoot) return;
    await useHistoryStore
      .getState()
      .addLabel(projectRoot, reviewingSnapshot.id, label);
    setHistoryLabelDialogOpen(false);
    setHistoryLabelValue("");
  }, [reviewingSnapshot, projectRoot, historyLabelValue]);

  const handleHistoryCopySha = useCallback(() => {
    if (!reviewingSnapshot) return;
    navigator.clipboard.writeText(reviewingSnapshot.id);
  }, [reviewingSnapshot]);

  const handleHistoryClose = useCallback(() => {
    useHistoryStore.getState().stopReview();
  }, []);

  const isPdf = activeFile?.type === "pdf";

  return (
    <div className="flex h-full flex-col bg-background">
      <MarkdownToolbar editorView={viewRef} />
      {!isPdf && !isLargeFileNotLoaded && isSearchOpen && (
        <SearchPanel
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onClose={() => {
            setIsSearchOpen(false);
            setSearchQuery("");
            viewRef.current?.focus();
          }}
          onFindNext={handleFindNext}
          onFindPrevious={handleFindPrevious}
          matchCount={matchCount}
          currentMatch={currentMatch}
        />
      )}
      {/* History review banner */}
      {!isPdf && !isLargeFileNotLoaded && reviewingSnapshot && (
        <div className="flex h-9 shrink-0 items-center justify-between border-border border-b bg-amber-500/10 px-3">
          <div className="flex items-center gap-2 text-xs">
            <RotateCcwIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
            <span className="font-medium text-amber-700 dark:text-amber-300">
              Reviewing history
            </span>
            <span className="text-muted-foreground">
              {reviewingSnapshot.message.replace(/^\[.*?\]\s*/, "")} &middot;{" "}
              {reviewingSnapshot.id.slice(0, 7)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={handleHistoryRestore}
            >
              <RotateCcwIcon className="size-3" />
              Restore
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => {
                setHistoryLabelDialogOpen(true);
                setHistoryLabelValue("");
              }}
            >
              <TagIcon className="size-3" />
              Label
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={handleHistoryCopySha}
            >
              <CopyIcon className="size-3" />
              SHA
            </Button>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={handleHistoryClose}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
      {/* Main content area — wrapper for stable ClaudeChatDrawer */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Large file warning */}
        {isLargeFileNotLoaded && activeFile && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="max-w-md rounded-lg border border-border bg-card/50 p-6 shadow-sm">
              <p className="mb-1 font-medium text-foreground text-sm">
                {activeFile.name}
              </p>
              <p className="mb-4 text-muted-foreground text-xs">
                This file is large (
                {activeFile.fileSize != null
                  ? `${(activeFile.fileSize / (1024 * 1024)).toFixed(1)} MB`
                  : "unknown size"}
                ). Opening it may slow down the editor.
              </p>
              <button
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted"
                onClick={() => loadFileContent(activeFile.id)}
              >
                Open Anyway
              </button>
            </div>
          </div>
        )}
        {/* Text editor content */}
        {!isPdf && !isLargeFileNotLoaded && isContentLoaded && (
          <>
            <div
              ref={containerRef}
              className={reviewingSnapshot ? "hidden" : "absolute inset-0"}
            />
            {reviewingSnapshot && historyDiffResult && (
              <HistoryDiffView diffs={historyDiffResult} />
            )}
          </>
        )}
        {/* Loading state for text files */}
        {!isPdf && !isLargeFileNotLoaded && !isContentLoaded && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-muted-foreground text-sm">Loading...</div>
          </div>
        )}
        {/* Chat drawer */}
        <ClaudeChatDrawer />
      </div>
      {/* Problems panel */}
      {!isPdf && !isLargeFileNotLoaded && diagnostics.length > 0 && (
        <ProblemsPanel
          diagnostics={diagnostics}
          fileName={activeFile?.relativePath ?? "README.md"}
          onNavigate={(from) => {
            const view = viewRef.current;
            if (!view) return;
            view.dispatch({
              selection: { anchor: from },
              effects: EditorView.scrollIntoView(from, { y: "center" }),
            });
            view.focus();
          }}
          onFixWithChat={() => {}}
          onFixAllWithChat={() => {}}
        />
      )}
      {/* History label dialog */}
      <Dialog
        open={historyLabelDialogOpen}
        onOpenChange={setHistoryLabelDialogOpen}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Label</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="e.g. Draft v1"
              value={historyLabelValue}
              onChange={(e) => setHistoryLabelValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleHistoryAddLabel();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setHistoryLabelDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleHistoryAddLabel}
              disabled={!historyLabelValue.trim()}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
