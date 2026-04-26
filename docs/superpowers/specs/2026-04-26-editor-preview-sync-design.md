# Editor-Preview Sync Design

## Overview

Two features for the ClaudePrism desktop application:

1. **Editor scroll sync to preview** - When scrolling the Markdown editor, the preview panel synchronizes to show the corresponding content position
2. **Image display in preview area** - When clicking an image file, show it in the preview panel (right side) instead of the editor panel

## Feature 1: Editor Scroll Sync

### Flow

```
Editor scroll → Calculate first visible line number → Update store → Preview listens → Find corresponding element → Scroll to element
```

### Implementation

#### 1.1 document-store.ts

Add new state:

```typescript
// New state
editorScrollLine: number | null;  // First visible line number in editor
setEditorScrollLine: (line: number) => void;
```

#### 1.2 markdown-editor.tsx

Add scroll listener to EditorView:

```typescript
// In editor setup useEffect, add scroll listener
view.scrollDOM.addEventListener('scroll', () => {
  const scrollTop = view.scrollDOM.scrollTop;
  // Calculate document position from scrollTop
  const pos = view.posAtHeight(scrollTop, 'top');
  // Get line number at that position
  const line = view.state.doc.lineAt(pos).number;
  // Update store
  useDocumentStore.getState().setEditorScrollLine(line);
});
```

#### 1.3 markdown-preview.tsx

Listen to scroll line changes and sync:

```typescript
// Subscribe to editorScrollLine from store
const editorScrollLine = useDocumentStore((s) => s.editorScrollLine);

// Effect to sync scroll
useEffect(() => {
  if (!editorScrollLine || !previewContainerRef.current) return;
  
  // Find element corresponding to line number
  // Strategy: react-markdown elements have data-source-line attribute
  const targetEl = previewContainerRef.current.querySelector(`[data-source-line="${editorScrollLine}"]`);
  
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
}, [editorScrollLine]);
```

#### 1.4 MarkdownRenderer - Add line number attributes

Modify `markdown-renderer.tsx` to add `data-source-line` to each element:

```typescript
// Custom component wrapper that adds data-source-line
components={{
  p({ node, children }) {
    const line = node?.position?.start?.line;
    return <p data-source-line={line}>{children}</p>;
  },
  h1, h2, h3, h4, h5, h6({ node, children, level }) {
    const line = node?.position?.start?.line;
    return <h1 data-source-line={line}>{children}</h1>; // etc.
  },
  // ... other elements
}}
```

### Edge Cases

- Short documents: preview may scroll less than editor
- Large documents: ensure scroll is responsive (use 'instant' behavior, not 'smooth')
- Image/embed content: these don't have line numbers, skip sync

---

## Feature 2: Image Display in Preview Area

### Current Behavior

- Image file clicked → shows in **editor panel** (left) using `ImagePreview` component
- Preview panel shows "Select a Markdown file to preview"

### New Behavior

- Image file clicked → editor panel shows placeholder text, preview panel shows `ImagePreview`

### Implementation

#### 2.1 workspace-layout.tsx

Modify rendering logic:

```typescript
// Before
const isMarkdown = activeFile?.type === "md";

// After
const isMarkdown = activeFile?.type === "md";
const isImage = activeFile?.type === "image";

// Editor panel
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

// Preview panel
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

#### 2.2 ImagePreviewWrapper (new component)

Create wrapper component that gets the active image file from store:

```typescript
function ImagePreviewWrapper() {
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const files = useDocumentStore((s) => s.files);
  const activeFile = files.find((f) => f.id === activeFileId);
  
  const [scale, setScale] = useState(1.0);
  
  if (!activeFile || activeFile.type !== "image") {
    return <EmptyState />;
  }
  
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar with zoom controls */}
      <div className="flex h-[calc(40px+var(--titlebar-height))] items-center border-b px-2 pt-[var(--titlebar-height)]">
        {/* Zoom in/out buttons */}
      </div>
      <ImagePreview
        file={activeFile}
        scale={scale}
        onScaleChange={setScale}
        cropMode={false}
        onCropModeChange={() => {}}
      />
    </div>
  );
}
```

#### 2.3 Remove ImagePreview from markdown-editor.tsx

Current `markdown-editor.tsx` renders `ImagePreview` for image files. Remove this logic:

```typescript
// Remove this section
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

---

## Files to Modify

| File | Changes |
|------|---------|
| `stores/document-store.ts` | Add `editorScrollLine` state |
| `components/workspace/editor/markdown-editor.tsx` | Add scroll listener, remove ImagePreview |
| `components/workspace/preview/markdown-preview.tsx` | Add scroll sync effect |
| `components/claude-chat/markdown-renderer.tsx` | Add `data-source-line` attributes |
| `components/workspace/workspace-layout.tsx` | Add isImage rendering logic |
| `components/workspace/preview/image-preview-wrapper.tsx` | New file |

---

## Testing

1. **Scroll sync**:
   - Open a Markdown file with multiple sections
   - Scroll editor, verify preview follows
   - Check performance (no lag)

2. **Image preview**:
   - Click on an image file in sidebar
   - Verify: left panel shows placeholder, right panel shows image
   - Verify zoom controls work in preview panel