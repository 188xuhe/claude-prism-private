# Editor-Preview Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement editor-to-preview scroll sync for Markdown files and display image files in the preview panel.

**Architecture:** Single-direction scroll sync using document-store state; ImagePreview component moved from editor to preview area with workspace-layout routing changes.

**Tech Stack:** React, Zustand (document-store), CodeMirror (EditorView), react-markdown, Tauri

---

## File Structure

| File | Responsibility |
|------|-----------------|
| `stores/document-store.ts` | Add `editorScrollLine` state for scroll position sharing |
| `components/workspace/editor/markdown-editor.tsx` | Add scroll listener, remove ImagePreview rendering |
| `components/workspace/preview/markdown-preview.tsx` | Add scroll sync effect, listen to store changes |
| `components/claude-chat/markdown-renderer.tsx` | Add `data-source-line` attributes to elements |
| `components/workspace/workspace-layout.tsx` | Add `isImage` routing logic for both panels |
| `components/workspace/preview/image-preview-wrapper.tsx` | **New**: Wrapper component for image preview with toolbar |

---

## Feature 1: Editor Scroll Sync to Preview

### Task 1: Add editorScrollLine state to document-store

**Files:**
- Modify: `apps/desktop/src/stores/document-store.ts`

- [ ] **Step 1: Add state and setter to store interface**

Find the store interface definition and add the new state. Look for the state type definition around the top of the file and add:

```typescript
// In the state interface
editorScrollLine: number | null;
setEditorScrollLine: (line: number) => void;
```

- [ ] **Step 2: Implement in the zustand store create**

Find the `create` function and add implementation:

```typescript
// In the create function
editorScrollLine: null,
setEditorScrollLine: (line) => set({ editorScrollLine: line }),
```

- [ ] **Step 3: Verify the store compiles**

Run: `cd apps/desktop && pnpm tsc --noEmit`
Expected: No errors related to document-store

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/stores/document-store.ts
git commit -m "feat: add editorScrollLine state for scroll sync

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Add scroll listener to markdown-editor

**Files:**
- Modify: `apps/desktop/src/components/workspace/editor/markdown-editor.tsx`

- [ ] **Step 1: Import the new store action**

Add import for the scroll line getter:

```typescript
const setEditorScrollLine = useDocumentStore((s) => s.setEditorScrollLine);
```

Add this near the other store subscriptions (around line 80-85).

- [ ] **Step 2: Add scroll event listener to EditorView**

Find the main editor setup useEffect (around line 248-450). After the view is created, add a scroll listener. Add this after `viewRef.current = view;` (around line 424):

```typescript
// Add after: viewRef.current = view;

// Scroll sync: update store with current first visible line
const handleScroll = () => {
  const view = viewRef.current;
  if (!view) return;
  const scrollTop = view.scrollDOM.scrollTop;
  // Get the document position at the top of the viewport
  const visibleTop = view.contentDOM.getBoundingClientRect().top - view.scrollDOM.getBoundingClientRect().top;
  const pos = view.posAtHeight(view.scrollDOM.getBoundingClientRect().height - visibleTop, 'top');
  // Handle edge case where posAtHeight returns null
  if (pos !== null) {
    const line = view.state.doc.lineAt(pos).number;
    setEditorScrollLine(line);
  }
};

view.scrollDOM.addEventListener('scroll', handleScroll);
```

- [ ] **Step 3: Clean up scroll listener on destroy**

Modify the return cleanup function (around line 436) to remove the listener:

```typescript
return () => {
  // Save per-file cursor + scroll before destroying
  editorStateCache.set(activeFileId, {
    cursor: view.state.selection.main.head,
    scrollTop: view.scrollDOM.scrollTop,
  });
  // Clean up scroll listener
  view.scrollDOM.removeEventListener('scroll', handleScroll);
  view.destroy();
  viewRef.current = null;
};
```

Note: Need to define `handleScroll` before the return statement so it can be referenced in cleanup.

- [ ] **Step 4: Verify editor compiles**

Run: `cd apps/desktop && pnpm tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/workspace/editor/markdown-editor.tsx
git commit -m "feat: add scroll listener for editor-to-preview sync

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Add data-source-line attributes to MarkdownRenderer

**Files:**
- Modify: `apps/desktop/src/components/claude-chat/markdown-renderer.tsx`

- [ ] **Step 1: Create a wrapper component that adds line attributes**

The ReactMarkdown components prop allows customizing each element. Modify the `MarkdownRenderer` component to add `data-source-line` attributes. Find the `components` prop in ReactMarkdown (around line 183-214) and modify:

```typescript
components={{
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className: codeClassName, children, node, ...props }) {
    // ... existing code block logic ...
  },
  // Add these new components for line tracking
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
```

- [ ] **Step 2: Verify MarkdownRenderer compiles**

Run: `cd apps/desktop && pnpm tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/claude-chat/markdown-renderer.tsx
git commit -m "feat: add data-source-line attributes for scroll sync mapping

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Add scroll sync effect to markdown-preview

**Files:**
- Modify: `apps/desktop/src/components/workspace/preview/markdown-preview.tsx`

- [ ] **Step 1: Import the scroll line state**

Add import near the other store subscriptions (around line 30):

```typescript
const editorScrollLine = useDocumentStore((s) => s.editorScrollLine);
```

- [ ] **Step 2: Add scroll sync useEffect**

Add a new useEffect after the heading scroll effect (around line 73):

