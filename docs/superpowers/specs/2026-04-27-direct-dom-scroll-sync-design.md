# 直接 DOM 操作的滚动同步设计文档

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 消除编辑器-预览滚动同步的顿挫感，通过直接 DOM 操作绕过 React 重渲染。

**Architecture:** 通过共享 ref 让编辑器组件直接操作预览容器的 scrollTop，完全避免 Zustand 状态更新和 React 重渲染。

**Tech Stack:** React refs, requestAnimationFrame, CodeMirror scroll events

---

## 问题分析

### 当前流程的性能瓶颈

```
编辑器滚动 → Zustand setState → React 重渲染 → MarkdownRenderer 重新解析 → 预览滚动
```

每次滚动事件都会触发：
1. Zustand 状态更新 (`editorScrollProgress`)
2. MarkdownPreview 组件重渲染
3. MarkdownRenderer 重新执行 remark/rehype 解析（昂贵）
4. React diff 和 DOM 更新

### 根本原因

滚动同步不应该触发 React 重渲染。MarkdownRenderer 的 markdown 解析是 CPU 密集操作，在每帧滚动时执行会造成明显卡顿。

---

## 新架构

```
MarkdownEditor                          MarkdownPreview
     │                                       │
     │  previewScrollRef (从父组件传入)       │
     │                                       │
     ├─► scroll事件 ─► RAF节流 ─► 直接设置    │
     │                      previewScrollRef │
     │                      .scrollTop       │
     │                      (无React更新)    │
```

**核心改变：** 滚动同步完全在 DOM 层面完成，不经过 React 状态系统。

---

## 文件修改

| 文件 | 操作 | 说明 |
|------|------|------|
| `document-store.ts` | 修改 | 移除 `editorScrollProgress` 状态和相关方法 |
| `markdown-editor.tsx` | 修改 | 接收 `previewScrollRef` prop，直接操作 DOM |
| `markdown-preview.tsx` | 修改 | 移除滚动同步 useEffect，暴露滚动容器 ref |
| `workspace-layout.tsx` | 修改 | 创建共享 ref 并传递给编辑器和预览组件 |

---

## 实现细节

### 1. WorkspaceLayout 创建共享 ref

```typescript
// workspace-layout.tsx
const previewScrollRef = useRef<HTMLDivElement | null>(null);

// 传递给编辑器和预览
<MarkdownEditor previewScrollRef={previewScrollRef} />
<MarkdownPreview scrollContainerRef={previewScrollRef} />
```

### 2. MarkdownEditor 直接操作 DOM

```typescript
// markdown-editor.tsx
interface MarkdownEditorProps {
  previewScrollRef?: RefObject<HTMLDivElement | null>;
}

// 滚动事件处理
const handleScroll = () => {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    const view = viewRef.current;
    if (!view) return;
    
    // 计算滚动比例
    const scrollDOM = view.scrollDOM;
    const progress = scrollDOM.scrollHeight > scrollDOM.clientHeight
      ? scrollDOM.scrollTop / (scrollDOM.scrollHeight - scrollDOM.clientHeight)
      : 0;
    
    // 直接设置预览滚动位置（关键：不触发 React）
    if (previewScrollRef?.current) {
      const previewEl = previewScrollRef.current;
      const previewHeight = previewEl.scrollHeight - previewEl.clientHeight;
      previewEl.scrollTop = progress * previewHeight;
    }
  });
};
```

### 3. MarkdownPreview 暴露 ref

```typescript
// markdown-preview.tsx
interface MarkdownPreviewProps {
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}

// 在渲染时将 ref 绑定到滚动容器
<div ref={(el) => {
  // 合并内部 ref 和外部传入的 ref
  previewContainerRef.current = el;
  if (scrollContainerRef) {
    scrollContainerRef.current = el?.querySelector('.overflow-auto') as HTMLDivElement;
  }
}} ...>
```

### 4. 移除 Zustand 状态

```typescript
// document-store.ts - 删除以下内容
// State:
editorScrollProgress: number | null;

// Actions:
setEditorScrollProgress: (progress: number) => void;
```

---

## 保留的功能

**大纲跳转功能** (`scrollToHeading`) 保持使用 Zustand：
- 这是一次性操作，不会在滚动过程中频繁触发
- 需要 React 响应来执行 `scrollIntoView`
- 性能影响可忽略

---

## 验收标准

1. 编辑器滚动时预览同步跟随，无明显顿挫感
2. 不再触发 MarkdownRenderer 的重渲染（可通过 console.log 验证）
3. 大纲点击跳转功能正常工作
4. 切换文件后滚动同步正常工作
5. TypeScript 编译无错误