// Unit suite for the Markdown relative-link and anchor checker
// (scripts/check-docs.mjs). Uses only temp directories so parallel test
// files never collide.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  checkDocs,
  collectMarkdownFiles,
  extractLinks,
  headingSlugs,
  slugify,
  stripCode,
} from "./check-docs.mjs";

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "docs-check-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

test("slugify follows GitHub conventions", () => {
  assert.equal(slugify("Windows smoke-test signoff"), "windows-smoke-test-signoff");
  assert.equal(slugify("Build (automated, per commit)"), "build-automated-per-commit");
  assert.equal(slugify("[2.13.0] - 2026-09-30"), "2130---2026-09-30");
  assert.equal(slugify("Rollback & superseded artifacts"), "rollback--superseded-artifacts");
  assert.equal(slugify("under_score kept"), "under_score-kept");
});

test("headingSlugs deduplicates repeated headings with numeric suffixes", () => {
  const slugs = headingSlugs("# Setup\n\n## Setup\n\ntext\n\n### Other\n");
  assert.ok(slugs.has("setup"));
  assert.ok(slugs.has("setup-1"));
  assert.ok(slugs.has("other"));
});

test("stripCode removes fenced blocks and inline code but keeps line numbers", () => {
  const doc = "before\n```md\n[gone](missing.md)\n```\nafter `[gone](x.md)` tail\n";
  const stripped = stripCode(doc);
  assert.equal(stripped.split("\n").length, doc.split("\n").length);
  assert.ok(!stripped.includes("missing.md"));
  assert.ok(!stripped.includes("x.md"));
  assert.ok(stripped.includes("after"));
});

test("extractLinks finds inline links, images, and reference definitions", () => {
  const links = extractLinks(
    "[a](one.md) ![img](pic.png)\n[ref]: two.md\n[b](three.md#frag)\n"
  );
  const targets = links.map((l) => l.target);
  assert.deepEqual(targets, ["one.md", "pic.png", "two.md", "three.md#frag"]);
  assert.equal(links[0].line, 1);
  assert.equal(links[3].line, 3);
});

test("collectMarkdownFiles skips generated directories", () => {
  const root = makeRepo({
    "README.md": "# Hi\n",
    "docs/guide.md": "# Guide\n",
    "node_modules/pkg/README.md": "# Ignored\n",
    "build/out.md": "# Ignored\n",
  });
  try {
    const rels = collectMarkdownFiles(root).map((f) => path.relative(root, f));
    assert.deepEqual(rels.sort(), ["README.md", path.join("docs", "guide.md")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkDocs passes a repository with valid links and anchors", () => {
  const root = makeRepo({
    "README.md":
      "# Top\n\n## Deep Dive\n\n[self](#deep-dive)\n[guide](docs/guide.md#setup-steps)\n[dir](docs/)\n[ext](https://example.com/x.md)\n[line](docs/guide.md#L3)\n",
    "docs/guide.md": "# Guide\n\n## Setup Steps\n\n[back](../README.md)\n",
  });
  try {
    assert.deepEqual(checkDocs(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkDocs reports missing files, bad anchors, and directory anchors", () => {
  const root = makeRepo({
    "README.md":
      "# Top\n\n[gone](missing.md)\n[bad](docs/guide.md#nope)\n[dir](docs/#frag)\n[badself](#absent)\n",
    "docs/guide.md": "# Guide\n",
  });
  try {
    const problems = checkDocs(root);
    const reasons = problems.map((p) => `${p.target}:${p.reason}`).sort();
    assert.deepEqual(reasons, [
      "#absent:anchor not found in target",
      "docs/#frag:anchor on a directory link",
      "docs/guide.md#nope:anchor not found in target",
      "missing.md:target does not exist",
    ]);
    for (const p of problems) {
      assert.equal(p.file, "README.md");
      assert.ok(p.line > 0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkDocs ignores links inside fenced code blocks", () => {
  const root = makeRepo({
    "README.md": "# Top\n\n```\n[gone](missing.md)\n```\n",
  });
  try {
    assert.deepEqual(checkDocs(root), []);
    console.log("DOCS_CHECK_SUITE_OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