```typescript
// Sync preview scroll with editor scroll position
useEffect(() => {
  if (!editorScrollLine || !previewContainerRef.current) return;

  const container = previewContainerRef.current;
  const scrollableArea = container.querySelector('.overflow-auto') as HTMLElement;
  if (!scrollableArea) return;

  // Find the element at or near the editor's current line
  // Strategy: find closest element with data-source-line <= editorScrollLine
  const elements = container.querySelectorAll('[data-source-line]');
  let targetEl: Element | null = null;

  for (const el of elements) {
    const elLine = parseInt(el.getAttribute('data-source-line') || '0', 10);
    if (elLine <= editorScrollLine) {
      targetEl = el;
    } else {
      break; // Found first element beyond current line
    }
  }

  if (targetEl) {
    targetEl.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
}, [editorScrollLine]);
```

- [ ] **Step 3: Verify preview compiles**

Run: `cd apps/desktop && pnpm tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/workspace/preview/markdown-preview.tsx
git commit -m "feat: add scroll sync effect to markdown preview

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Feature 2: Image Display in Preview Area

### Task 5: Create ImagePreviewWrapper component

**Files:**
- Create: `apps/desktop/src/components/workspace/preview/image-preview-wrapper.tsx`

- [ ] **Step 1: Create the wrapper component file**

```typescript
import { useState } from "react";
import {
  MinusIcon,
  PlusIcon,
  FileTextIcon,
} from "lucide-react";
import { useDocumentStore } from "@/stores/document-store";
import { ImagePreview } from "@/components/workspace/editor/image-preview";
import { Button } from "@/components/ui/button";

export function ImagePreviewWrapper() {
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const files = useDocumentStore((s) => s.files);
  const activeFile = files.find((f) => f.id === activeFileId);

  const [scale, setScale] = useState(1.0);

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
        <ImagePreview
          file={activeFile}
          scale={scale}
          onScaleChange={setScale}
          cropMode={false}
          onCropModeChange={() => {}}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify component compiles**

Run: `cd apps/desktop && pnpm tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/workspace/preview/image-preview-wrapper.tsx
git commit -m "feat: create ImagePreviewWrapper component for preview panel

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Modify workspace-layout for image routing

**Files:**
- Modify: `apps/desktop/src/components/workspace/workspace-layout.tsx`

- [ ] **Step 1: Import ImageIcon and ImagePreviewWrapper**

Add imports at the top of the file:

```typescript
import { ImageIcon } from "lucide-react";
import { ImagePreviewWrapper } from "./preview/image-preview-wrapper";
```

- [ ] **Step 2: Add isImage check**

Find the `isMarkdown` variable (around line 17) and add:

```typescript
const isMarkdown = activeFile?.type === "md";
const isImage = activeFile?.type === "image";
```

- [ ] **Step 3: Modify editor panel rendering**

Find the editor panel (around line 45) and modify:

```typescript
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
```

- [ ] **Step 4: Modify preview panel rendering**

Find the preview panel (around line 51) and modify:

```typescript
<Panel defaultSize={42.5} minSize={25}>
  {isImage ? (
    <ImagePreviewWrapper />
  ) : isMarkdown ? (
    <MarkdownPreview />
  ) : (
    <PdfPreview />
  )}
</Panel>
```

- [ ] **Step 5: Verify layout compiles**

Run: `cd apps/desktop && pnpm tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/workspace/workspace-layout.tsx
git commit -m "feat: route image files to preview panel

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Remove ImagePreview from markdown-editor

**Files:**
- Modify: `apps/desktop/src/components/workspace/editor/markdown-editor.tsx`

- [ ] **Step 1: Remove ImagePreview import and usage**

Remove the import:

```typescript
// Remove this line
import { ImagePreview } from "./image-preview";
```

Remove the `imageScale` state and related effects (around line 174-191):

```typescript
// Remove: const [imageScale, setImageScale] = useState(1.0);
// Remove: useEffect for resetting scale on file switch
```

Remove the image rendering section (around line 645-654):

```typescript
// Remove this entire block
{isImage && activeFile && (
  <ImagePreview
    file={activeFile}
    scale={imageScale}
    onScaleChange={setImageScale}
    cropMode={false}
    onCropModeChange={() => {}}
  />
)}
```

Remove the `isImage` variable declaration (around line 526):

```typescript
// Remove: const isImage = !isTextFile && !isPdf && !!activeFile;
```

Update the conditional checks that used `isImage` - they should now check differently or be removed:

```typescript
// The isPdf variable stays (around line 525)
const isPdf = activeFile?.type === "pdf";
// Remove isImage, and update conditions to just check isPdf
```

- [ ] **Step 2: Verify editor still compiles**

Run: `cd apps/desktop && pnpm tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/workspace/editor/markdown-editor.tsx
git commit -m "refactor: remove ImagePreview from markdown editor (moved to preview)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Final Verification

### Task 8: Manual testing and final commit

- [ ] **Step 1: Start the Tauri app**

Run: `cd apps/desktop && PKG_CONFIG_PATH="/opt/homebrew/opt/icu4c@78/lib/pkgconfig" cargo tauri dev`

- [ ] **Step 2: Test scroll sync**

1. Create or open a Markdown file with multiple sections (e.g., `# Heading 1`, `## Heading 2`, paragraphs)
2. Scroll the editor slowly
3. Verify the preview scrolls to follow the editor position
4. Check that scrolling is responsive (no lag)

- [ ] **Step 3: Test image preview**

1. Import or create an image file (PNG, JPG)
2. Click on the image file in the sidebar
3. Verify: left panel shows "Image preview on the right" placeholder
4. Verify: right panel shows the image with zoom controls
5. Test zoom in/out buttons

- [ ] **Step 4: Create final integration commit if needed**

If all tests pass:

```bash
git status
# If there are uncommitted changes from testing/fixes
git add -A
git commit -m "feat: complete editor-preview sync implementation

- Editor scroll syncs to preview panel for Markdown files
- Image files now display in preview panel with zoom controls

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```