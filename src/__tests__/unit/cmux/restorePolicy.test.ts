/**
 * cmux's restore policy: the JSONC scanner, the reading, and the three edits — each held to "reads off, and the
 * token stream moved by exactly the intended run". Fixtures are in the shape of a real `cmux.json`: whole-line
 * comments, nested objects, a URL holding `//` inside a string, braces inside strings and comments, a block
 * comment, a commented-out template carrying the same key.
 */
import { describe, expect, it } from "vitest";

import { planRestorePolicyOff, type RestorePolicyPlan, readRestorePolicy } from "../../../cmux/restorePolicy.js";
import { restorePolicyComment } from "../../../cmux/restorePolicyEdits.js";
import { scanJsonc } from "../../../cmux/restorePolicyJsonc.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const NOW = "2026-10-11T03:04:05.000Z";
const COMMENT = restorePolicyComment({ nowIso: NOW });

/** A real file's shape, with no policy key anywhere live — only inside the commented-out template. */
const ABSENT_KEY = [
  "{",
  '  "$schema": "https://raw.githubusercontent.com/manaflow-ai/cmux/main/web/data/cmux.schema.json",',
  "",
  '  // #1 — a comment with a { brace } and a "quote" in it.',
  '  "app": {',
  '    "title": "braces { } and // slashes inside a string",',
  '    "escaped": "a \\"quoted\\" word",',
  "    /* a block comment with } inside */",
  '    "globalFontMagnification": 90',
  "  },",
  "",
  '  "terminal": {',
  "    // 23 Aug 2026 — pinned OFF.",
  '    "agentHibernation": {',
  '      "enabled": false,',
  '      "idleSeconds": 3600',
  "    },",
  '    "rendererRealization": {',
  '      "maxWarmRenderers": 4',
  "    }",
  "  },",
  "",
  '  //   "terminal" : {',
  '  //     "autoResumeAgentSessions" : true,',
  "  //   },",
  '  "diffViewer": {',
  '    "defaultLayout": "split",',
  "  },",
  "}",
  "",
].join("\n");

/** The same file, with the key set true. */
const EXPLICIT_TRUE = ABSENT_KEY.replace(
  '    "rendererRealization": {',
  '    "autoResumeAgentSessions": true,\n    "rendererRealization": {',
);

/** Every token as `kind:raw`, the self-check's own comparison. */
function stream({ text }: { text: string }): readonly string[] {
  return unwrap(scanJsonc({ text })).map((token) => `${token.kind}:${token.raw}`);
}

/** An edited plan's text; throws on `unchanged`, so a test reaching for it fails loudly rather than branching. */
function editedText({ plan }: { plan: RestorePolicyPlan }): string {
  if (plan.kind !== "edited") {
    throw new Error(`expected an edit, got ${plan.kind}`);
  }
  return plan.configText;
}

describe("scanJsonc", () => {
  it("skips comments and keeps a // and braces that sit inside a string", () => {
    const text = '{ // c { \n "a": "x // { }", /* } */ "b": [1, true] }';
    expect(stream({ text })).toEqual([
      "punct:{",
      'string:"a"',
      "punct::",
      'string:"x // { }"',
      "punct:,",
      'string:"b"',
      "punct::",
      "punct:[",
      "word:1",
      "punct:,",
      "word:true",
      "punct:]",
      "punct:}",
    ]);
  });

  it("refuses an unterminated block comment, naming its line", () => {
    expect(unwrapErr(scanJsonc({ text: '{\n  "a": 1\n  /* never closed\n}' })).message).toBe(
      'unterminated /* comment at line 3 — not edited; add "autoResumeAgentSessions": false inside the top-level "terminal" object by hand',
    );
  });

  it("refuses an unterminated string", () => {
    expect(unwrapErr(scanJsonc({ text: '{\n  "a": "open\n}' })).code).toBe("CONFIG_SHAPE_REFUSED");
  });
});

describe("readRestorePolicy", () => {
  it("reads on-default when the key is only in a comment", () => {
    expect(unwrap(readRestorePolicy({ configText: ABSENT_KEY }))).toEqual({ kind: "on-default" });
  });

  it("reads on-explicit when the key is true", () => {
    expect(unwrap(readRestorePolicy({ configText: EXPLICIT_TRUE }))).toEqual({ kind: "on-explicit" });
  });

  it("reads off when the key is false", () => {
    const configText = EXPLICIT_TRUE.replace('"autoResumeAgentSessions": true', '"autoResumeAgentSessions": false');
    expect(unwrap(readRestorePolicy({ configText }))).toEqual({ kind: "off" });
  });

  it("reads on-default with no terminal object at all", () => {
    expect(unwrap(readRestorePolicy({ configText: '{ "app": {} }' }))).toEqual({ kind: "on-default" });
  });

  it("refuses a duplicate key, naming its line", () => {
    const configText =
      '{\n  "terminal": {\n    "autoResumeAgentSessions": true,\n    "autoResumeAgentSessions": false\n  }\n}';
    expect(unwrapErr(readRestorePolicy({ configText })).message).toBe(
      'a second "autoResumeAgentSessions" key at line 4 — not edited; add "autoResumeAgentSessions": false inside the top-level "terminal" object by hand',
    );
  });

  it("refuses a duplicate terminal key", () => {
    const refused = unwrapErr(readRestorePolicy({ configText: '{ "terminal": {}, "terminal": {} }' }));
    expect(refused.code).toBe("CONFIG_SHAPE_REFUSED");
    expect(refused.message).toContain('a second "terminal" key at line 1');
  });

  it("refuses a value that is not a boolean", () => {
    const refused = unwrapErr(readRestorePolicy({ configText: '{ "terminal": { "autoResumeAgentSessions": "no" } }' }));
    expect(refused.message).toContain('"autoResumeAgentSessions" is not true or false at line 1');
  });

  it("refuses a terminal that is an array", () => {
    const refused = unwrapErr(readRestorePolicy({ configText: '{ "terminal": [] }' }));
    expect(refused.message).toContain('"terminal" is not an object at line 1');
  });

  it("refuses a top level that is not an object", () => {
    expect(unwrapErr(readRestorePolicy({ configText: "[]" })).message).toContain("top level is not an object");
  });
});

