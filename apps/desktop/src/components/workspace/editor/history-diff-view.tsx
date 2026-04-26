import { type FileDiff } from "@/stores/history-store";

// ─── History Diff View (git-diff style combined view) ───

export function HistoryDiffView({ diffs }: { diffs: FileDiff[] }) {
  return (
    <div className="absolute inset-0 overflow-y-auto bg-background font-mono text-xs leading-relaxed">
      {diffs.map((diff) => (
        <div key={diff.file_path} className="border-border border-b">
          {/* File header */}
          <div className="sticky top-0 z-10 flex items-center gap-2 border-border border-b bg-muted/80 px-4 py-1.5 backdrop-blur-sm">
            <span
              className={
                diff.status === "added"
                  ? "font-bold text-green-600 dark:text-green-400"
                  : diff.status === "deleted"
                    ? "font-bold text-red-600 dark:text-red-400"
                    : "font-bold text-blue-600 dark:text-blue-400"
              }
            >
              {diff.status === "added"
                ? "+"
                : diff.status === "deleted"
                  ? "−"
                  : "~"}
            </span>
            <span className="font-medium text-foreground">
              {diff.file_path}
            </span>
            <span className="text-muted-foreground">({diff.status})</span>
          </div>
          {/* Diff lines */}
          <DiffLines diff={diff} />
        </div>
      ))}
      {diffs.length === 0 && (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          No changes in this snapshot
        </div>
      )}
    </div>
  );
}

