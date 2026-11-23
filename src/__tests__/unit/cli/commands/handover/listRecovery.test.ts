/**
 * `handover list`'s journal sweep, at the seams a process does not need: whether a recovery found anything, a
 * home with no runs directory yet, and which recovered roots `recoveredModels` keeps. The sweep against a real
 * home is `subprocess/handover/listDetachedAsk.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isSettledWait,
  type ListRecovery,
  recoveredAnything,
  recoveredModels,
  recoveredRows,
  recoverListJournals,
} from "../../../../../cli/commands/handover/listRecovery.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../../../handover/doc.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import { settledThenAskedOf } from "../../../../../handover/settledAsk.js";

const NOTHING: ListRecovery = { archivedRoots: [], detachedAsks: [], journals: new Map(), unreadJournals: [] };

const STARTED: RunEvent = { atIso: "2026-10-08T00:00:00.000Z", branch: "b", docHash: "h", kind: "started" };
const ASKED: RunEvent = { atIso: "2026-10-08T01:00:00.000Z", kind: "question", question: "Ship it?" };

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** An archived doc, parsed as the archive scan would. */
function archived({ slug, status }: { slug: string; status: string }): HandoverDoc {
  const text = ["---", `slug: ${slug}`, "kind: doc", `summary: ${slug} row`, `status: ${status}`, "---", ""];
  return parseHandoverDoc({ path: `/h/archive/${slug}.md`, text: text.join("\n") });
}

/** A recovery holding one archived root whose run asked the owner a question. */
function recoveryOf({ doc }: { doc: HandoverDoc }): ListRecovery {
  return {
    ...NOTHING,
    archivedRoots: [doc],
    journals: new Map([[doc.slug, { events: [STARTED, ASKED], unreadableLines: [] }]]),
  };
}

/** The slugs `recoveredModels` keeps for one recovery, over an empty live board. */
function keptSlugs({ recovery }: { recovery: ListRecovery }): readonly string[] {
  return recoveredModels({
    docs: [],
    handoverDir: "/h",
    journals: recovery.journals,
    probeStates: new Map(),
    recovery,
  }).map((model) => model.doc.slug);
}

describe("recoveredAnything", () => {
  it("is false for a sweep that found nothing", () => {
    expect(recoveredAnything({ recovery: NOTHING })).toBe(false);
  });

  it("is true for a sweep that found only a journal it could not read", () => {
    const recovery = { ...NOTHING, unreadJournals: [{ journal: "/h/runs/x.jsonl", why: "unreadable" }] };
    expect(recoveredAnything({ recovery })).toBe(true);
  });
});

describe("recoverListJournals", () => {
  it("recovers nothing from a home whose runs directory does not exist yet", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-list-recovery-"));
    dirs.push(home);

    const recovery = recoverListJournals({
      claimed: new Set(),
      handoverDir: join(home, "handovers"),
      liveUnreadable: [],
      runsDir: join(home, "runs"),
    });

    expect(recovery).toEqual(NOTHING);
  });
});

describe("recoveredModels", () => {
  it("keeps an archived doc whose run is still waiting on the owner", () => {
    expect(keptSlugs({ recovery: recoveryOf({ doc: archived({ slug: "open-run", status: "ready" }) }) })).toEqual([
      "open-run",
    ]);
  });

  it("drops an archived doc ownerWait calls settled", () => {
    expect(keptSlugs({ recovery: recoveryOf({ doc: archived({ slug: "done-run", status: "done" }) }) })).toEqual([]);
  });

  it("composes nothing when nothing was recovered", () => {
    expect(keptSlugs({ recovery: NOTHING })).toEqual([]);
  });
});

describe("recoveredRows", () => {
  /** An archived ask row settled with no `settledIso:`, as a settle predating that field wrote it. */
  const undatedSettledAsk = parseHandoverDoc({
    path: "/h/archive/archived-ask.md",
    text: [
      "---",
      "slug: archived-ask",
      "kind: ask",
      "summary: archived-ask row",
      "status: ready",
      "settlement: answered",
      "settlementWitness: w",
      "---",
      "",
    ].join("\n"),
  });
  const recovery = recoveryOf({ doc: undatedSettledAsk });
  const rows = recoveredRows({
    docs: [],
    handoverDir: "/h",
    journals: recovery.journals,
    probeStates: new Map(),
    recovery,
  });

  it("keeps the archived settled ask the board drops, so its open question is still read", () => {
    expect(keptSlugs({ recovery })).toEqual([]);
    expect(rows.map((model) => [model.doc.slug, isSettledWait({ model })])).toEqual([["archived-ask", true]]);
  });

  it("is what names that question as unordered", () => {
    expect(settledThenAskedOf({ models: rows }).map((row) => [row.slug, row.order, row.question])).toEqual([
      ["archived-ask", "unordered", "Ship it?"],
    ]);
  });
});
