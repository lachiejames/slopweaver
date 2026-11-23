/**
 * `handover quote` run over a real throwaway board: a board file the scan could not read fails the run rather than
 * dropping out of it, and `--check` fails while a row still needs a write. The pure halves,
 * `unreadableInScope` and `quoteRunIncomplete`, are pinned beside it.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { quoteRunIncomplete, unreadableInScope } from "../../../../../cli/commands/handover/quotePlan.js";
import { runHandoverQuote } from "../../../../../cli/commands/handover/quoteRun.js";
import { withSteers } from "../../../../../cli/commands/handover/quoteSteerRun.js";
import { QUOTE_USAGE } from "../../../../../cli/commands/handover/quoteUsage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { unwrap } from "../../../../../lib/result.js";
import { OWNER_SPEAKER } from "../../../../../talk/callRecord.js";
import { appendCardLanding } from "../../../../../talk/cardLandingStore.js";

/** The call every landing here was said on. */
const LANDED_CALL = "a0000041-0000-4000-8000-000000000044";

/** One more byte than the board will read of a doc. */
const OVERSIZED_BYTES = 2 * 1024 * 1024 + 1;

/** A row anchored on a relay turn this home holds no record of, so its verdict is `unread`. */
const ANCHORED = [
  "---",
  "slug: anchored",
  "kind: ask",
  "summary: an ask given on the console",
  "status: ready",
  "askedIso: 2026-09-28T06:03:54.584Z",
  "anchor: talk:a0000015-0000-4000-8000-000000000016",
  "artifact: null",
  "---",
  "",
  "# body",
  "",
].join("\n");

describe("unreadableInScope", () => {
  it("keeps every unreadable file on a whole-board run, and only a named slug's file on a narrowed one", () => {
    const unreadable = ["huge.md", "other.md"];
    expect([
      unreadableInScope({ slugs: [], unreadable }),
      unreadableInScope({ slugs: ["huge", "fine"], unreadable }),
    ]).toEqual([["huge.md", "other.md"], ["huge.md"]]);
  });
});

describe("quoteRunIncomplete", () => {
  const current = { recordUnreadable: false, verdict: "current", writeFailed: false } as const;
  const add = { recordUnreadable: false, verdict: "add", writeFailed: false } as const;
  const stillUnread = { recordUnreadable: false, verdict: "still-unread", writeFailed: false } as const;

  it("fails on an unreadable file, a failed write or a malformed row, and on a pending write only under --check", () => {
    expect([
      quoteRunIncomplete({ check: false, outcomes: [current], unreadable: ["huge.md"] }),
      quoteRunIncomplete({ check: false, outcomes: [{ ...add, writeFailed: true }], unreadable: [] }),
      quoteRunIncomplete({ check: false, outcomes: [{ ...current, verdict: "malformed" }], unreadable: [] }),
      quoteRunIncomplete({ check: false, outcomes: [add], unreadable: [] }),
      quoteRunIncomplete({ check: true, outcomes: [add], unreadable: [] }),
      quoteRunIncomplete({ check: true, outcomes: [current, stillUnread], unreadable: [] }),
    ]).toEqual([true, true, true, false, true, false]);
  });

  it("reads a defective steer as a row that could not be quoted, and an owed steer write as one still needed", () => {
    const steer = { index: 1, line: "", recordUnreadable: false, wrote: false, writeFailed: false };
    const row = ({ verdict }: { verdict: "defect" | "add" | "answered" }) => ({
      ...current,
      steers: [{ ...steer, verdict }],
    });
    expect([
      quoteRunIncomplete({
        check: false,
        outcomes: withSteers({ outcomes: [row({ verdict: "defect" })] }),
        unreadable: [],
      }),
      quoteRunIncomplete({
        check: true,
        outcomes: withSteers({ outcomes: [row({ verdict: "add" })] }),
        unreadable: [],
      }),
      quoteRunIncomplete({
        check: true,
        outcomes: withSteers({ outcomes: [row({ verdict: "answered" })] }),
        unreadable: [],
      }),
    ]).toEqual([true, true, false]);
  });

  it("fails --check on a record that would not read at all, however settled its row looks", () => {
    const torn = { ...stillUnread, recordUnreadable: true };
    expect([
      quoteRunIncomplete({ check: true, outcomes: [torn], unreadable: [] }),
      quoteRunIncomplete({ check: false, outcomes: [torn], unreadable: [] }),
    ]).toEqual([true, false]);
  });
});

