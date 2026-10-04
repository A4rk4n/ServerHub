// Multi-hunk file diff for config history: compare the current file with a
// safety copy (`<file>.bak-YYYYMMDD-HHMMSS`) before restoring it. The
// config editor's diffLines() collapses everything between the first and
// last change into one blob; this module produces proper unified-diff
// hunks, each with its own line numbers and context, so three separate
// edits read as three separate changes. Client-portable: no node: imports.

export type DiffLine = { type: "ctx" | "del" | "add"; text: string };
export type DiffHunk = { aStart: number; bStart: number; lines: DiffLine[] };
export type FileDiff = {
  identical: boolean;
  added: number;
  removed: number;
  hunks: DiffHunk[];
  /** True when the files were too large for an exact diff and the changed middle is shown as one block. */
  truncated: boolean;
};

export const DIFF_CONTEXT = 3;
/** LCS table guard: beyond ~4M cells (2000×2000 changed lines) fall back to one block. */
const MAX_LCS_CELLS = 4_000_000;

type Op = { type: "ctx" | "del" | "add"; text: string };

/** Exact LCS edit script via dynamic programming (lengths already guarded). */
function editScript(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i:], b[j:]
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "ctx", text: a[i] });
      i++; j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      ops.push({ type: "del", text: a[i] });
      i++;
    } else {
      ops.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", text: a[i++] });
  while (j < m) ops.push({ type: "add", text: b[j++] });
  return ops;
}

/** Group an edit script into unified-diff hunks with `context` lines around changes. */
function buildHunks(ops: Op[], context: number, aOffset: number, bOffset: number): DiffHunk[] {
  // Mark which op indices are kept (changes plus surrounding context).
  const changed = ops.map((op) => op.type !== "ctx");
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let k = 0; k < ops.length; k++) {
    if (!changed[k]) continue;
    for (let c = Math.max(0, k - context); c <= Math.min(ops.length - 1, k + context); c++) keep[c] = true;
  }
  const hunks: DiffHunk[] = [];
  let aLine = aOffset;
  let bLine = bOffset;
  let current: DiffHunk | null = null;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (keep[k]) {
      if (!current) {
        current = { aStart: aLine, bStart: bLine, lines: [] };
        hunks.push(current);
      }
      current.lines.push({ type: op.type, text: op.text });
    } else {
      current = null;
    }
    if (op.type !== "add") aLine++;
    if (op.type !== "del") bLine++;
  }
  return hunks;
}

/** Diff `before` → `after` into unified hunks. 1-based line numbers. */
export function diffFiles(before: string, after: string, context = DIFF_CONTEXT): FileDiff {
  if (before === after) return { identical: true, added: 0, removed: 0, hunks: [], truncated: false };
  const a = before.split("\n");
  const b = after.split("\n");
  // Trim the common prefix/suffix first: it is free and shrinks the LCS table.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);

  let ops: Op[];
  let truncated = false;
  if ((aMid.length + 1) * (bMid.length + 1) > MAX_LCS_CELLS) {
    // Too large for an exact diff: present the whole changed middle as one block.
    truncated = true;
    ops = [...aMid.map((text): Op => ({ type: "del", text })), ...bMid.map((text): Op => ({ type: "add", text }))];
  } else {
    ops = editScript(aMid, bMid);
  }
  // Re-attach up to `context` lines of the trimmed prefix/suffix as context.
  const leadIn = a.slice(Math.max(0, prefix - context), prefix).map((text): Op => ({ type: "ctx", text }));
  const leadOut = a.slice(a.length - suffix, Math.min(a.length, a.length - suffix + context)).map((text): Op => ({ type: "ctx", text }));
  const full = [...leadIn, ...ops, ...leadOut];
  const aOffset = prefix - leadIn.length + 1;
  const bOffset = prefix - leadIn.length + 1;
  const hunks = buildHunks(full, context, aOffset, bOffset);
  return {
    identical: false,
    added: ops.filter((op) => op.type === "add").length,
    removed: ops.filter((op) => op.type === "del").length,
    hunks,
    truncated,
  };
}

// ---- safety-copy helpers ---------------------------------------------------

const STAMP_RE = /\.bak-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

/** The local-time Date encoded in a safety-copy name, or null. */
export function parseSafetyStamp(name: string): Date | null {
  const match = STAMP_RE.exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as unknown as number[];
  const date = new Date(y, mo - 1, d, h, mi, s);
  // Reject impossible dates (month 13, minute 61) that re-normalize.
  if (date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) return null;
  return date;
}

export type SafetyCopyRef = { path: string; stamp: Date };

/** Safety copies of `filePath` among `allPaths`, newest first. */
export function safetyCopiesFor(filePath: string, allPaths: string[]): SafetyCopyRef[] {
  if (STAMP_RE.test(filePath)) return []; // a copy has no copies of its own
  const copies: SafetyCopyRef[] = [];
  for (const candidate of allPaths) {
    if (!candidate.startsWith(`${filePath}.bak-`)) continue;
    const stamp = parseSafetyStamp(candidate);
    if (stamp) copies.push({ path: candidate, stamp });
  }
  return copies.sort((x, y) => y.stamp.getTime() - x.stamp.getTime());
}

/** The original file a safety copy belongs to, or null when not a copy. */
export function safetyCopyOriginal(filePath: string): string | null {
  return STAMP_RE.test(filePath) ? filePath.replace(STAMP_RE, "") : null;
}
