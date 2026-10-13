import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SAFETY_COPIES,
  detectConfigFormat,
  diffLines,
  isSafetyCopy,
  safetyCopyName,
  validateConfig,
} from "../src/lib/config-editor";

test("config editor: format detection by extension", () => {
  assert.equal(detectConfigFormat("server.properties"), "properties");
  assert.equal(detectConfigFormat("config/paper-global.yml"), "yaml");
  assert.equal(detectConfigFormat("plugins/Essentials/CONFIG.YAML"), "yaml");
  assert.equal(detectConfigFormat("PalWorldSettings.toml"), "toml");
  assert.equal(detectConfigFormat("ops.json"), "json");
  assert.equal(detectConfigFormat("whitelist.json.bak-20261001-101500"), "json"); // safety copies keep their format
  assert.equal(detectConfigFormat("server.jar"), null);
  assert.equal(detectConfigFormat("eula.txt"), null);
  assert.equal(detectConfigFormat("noextension"), null);
});

test("config editor: json and properties validation", () => {
  assert.deepEqual(validateConfig("json", '{"a": 1, "b": [true, null]}'), { ok: true });
  const badJson = validateConfig("json", '{\n  "a": 1,\n  "b": \n}');
  assert.equal(badJson.ok, false);
  if (!badJson.ok) {
    assert.ok(badJson.message.length > 0);
    assert.ok(badJson.line === null || badJson.line >= 3, `expected line >= 3, got ${badJson.line}`);
  }
  const emptyJson = validateConfig("json", "  \n ");
  assert.equal(emptyJson.ok, false);

  assert.deepEqual(validateConfig("properties", "# comment\nmotd=Hello world\nmax-players=20\n\npvp=true"), { ok: true });
  assert.deepEqual(validateConfig("properties", "key-with-no-value\n"), { ok: true }); // legal in java properties
  const badProps = validateConfig("properties", "motd=ok\n=orphan value");
  assert.equal(badProps.ok, false);
  if (!badProps.ok) assert.equal(badProps.line, 2);
  // backslash continuation: the continued line is not validated as a key
  assert.deepEqual(validateConfig("properties", "list=a,\\\n  =not-a-key-here"), { ok: true });
});

test("config editor: yaml and toml validation", () => {
  assert.deepEqual(validateConfig("yaml", "settings:\n  motd: 'Hello'\n  flags:\n    - one\n    - two\n"), { ok: true });
  const tabbed = validateConfig("yaml", "settings:\n\tmotd: hi");
  assert.equal(tabbed.ok, false);
  if (!tabbed.ok) {
    assert.equal(tabbed.line, 2);
    assert.match(tabbed.message, /tab/i);
  }
  const unclosed = validateConfig("yaml", 'motd: "no closing quote\nnext: 1');
  assert.equal(unclosed.ok, false);
  if (!unclosed.ok) assert.equal(unclosed.line, 1);
  // block scalars may contain anything deeper-indented, even quotes and tabs
  assert.deepEqual(validateConfig("yaml", 'script: |\n  echo "unterminated\n  \traw tab\nafter: ok'), { ok: true });

  assert.deepEqual(validateConfig("toml", '# comment\n[server]\nname = "alpha"\n[[mods]]\nid = 7\n'), { ok: true });
  const badToml = validateConfig("toml", "[server]\njust some words");
  assert.equal(badToml.ok, false);
  if (!badToml.ok) assert.equal(badToml.line, 2);
  const badHeader = validateConfig("toml", "[server\nname = 1");
  assert.equal(badHeader.ok, false);
  const multi = validateConfig("toml", 'text = """\nanything [here] goes\n"""\nnext = 1');
  assert.deepEqual(multi, { ok: true });
  const openMulti = validateConfig("toml", 'text = """\nnever closed');
  assert.equal(openMulti.ok, false);
});

test("config editor: diff preview trims common prefix and suffix", () => {
  const same = diffLines("a\nb\nc", "a\nb\nc");
  assert.equal(same.changed, false);
  assert.equal(same.added + same.removed, 0);

  const before = ["# head", "one", "two", "three", "four", "five", "# tail"].join("\n");
  const after = ["# head", "one", "two", "TWO-POINT-FIVE", "three", "four", "five", "# tail"].join("\n");
  const add = diffLines(before, after);
  assert.equal(add.changed, true);
  assert.equal(add.added, 1);
  assert.equal(add.removed, 0);
  assert.equal(add.start, 4);
  assert.deepEqual(add.addedLines, ["TWO-POINT-FIVE"]);
  assert.deepEqual(add.contextBefore, ["# head", "one", "two"]);
  assert.deepEqual(add.contextAfter, ["three", "four", "five"]);

  const change = diffLines("max-players=20\npvp=true", "max-players=40\npvp=true");
  assert.equal(change.added, 1);
  assert.equal(change.removed, 1);
  assert.deepEqual(change.removedLines, ["max-players=20"]);
  assert.deepEqual(change.addedLines, ["max-players=40"]);
  assert.equal(change.start, 1);
});

test("config editor: safety copy naming round-trip", () => {
  const stamp = new Date(2026, 9, 1, 9, 5, 7); // 2026-10-01 09:05:07 local
  const name = safetyCopyName("config/server.properties", stamp);
  assert.equal(name, "config/server.properties.bak-20261001-090507");
  assert.equal(isSafetyCopy(name), true);
  assert.equal(isSafetyCopy("server.properties"), false);
  assert.equal(isSafetyCopy("archive.bak-notadate"), false);
  assert.equal(detectConfigFormat(name), "properties");
  assert.ok(MAX_SAFETY_COPIES >= 3, "keep a sensible number of safety copies");
  console.log("CONFIG_EDITOR_SUITE_OK");
});