describe("handover quote over a real temp board", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { force: true, recursive: true });
    }
  });

  function board({ oversized, anchored = ANCHORED }: { oversized: boolean; anchored?: string }): {
    home: string;
    dir: string;
  } {
    const home = mkdtempSync(join(tmpdir(), "quote-run-"));
    dirs.push(home);
    const dir = join(home, "handovers");
    mkdirSync(dir);
    writeFileSync(join(dir, "anchored.md"), anchored);
    if (oversized) {
      writeFileSync(join(dir, "huge.md"), "x".repeat(OVERSIZED_BYTES));
    }
    // The call a landing names is on disk, closed and holding each stretch finished over the card with exactly the words
    // landed off it, the voice speaking between them, so it says those words were not cut since.
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    const said = [
      { id: "s-1", text: "ship it", who: OWNER_SPEAKER },
      { id: "v-1", text: "noted", who: "voice" },
      { id: "s-2", text: "show where each figure came from", who: OWNER_SPEAKER },
    ];
    const lines = said.map(({ id, text, who }) =>
      JSON.stringify({
        atIso: "2026-10-03T08:00:00.000Z",
        final: true,
        id,
        kind: "segment",
        open: "ask:anchored",
        text,
        who,
      }),
    );
    const closed = JSON.stringify({ atIso: "2026-10-03T09:00:00.000Z", kind: "closed", why: null });
    writeFileSync(join(home, "talk", "calls", `${LANDED_CALL}.jsonl`), `${[...lines, closed].join("\n")}\n`);
    return { dir, home };
  }

  function quote({ home, dir, args }: { home: string; dir: string; args: readonly string[] }): Promise<number> {
    return runHandoverQuote(["node", "slopweaver", "handover", "quote", ...args, "--home", home, "--dir", dir]);
  }

  it("exits 1 on a whole-board run when a board file would not read, and 0 on the same board without it", async () => {
    const broken = board({ oversized: true });
    const clean = board({ oversized: false });
    expect([await quote({ ...broken, args: [] }), await quote({ ...clean, args: [] })]).toEqual([EXIT_ERROR, EXIT_OK]);
  });

  it("fails a run over a row whose front matter a leading BOM hides, where the same row without it passes", async () => {
    const hidden = board({ anchored: `\uFEFF${ANCHORED}`, oversized: false });
    expect([await quote({ ...hidden, args: [] }), await quote({ ...board({ oversized: false }), args: [] })]).toEqual([
      EXIT_ERROR,
      EXIT_OK,
    ]);
  });

  it("fails a run narrowed to an unreadable row's slug as unread, not as an unknown slug", async () => {
    expect(await quote({ ...board({ oversized: true }), args: ["huge"] })).toBe(EXIT_ERROR);
  });

  it("passes --check once a call: row is quoted, and fails it while one torn ledger line hides the landing", async () => {
    const anchor = "call:a0000041-0000-4000-8000-000000000044#s-1";
    const landed = (): { home: string; dir: string } => {
      const fixture = board({ anchored: ANCHORED.replace(/^anchor: .*$/m, `anchor: ${anchor}`), oversized: false });
      unwrap(
        appendCardLanding({
          home: fixture.home,
          row: {
            anchor,
            atIso: "2026-09-26T21:05:00.000Z",
            cardKey: "ask:anchored",
            decidedIso: "2026-09-26T21:04:00.000Z",
            kind: "landed",
            source: "transcript",
            words: "ship it",
            workSlug: "anchored",
          },
        }),
      );
      return fixture;
    };
    const clean = landed();
    const torn = landed();
    appendFileSync(join(torn.home, "talk", "card-landings.jsonl"), "{torn\n");
    const codes: number[] = [];
    for (const fixture of [clean, torn]) {
      codes.push(await quote({ ...fixture, args: ["--apply"] }), await quote({ ...fixture, args: ["--check"] }));
    }
    expect(codes).toEqual([EXIT_OK, EXIT_OK, EXIT_OK, EXIT_ERROR]);
  });

  it("relates a landed steer to a row with --add-steer, and the whole-board --check then passes", async () => {
    const steer = "call:a0000041-0000-4000-8000-000000000044#s-2";
    const fixture = board({ oversized: false });
    unwrap(
      appendCardLanding({
        home: fixture.home,
        row: {
          anchor: steer,
          atIso: "2026-10-03T08:57:00.000Z",
          cardKey: "ask:anchored",
          decidedIso: "2026-10-03T08:58:00.000Z",
          kind: "landed",
          source: "transcript",
          words: "show where each figure came from",
          workSlug: "anchored",
        },
      }),
    );
    const codes = [
      await quote({ ...fixture, args: ["anchored", "--add-steer", steer, "--apply"] }),
      await quote({ ...fixture, args: ["--apply"] }),
      await quote({ ...fixture, args: ["--check"] }),
    ];
    const path = join(fixture.dir, "anchored.md");
    const steers = parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).hisWordsSteers;
    expect(codes).toEqual([EXIT_OK, EXIT_OK, EXIT_OK]);
    expect(steers).toEqual([
      {
        group: {
          hisWords: {
            anchor: steer,
            atIso: "2026-10-03T08:58:00.000Z",
            cut: "none",
            where: "call-landing",
            words: "show where each figure came from",
          },
          kind: "held",
        },
        index: 1,
      },
    ]);
  });

  it("documents --add-steer as relating one anchor to one named row", () => {
    expect(QUOTE_USAGE).toContain("slopweaver handover quote <slug> --add-steer <anchor> [--apply] [--json]");
  });

  it("refuses --add-steer naming none of the owner's words, or no single row", async () => {
    const fixture = board({ oversized: false });
    expect([
      await quote({ ...fixture, args: ["anchored", "--add-steer", "https://example.com/x"] }),
      await quote({ ...fixture, args: ["--add-steer", "talk:a0000015-0000-4000-8000-000000000016"] }),
    ]).toEqual([EXIT_USAGE, EXIT_USAGE]);
  });

  it("fails --check while a row still needs a write, and refuses --check beside --apply", async () => {
    const fixture = board({ oversized: false });
    expect([
      await quote({ ...fixture, args: ["--check"] }),
      await quote({ ...fixture, args: ["--check", "--apply"] }),
    ]).toEqual([EXIT_ERROR, EXIT_USAGE]);
  });
});
