#!/usr/bin/env node
// Markdown relative-link and anchor checker.
//
// Validates every tracked-style Markdown file in the repository:
//   - relative file and directory links resolve to existing paths
//   - fragment links (`#anchor`) resolve to a real heading slug in the
//     target Markdown file, using GitHub's slug algorithm including
//     duplicate-heading suffixes
//   - line-number fragments (`#L10`, `#L10-L20`) are accepted on any file
//
// External links (http:, https:, mailto:) are ignored. Links inside fenced
// code blocks and inline code spans are ignored. The script has no
// dependencies and doubles as a library for the unit suite
// (scripts/test-docs-check.ts).

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "build",
  "release",
  ".next",
  "out",
  "coverage",
  "smoke",
]);

/** Recursively collect Markdown files under root, skipping generated dirs. */
export function collectMarkdownFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root);
  return files.sort();
}

/** Remove fenced code blocks and inline code spans, preserving line count. */
export function stripCode(markdown) {
  const lines = markdown.split("\n");
  const result = [];
  let fence = null;
  for (const line of lines) {
    const open = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      result.push("");
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (open) {
      fence = open[1];
      result.push("");
      continue;
    }
    result.push(line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length)));
  }
  return result.join("\n");
}

/**
 * Extract link targets from Markdown (inline links/images and reference
 * definitions). Returns [{ target, line }].
 */
export function extractLinks(markdown) {
  const links = [];
  const text = stripCode(markdown);
  const lines = text.split("\n");
  const inline = /!?\[[^\]]*\]\(([^()\s]+(?:\([^()]*\)[^()\s]*)*)(?:\s+"[^"]*")?\)/g;
  const refDef = /^\s{0,3}\[[^\]]+\]:\s+(\S+)/;
  lines.forEach((line, index) => {
    for (const match of line.matchAll(inline)) {
      links.push({ target: match[1], line: index + 1 });
    }
    const def = line.match(refDef);
    if (def) links.push({ target: def[1], line: index + 1 });
  });
  return links;
}

/** GitHub-style heading slug. */
export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    // strip markdown links but keep their text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    // drop everything that is not a word character, space, or hyphen
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "")
    .replace(/ /g, "-");
}

/** All heading anchor slugs of a Markdown document, with duplicate suffixes. */
export function headingSlugs(markdown) {
  const slugs = new Set();
  const seen = new Map();
  for (const line of stripCode(markdown).split("\n")) {
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!match) continue;
    const base = slugify(match[2]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

const isExternal = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target);
const isLineAnchor = (fragment) => /^L\d+(?:-L\d+)?$/.test(fragment);

/**
 * Check all Markdown files under root. Returns an array of problem
 * objects: { file, line, target, reason }.
 */
export function checkDocs(root) {
  const problems = [];
  const slugCache = new Map();
  const slugsFor = (file) => {
    if (!slugCache.has(file)) {
      slugCache.set(file, headingSlugs(readFileSync(file, "utf8")));
    }
    return slugCache.get(file);
  };

  for (const file of collectMarkdownFiles(root)) {
    const relFile = path.relative(root, file);
    const markdown = readFileSync(file, "utf8");
    for (const { target, line } of extractLinks(markdown)) {
      if (isExternal(target)) continue;
      const hashIndex = target.indexOf("#");
      const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
      const fragment = hashIndex === -1 ? "" : target.slice(hashIndex + 1);
      const decodedPath = decodeURIComponent(rawPath);

      let resolved;
      if (decodedPath === "") {
        resolved = file; // fragment-only link into the same document
      } else if (decodedPath.startsWith("/")) {
        resolved = path.join(root, decodedPath);
      } else {
        resolved = path.resolve(path.dirname(file), decodedPath);
      }

      if (!existsSync(resolved)) {
        problems.push({
          file: relFile,
          line,
          target,
          reason: "target does not exist",
        });
        continue;
      }
      if (fragment === "") continue;
      if (isLineAnchor(fragment)) continue;
      if (statSync(resolved).isDirectory()) {
        problems.push({
          file: relFile,
          line,
          target,
          reason: "anchor on a directory link",
        });
        continue;
      }
      if (!resolved.toLowerCase().endsWith(".md")) continue;
      if (!slugsFor(resolved).has(fragment.toLowerCase())) {
        problems.push({
          file: relFile,
          line,
          target,
          reason: "anchor not found in target",
        });
      }
    }
  }
  return problems;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const root = path.resolve(process.argv[2] ?? ".");
  const problems = checkDocs(root);
  if (problems.length > 0) {
    for (const p of problems) {
      console.error(`${p.file}:${p.line}: broken link "${p.target}" (${p.reason})`);
    }
    console.error(`\n${problems.length} broken Markdown link(s).`);
    process.exit(1);
  }
  console.log("DOCS_LINK_CHECK_OK");
}
