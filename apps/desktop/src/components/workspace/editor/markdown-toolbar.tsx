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
  GitBranchIcon,
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

  const insertMermaidDiagram = (diagramType: string) => {
    const view = editorView.current;
    if (!view) return;

    const templates: Record<string, string> = {
      flowchart: `flowchart TB
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]`,
      sequence: `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello!
    B-->>A: Hi!`,
      class: `classDiagram
    class Animal {
        +String name
        +makeSound()
    }
    class Dog {
        +bark()
    }
    Animal <|-- Dog`,
      state: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: Start
    Processing --> Done: Complete
    Done --> [*]`,
      er: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "is in"`,
      gantt: `gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Planning
    Research :a1, 2024-01-01, 7d
    Design :a2, after a1, 5d`,
      pie: `pie showData
    title Distribution
    "Category A" : 45
    "Category B" : 30
    "Category C" : 25`,
    };

    const template = templates[diagramType] || templates.flowchart;
    const { from } = view.state.selection.main;
    const insertText = `\n\`\`\`mermaid\n${template}\n\`\`\`\n`;

    view.dispatch({
      changes: {
        from,
        to: from,
        insert: insertText,
      },
      selection: {
        anchor: from + insertText.length,
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
      <div className="mx-2 h-4 w-px bg-border" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 p-1"
            title="Insert Mermaid Diagram"
          >
            <GitBranchIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => insertMermaidDiagram("flowchart")}>
            Flowchart
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => insertMermaidDiagram("sequence")}>
            Sequence Diagram
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => insertMermaidDiagram("class")}>
            Class Diagram
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => insertMermaidDiagram("state")}>
            State Diagram
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => insertMermaidDiagram("er")}>
            ER Diagram
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => insertMermaidDiagram("gantt")}>
            Gantt Chart
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => insertMermaidDiagram("pie")}>
            Pie Chart
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
