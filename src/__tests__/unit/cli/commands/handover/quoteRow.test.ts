/*
 * The two pure halves of quoting one row: which verdicts write, and whether a row's anchor is read at all.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { QuoteVerdict } from "../../../../../cli/commands/handover/quotePlan.js";
import { quoteWrites, readRowAnchor } from "../../../../../cli/commands/handover/quoteRow.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { unwrapErr } from "../../../../../lib/result.js";

const TURN = "a0000015-0000-4000-8000-000000000016";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "quote-row-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function docWith({ anchor }: { anchor: string | undefined }): ReturnType<typeof parseHandoverDoc> {
  const lines = ["---", "slug: lead-with-their-words", "status: planned"];
  if (anchor !== undefined) {
    lines.push(`anchor: ${anchor}`);
  }
  lines.push("---", "", "# Lead with their words", "");
  return parseHandoverDoc({ path: "/h/lead-with-their-words.md", text: lines.join("\n") });
}

describe("quoteWrites", () => {
  it("writes a row that gains, changes, loses or repairs a quote, and never one current, unread or malformed", () => {
    const record = { anchor: `talk:${TURN}`, kind: "unread", why: "gone" } as const;
    const verdicts: readonly QuoteVerdict[] = [
      { kind: "add", record },
      { kind: "refresh", record },
      { kind: "unread", record },
      { kind: "repair", record, why: "half-written" },
      { kind: "drop", why: "the anchor moved" },
      { kind: "current" },
      { kind: "still-unread", why: "gone" },
      { kind: "malformed", why: "no status" },
    ];
    expect(verdicts.map((verdict) => quoteWrites({ verdict }))).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("readRowAnchor", () => {
  it("reads nothing for a row with no anchor, or one naming no record of the owner's words", () => {
    expect([
      readRowAnchor({ doc: docWith({ anchor: undefined }), home }),
      readRowAnchor({ doc: docWith({ anchor: "https://x.slack.com/archives/C1/p1" }), home }),
    ]).toEqual([undefined, undefined]);
  });

  it("reads the record an owner-words anchor names, and says when it is not there", () => {
    const read = readRowAnchor({ doc: docWith({ anchor: `talk:${TURN}` }), home })!;
    expect(unwrapErr(read).code).toBe("RECORD_MISSING");
  });
});