describe("planRestorePolicyOff", () => {
  it("leaves a file that already reads off unchanged", () => {
    const configText = '{ "terminal": { "autoResumeAgentSessions": false } }';
    expect(unwrap(planRestorePolicyOff({ configText, nowIso: NOW }))).toEqual({ kind: "unchanged" });
  });

  it("flips a true to false and writes the comment above the key at its indent", () => {
    const plan = unwrap(planRestorePolicyOff({ configText: EXPLICIT_TRUE, nowIso: NOW }));
    const expected = EXPLICIT_TRUE.replace(
      '    "autoResumeAgentSessions": true,',
      `    ${COMMENT}\n    "autoResumeAgentSessions": false,`,
    );
    expect(plan).toEqual({ configText: expected, how: "flipped", kind: "edited" });
  });

  it("inserts the key as the first member of terminal, indented like the next line, with a comma", () => {
    const plan = unwrap(planRestorePolicyOff({ configText: ABSENT_KEY, nowIso: NOW }));
    const expected = ABSENT_KEY.replace(
      '  "terminal": {\n',
      `  "terminal": {\n    ${COMMENT}\n    "autoResumeAgentSessions": false,\n`,
    );
    expect(plan).toEqual({ configText: expected, how: "inserted-key", kind: "edited" });
  });

  it("changes the token stream by exactly the inserted member", () => {
    const plan = unwrap(planRestorePolicyOff({ configText: ABSENT_KEY, nowIso: NOW }));
    const before = stream({ text: ABSENT_KEY });
    const after = stream({ text: editedText({ plan }) });
    const at = before.indexOf('string:"terminal"') + 3;
    expect(after).toEqual([
      ...before.slice(0, at),
      'string:"autoResumeAgentSessions"',
      "punct::",
      "word:false",
      "punct:,",
      ...before.slice(at),
    ]);
  });

  it("inserts into an empty terminal object without a trailing comma", () => {
    const configText = '{\n  "terminal": {},\n  "app": {}\n}\n';
    const plan = unwrap(planRestorePolicyOff({ configText, nowIso: NOW }));
    expect(plan).toEqual({
      configText: `{\n  "terminal": {\n    ${COMMENT}\n    "autoResumeAgentSessions": false\n  },\n  "app": {}\n}\n`,
      how: "inserted-key",
      kind: "edited",
    });
  });

  it("inserts a terminal object as the first root member when there is none", () => {
    const configText = '{\n  // a comment\n  "app": {\n    "x": 1\n  }\n}\n';
    const plan = unwrap(planRestorePolicyOff({ configText, nowIso: NOW }));
    expect(plan).toEqual({
      configText:
        `{\n  "terminal": {\n    ${COMMENT}\n    "autoResumeAgentSessions": false\n  },` +
        '\n  // a comment\n  "app": {\n    "x": 1\n  }\n}\n',
      how: "inserted-terminal",
      kind: "edited",
    });
  });

  it("inserts a terminal object into an empty root", () => {
    const plan = unwrap(planRestorePolicyOff({ configText: "{}", nowIso: NOW }));
    expect(plan).toEqual({
      configText: `{\n  "terminal": {\n    ${COMMENT}\n    "autoResumeAgentSessions": false\n  }\n}`,
      how: "inserted-terminal",
      kind: "edited",
    });
  });

  it("keeps CRLF line endings and a leading BOM", () => {
    const configText = '﻿{\r\n  "terminal": {\r\n    "autoResumeAgentSessions": true\r\n  }\r\n}\r\n';
    const plan = unwrap(planRestorePolicyOff({ configText, nowIso: NOW }));
    expect(plan).toEqual({
      configText: `﻿{\r\n  "terminal": {\r\n    ${COMMENT}\r\n    "autoResumeAgentSessions": false\r\n  }\r\n}\r\n`,
      how: "flipped",
      kind: "edited",
    });
  });

  it("tolerates trailing commas around the insertion", () => {
    const configText = '{\n  "terminal": {\n    "a": 1,\n  },\n}\n';
    const plan = unwrap(planRestorePolicyOff({ configText, nowIso: NOW }));
    expect(plan).toEqual({
      configText: `{\n  "terminal": {\n    ${COMMENT}\n    "autoResumeAgentSessions": false,\n    "a": 1,\n  },\n}\n`,
      how: "inserted-key",
      kind: "edited",
    });
  });

  it("refuses an unterminated comment rather than editing around it", () => {
    const refused = unwrapErr(planRestorePolicyOff({ configText: '{ "terminal": {} /* open', nowIso: NOW }));
    expect(refused.code).toBe("CONFIG_SHAPE_REFUSED");
  });

  it("refuses a non-boolean value rather than overwriting it", () => {
    const configText = '{ "terminal": { "autoResumeAgentSessions": null } }';
    expect(unwrapErr(planRestorePolicyOff({ configText, nowIso: NOW })).code).toBe("CONFIG_SHAPE_REFUSED");
  });
});