function DiffLines({ diff }: { diff: FileDiff }) {
  const oldLines = diff.old_content?.split("\n") ?? [];
  const newLines = diff.new_content?.split("\n") ?? [];

  if (diff.status === "added") {
    return (
      <div className="px-1">
        {newLines.map((line, i) => (
          <div key={i} className="flex bg-green-500/10">
            <span className="w-12 shrink-0 select-none pr-2 text-right text-green-500/50">
              {i + 1}
            </span>
            <span className="mr-1 select-none text-green-500/50">+</span>
            <span className="text-green-700 dark:text-green-400">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (diff.status === "deleted") {
    return (
      <div className="px-1">
        {oldLines.map((line, i) => (
          <div key={i} className="flex bg-red-500/10">
            <span className="w-12 shrink-0 select-none pr-2 text-right text-red-500/50">
              {i + 1}
            </span>
            <span className="mr-1 select-none text-red-500/50">−</span>
            <span className="text-red-700 dark:text-red-400">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Modified: compute unified diff with context
  const hunks = computeUnifiedHunks(oldLines, newLines, 3);

  return (
    <div className="px-1">
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          {/* Hunk header */}
          <div className="bg-blue-500/10 px-1 text-blue-600 dark:text-blue-400">
            @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount}{" "}
            @@
          </div>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              className={
                line.type === "del"
                  ? "flex bg-red-500/10"
                  : line.type === "add"
                    ? "flex bg-green-500/10"
                    : "flex"
              }
            >
              <span
                className={`w-12 shrink-0 select-none pr-2 text-right ${
                  line.type === "del"
                    ? "text-red-500/50"
                    : line.type === "add"
                      ? "text-green-500/50"
                      : "text-muted-foreground/50"
                }`}
              >
                {line.type !== "add" ? line.oldNum : ""}
              </span>
              <span
                className={`w-12 shrink-0 select-none pr-2 text-right ${
                  line.type === "del"
                    ? "text-red-500/50"
                    : line.type === "add"
                      ? "text-green-500/50"
                      : "text-muted-foreground/50"
                }`}
              >
                {line.type !== "del" ? line.newNum : ""}
              </span>
              <span
                className={`mr-1 select-none ${
                  line.type === "del"
                    ? "text-red-500/50"
                    : line.type === "add"
                      ? "text-green-500/50"
                      : "text-muted-foreground/30"
                }`}
              >
                {line.type === "del" ? "−" : line.type === "add" ? "+" : " "}
              </span>
              <span
                className={
                  line.type === "del"
                    ? "text-red-700 dark:text-red-400"
                    : line.type === "add"
                      ? "text-green-700 dark:text-green-400"
                      : "text-muted-foreground"
                }
              >
                {line.text || " "}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface DiffLine {
  type: "ctx" | "del" | "add";
  text: string;
  oldNum?: number;
  newNum?: number;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

function computeUnifiedHunks(
  oldLines: string[],
  newLines: string[],
  context: number,
): Hunk[] {
  // Simple line-by-line diff to find changed regions
  const ops: {
    type: "eq" | "del" | "add";
    oldIdx?: number;
    newIdx?: number;
    text: string;
  }[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (
      i < oldLines.length &&
      j < newLines.length &&
      oldLines[i] === newLines[j]
    ) {
      ops.push({ type: "eq", oldIdx: i, newIdx: j, text: oldLines[i] });
      i++;
      j++;
    } else {
      // Find the next matching line
      let foundOld = -1;
      let foundNew = -1;
      const searchLimit = Math.min(
        50,
        Math.max(oldLines.length - i, newLines.length - j),
      );
      for (let look = 1; look <= searchLimit; look++) {
        if (
          i + look < oldLines.length &&
          j < newLines.length &&
          oldLines[i + look] === newLines[j]
        ) {
          foundOld = i + look;
          break;
        }
        if (
          j + look < newLines.length &&
          i < oldLines.length &&
          newLines[j + look] === oldLines[i]
        ) {
          foundNew = j + look;
          break;
        }
      }

      if (foundOld >= 0) {
        // Delete lines from old until match
        while (i < foundOld) {
          ops.push({ type: "del", oldIdx: i, text: oldLines[i] });
          i++;
        }
      } else if (foundNew >= 0) {
        // Add lines from new until match
        while (j < foundNew) {
          ops.push({ type: "add", newIdx: j, text: newLines[j] });
          j++;
        }
      } else {
        // No match found nearby, emit del+add
        if (i < oldLines.length) {
          ops.push({ type: "del", oldIdx: i, text: oldLines[i] });
          i++;
        }
        if (j < newLines.length) {
          ops.push({ type: "add", newIdx: j, text: newLines[j] });
          j++;
        }
      }
    }
  }

  // Group into hunks with context lines
  const changedIndices = new Set<number>();
  ops.forEach((op, idx) => {
    if (op.type !== "eq") {
      for (
        let c = Math.max(0, idx - context);
        c <= Math.min(ops.length - 1, idx + context);
        c++
      ) {
        changedIndices.add(c);
      }
    }
  });

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (let idx = 0; idx < ops.length; idx++) {
    if (!changedIndices.has(idx)) {
      if (currentHunk) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
      continue;
    }

    const op = ops[idx];
    if (!currentHunk) {
      const oldStart =
        op.type !== "add"
          ? (op.oldIdx ?? 0) + 1
          : (ops[idx + 1]?.oldIdx ?? 0) + 1;
      const newStart =
        op.type !== "del"
          ? (op.newIdx ?? 0) + 1
          : (ops[idx + 1]?.newIdx ?? 0) + 1;
      currentHunk = { oldStart, oldCount: 0, newStart, newCount: 0, lines: [] };
    }

    if (op.type === "eq") {
      currentHunk.lines.push({
        type: "ctx",
        text: op.text,
        oldNum: (op.oldIdx ?? 0) + 1,
        newNum: (op.newIdx ?? 0) + 1,
      });
      currentHunk.oldCount++;
      currentHunk.newCount++;
    } else if (op.type === "del") {
      currentHunk.lines.push({
        type: "del",
        text: op.text,
        oldNum: (op.oldIdx ?? 0) + 1,
      });
      currentHunk.oldCount++;
    } else {
      currentHunk.lines.push({
        type: "add",
        text: op.text,
        newNum: (op.newIdx ?? 0) + 1,
      });
      currentHunk.newCount++;
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  return hunks;
}
