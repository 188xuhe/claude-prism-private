import { RefObject, useCallback, useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import {
  BoldIcon,
  ItalicIcon,
  ListIcon,
  Heading1Icon,
  Heading2Icon,
  CodeIcon,
  LinkIcon,
  QuoteIcon,
  FileTextIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDocumentStore } from "@/stores/document-store";

interface EditorInfo {
  id: string;
  name: string;
}

interface MarkdownToolbarProps {
  editorView: RefObject<EditorView | null>;
}

export function MarkdownToolbar({ editorView }: MarkdownToolbarProps) {
  const fileName = useDocumentStore((s) => {
    const activeFile = s.files.find((f) => f.id === s.activeFileId);
    return activeFile?.name ?? "README.md";
  });
  const activeFilePath = useDocumentStore((s) => {
    const activeFile = s.files.find((f) => f.id === s.activeFileId);
    return activeFile?.relativePath;
  });
  const projectRoot = useDocumentStore((s) => s.projectRoot);

  const [editors, setEditors] = useState<EditorInfo[]>([]);

  useEffect(() => {
    invoke<EditorInfo[]>("detect_editors")
      .then(setEditors)
      .catch(() => {});
  }, []);

  const openInEditor = useCallback(
    (editorId: string) => {
      if (!projectRoot) return;
      const view = editorView.current;
      const line = view
        ? view.state.doc.lineAt(view.state.selection.main.head).number
        : undefined;
      invoke("open_in_editor", {
        editorId,
        projectPath: projectRoot,
        filePath: activeFilePath,
        line,
      }).catch((err) => console.error("open_in_editor failed:", err));
    },
    [projectRoot, activeFilePath, editorView],
  );

  const insertText = (before: string, after: string = "") => {
    const view = editorView.current;
    if (!view) return;

    const { from, to } = view.state.selection.main;
    const selectedText = view.state.sliceDoc(from, to);

    view.dispatch({
      changes: {
        from,
        to,
        insert: before + selectedText + after,
      },
      selection: {
        anchor: from + before.length,
        head: from + before.length + selectedText.length,
      },
    });
    view.focus();
  };

  const wrapSelection = (wrapper: string) => {
    insertText(wrapper, wrapper);
  };

  const insertBlockPrefix = (prefix: string) => {
    const view = editorView.current;
    if (!view) return;

    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const lineStart = line.from;

    // Insert prefix at the beginning of the current line
    view.dispatch({
      changes: {
        from: lineStart,
        to: lineStart,
        insert: prefix,
      },
      selection: {
        anchor: lineStart + prefix.length,
      },
    });
    view.focus();
  };

  return (
    <div className="flex h-[calc(36px+var(--titlebar-height))] items-center gap-1 border-border border-b bg-muted/30 px-2 pt-[var(--titlebar-height)]">
      <FileTextIcon className="size-4 text-muted-foreground" />
      <span className="mr-2 font-medium text-muted-foreground text-sm">
        {fileName}
      </span>
      <div className="mx-2 h-4 w-px bg-border" />
      <TooltipIconButton
        tooltip="Bold (**text**)"
        onClick={() => wrapSelection("**")}
      >
        <BoldIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Italic (*text*)"
        onClick={() => wrapSelection("*")}
      >
        <ItalicIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Code (`code`)"
        onClick={() => wrapSelection("`")}
      >
        <CodeIcon className="size-4" />
      </TooltipIconButton>
      <div className="mx-2 h-4 w-px bg-border" />
      <TooltipIconButton
        tooltip="Heading 1 (#)"
        onClick={() => insertBlockPrefix("# ")}
      >
        <Heading1Icon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Heading 2 (##)"
        onClick={() => insertBlockPrefix("## ")}
      >
        <Heading2Icon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="List item (-)"
        onClick={() => insertBlockPrefix("- ")}
      >
        <ListIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Quote (>)"
        onClick={() => insertBlockPrefix("> ")}
      >
        <QuoteIcon className="size-4" />
      </TooltipIconButton>
      <div className="mx-2 h-4 w-px bg-border" />
      <TooltipIconButton
        tooltip="Link [text](url)"
        onClick={() => insertText("[", "](url)")}
      >
        <LinkIcon className="size-4" />
      </TooltipIconButton>
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      {editors.length === 1 && (
        <TooltipIconButton
          tooltip={`Open in ${editors[0].name}`}
          onClick={() => openInEditor(editors[0].id)}
        >
          <ExternalLinkIcon className="size-4" />
        </TooltipIconButton>
      )}
      {editors.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 p-1"
              title="Open in Editor"
            >
              <ExternalLinkIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {editors.map((editor) => (
              <DropdownMenuItem
                key={editor.id}
                onClick={() => openInEditor(editor.id)}
              >
                {editor.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
