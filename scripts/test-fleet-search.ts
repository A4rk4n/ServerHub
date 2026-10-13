// F52 — fleet-wide search (v2.61.0).
// Pure core (query normalization, relevance scoring, highlight ranges,
// group ranking) plus pinned wiring for the /api/search route, the
// Suspense-wrapped search page, and the shell nav (BOTH highlight
// ternaries must know /search or the Servers item lights up instead).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GROUP_LIMITS,
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  bestScore,
  matchRange,
  normalizeQuery,
  rankGroup,
  scoreMatch,
  type SearchHit,
} from "../src/lib/fleet-search";

test("normalizeQuery trims, collapses, caps, and rejects too-short input", () => {
  assert.equal(normalizeQuery("  valheim  "), "valheim");
  assert.equal(normalizeQuery("two\t \n words"), "two words");
  assert.equal(normalizeQuery("a"), "", "one char is below the minimum");
  assert.equal(normalizeQuery("  a  "), "");
  assert.equal(normalizeQuery(null), "");
  assert.equal(normalizeQuery(42 as unknown as string), "");
  assert.equal(normalizeQuery("x".repeat(200)).length, MAX_QUERY_LENGTH);
  assert.equal(MIN_QUERY_LENGTH, 2);
});

test("scoreMatch ranks exact > prefix > word boundary > substring > none, case-insensitively", () => {
  assert.equal(scoreMatch("valheim", "Valheim"), 100);
  assert.equal(scoreMatch("val", "Valheim"), 80);
  assert.equal(scoreMatch("heim", "Val heim"), 60, "after a space is a word boundary");
  assert.equal(scoreMatch("heim", "backup-heim.tar"), 60, "after a dash is a word boundary");
  assert.equal(scoreMatch("heim", "Valheim"), 40, "mid-word is a plain substring");
  assert.equal(scoreMatch("zelda", "Valheim"), 0);
  assert.equal(scoreMatch("", "Valheim"), 0);
  assert.equal(scoreMatch("val", ""), 0);
  // bestScore picks the strongest field: the name beats the note.
  assert.equal(bestScore("steve", ["Steve", "note about steve-ish things"]), 100);
  assert.equal(bestScore("zelda", ["Steve", ""]), 0);
});

test("matchRange finds the first case-insensitive occurrence for highlighting", () => {
  assert.deepEqual(matchRange("heim", "Valheim"), [3, 7]);
  assert.deepEqual(matchRange("VAL", "valheim"), [0, 3]);
  assert.equal(matchRange("zelda", "Valheim"), null);
  assert.equal(matchRange("", "Valheim"), null);
});

test("rankGroup keeps matches, sorts by score then recency, and caps the group", () => {
  const hit = (id: number, score: number, at: number): SearchHit => ({
    type: "server", id, title: `t${id}`, subtitle: "", href: "/", score, at,
  });
  const ranked = rankGroup([hit(1, 40, 5), hit(2, 0, 9), hit(3, 80, 1), hit(4, 40, 7)], 10);
  assert.deepEqual(ranked.map((h) => h.id), [3, 4, 1], "score wins, then newer, misses dropped");
  const capped = rankGroup(Array.from({ length: 20 }, (_, i) => hit(i, 40, i)), 5);
  assert.equal(capped.length, 5);
  assert.equal(capped[0].id, 19, "the newest of equal scores survives the cap");
  assert.deepEqual(GROUP_LIMITS, { server: 5, player: 5, backup: 5, activity: 10 });
});

test("wiring is pinned: search route, Suspense page, and shell nav on both ternaries", () => {
  const route = readFileSync("src/app/api/search/route.ts", "utf8");
  assert.ok(route.includes("normalizeQuery(new URL(req.url).searchParams.get(\"q\"))"));
  assert.ok(route.includes(".limit(200)"), "activity is SQL-prefiltered and bounded");
  assert.ok(route.includes('replaceAll("%", "").replaceAll("_", "")'), "LIKE wildcards are stripped from user input");
  assert.ok(route.includes("GROUP_LIMITS.activity"));

  const page = readFileSync("src/app/search/page.tsx", "utf8");
  assert.ok(page.includes("<Suspense"), "useSearchParams requires a Suspense boundary");
  assert.ok(page.includes("<SearchView />"));

  const view = readFileSync("src/components/search-view.tsx", "utf8");
  assert.ok(view.includes("router.replace(`/search?q=${encodeURIComponent(q)}`)"), "the URL stays shareable");
  assert.ok(view.includes("useSearchParams"));
  assert.ok(!view.includes("window.location.href"), "internal navigation stays client-side");

  const shell = readFileSync("src/components/shell.tsx", "utf8");
  assert.ok(shell.includes('{ href: "/search", label: "Search", icon: Search }'));
  const branches = shell.split('n.href === "/search" ? pathname.startsWith("/search")').length - 1;
  assert.equal(branches, 2, "BOTH nav highlight ternaries must know /search");

  console.log("FLEET_SEARCH_SUITE_OK");
});
