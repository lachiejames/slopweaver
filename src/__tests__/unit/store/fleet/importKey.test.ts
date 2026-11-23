/**
 * The per-line import key, and the prefixed key an imported autonomy line is stored under.
 *
 * The case that earns its place is the rewritten line: the same act at the same line number, its bytes changed
 * by `autonomy adopt` adding a `said`, keys differently — which is why the autonomy import compares acts by id
 * rather than trusting a key match.
 *
 * The act key and the stale-key set the autonomy leg retired are gone: the import no longer retires a mirror row
 * a rewritten line orphaned, because the store, not the file, is the ledger.
 * deleted-with-code: staleImportKeys, autonomyActKey
 */
import { describe, expect, it } from "vitest";

import { importedAutonomyKey } from "../../../../store/fleet/autonomyEvent.js";
import { ledgerImportKey } from "../../../../store/fleet/importKey.js";

const BEFORE_ADOPT = '{"actionId":"16324-rebase","doneIso":"2026-09-12T03:30:01Z"}';
const AFTER_ADOPT = '{"actionId":"16324-rebase","doneIso":"2026-09-12T03:30:01Z","said":"rebase and fix red ci"}';

describe("ledgerImportKey", () => {
  it("pads the line number to ten digits after the digest", () => {
    expect(ledgerImportKey({ line: BEFORE_ADOPT, lineNumber: 9 }).slice(-11)).toBe(":0000000009");
  });

  it("keys a line rewritten in place differently from the line it replaced", () => {
    const before = ledgerImportKey({ line: BEFORE_ADOPT, lineNumber: 9 });
    const after = ledgerImportKey({ line: AFTER_ADOPT, lineNumber: 9 });
    expect(after).not.toBe(before);
  });
});

describe("importedAutonomyKey", () => {
  it("prefixes the line key, so it cannot collide with a mirror row's bare key", () => {
    expect(importedAutonomyKey({ line: BEFORE_ADOPT, lineNumber: 9 })).toBe(
      `imported:${ledgerImportKey({ line: BEFORE_ADOPT, lineNumber: 9 })}`,
    );
  });
});
