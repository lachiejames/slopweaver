/**
 * `handover abandon` on an ORPHANED run — one whose doc has been deleted.
 *
 * The defect, found by using the tool rather than by reading it: a run was left open by a doc that was later
 * deleted. Every session start then reported it open and instructed the next agent to resume it first, and all
 * three typed endings refused it — each resolves the slug through the board. So the tooling demanded the run be
 * ended and made ending it impossible.
 *
 * A real filesystem is used deliberately and is what `testing.md` permits: a `mkdtempSync` round-trip. The
 * journal is seeded through the production writer rather than hand-authored, so the test cannot pass against a
 * format the writer does not actually produce.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { orphanAbandonVerdict, runHandoverAbandon } from "../../../cli/commands/handover/lifecycleRun.js";
import { EXIT_OK } from "../../../cli/exitCodes.js";
import { appendRunEvent, readRunJournal } from "../../../handover/runStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A state home with an EMPTY handovers directory — the orphan condition — and a runs directory. */
function emptyHome(): { home: string; runsDir: string } {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-orphan-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "handovers"), { recursive: true });
  const runsDir = join(home, "runs");
  mkdirSync(runsDir, { recursive: true });
  return { home, runsDir };
}

/** Seed an OPEN run for `slug`, through the production writer. */
function openRun({ runsDir, slug }: { runsDir: string; slug: string }): void {
  appendRunEvent({
    event: { atIso: "2026-08-01T00:00:00.000Z", branch: "gone-branch", docHash: "deadbeef", kind: "started" },
    runsDir,
    slug,
  });
}

/** The argv a real invocation would carry. */
function argv({ slug, home, why }: { slug: string; home: string; why: readonly string[] }): readonly string[] {
  return ["node", "cli", "handover", "abandon", slug, "--home", home, ...why];
}

/** Every event kind on a slug's journal, in order. */
function kinds({ runsDir, slug }: { runsDir: string; slug: string }): readonly string[] {
  const read = readRunJournal({ runsDir, slug });
  return read.isOk() ? read.value.events.map((event) => event.kind) : ["UNREADABLE"];
}

/** Bytes over `scanBoard`'s 2 MiB per-doc limit, which makes it report the doc UNREADABLE rather than parse it. */
const OVERSIZED_BYTES = 2 * 1024 * 1024 + 1;

describe("handover abandon on an orphaned run", () => {
  it("closes a run whose doc no longer exists", async () => {
    const { home, runsDir } = emptyHome();
    openRun({ runsDir, slug: "orphan-run" });

    const code = await runHandoverAbandon(argv({ home, slug: "orphan-run", why: ["--why", "its doc was deleted"] }));

    expect(code).toBe(EXIT_OK);
    expect(kinds({ runsDir, slug: "orphan-run" })).toEqual(["started", "abandoned"]);
  });

  it("records the reason, so an orphan is never closed silently", async () => {
    const { home, runsDir } = emptyHome();
    openRun({ runsDir, slug: "orphan-run" });

    await runHandoverAbandon(argv({ home, slug: "orphan-run", why: ["--why", "the fleet removal deleted its doc"] }));
    const read = readRunJournal({ runsDir, slug: "orphan-run" });
    const abandoned = read.isOk() ? read.value.events.filter((event) => event.kind === "abandoned") : [];

    expect(abandoned.length).toBe(1);
    expect(JSON.stringify(abandoned[0])).toContain("the fleet removal deleted its doc");
  });

  it("still REQUIRES a reason", async () => {
    const { home, runsDir } = emptyHome();
    openRun({ runsDir, slug: "orphan-run" });

    const code = await runHandoverAbandon(argv({ home, slug: "orphan-run", why: [] }));

    expect(code).not.toBe(EXIT_OK);
    expect(kinds({ runsDir, slug: "orphan-run" })).toEqual(["started"]);
  });

  it("refuses a slug with no journal at all — there is nothing to abandon", async () => {
    // A missing journal reads as EMPTY rather than as an error, so this is refused via the closed-phase branch
    // (`NO_RUN.phase` is `"closed"`), not the unreadable branch. Asserted because those are two different paths
    // and only one of them is exercised here.
    const { home, runsDir } = emptyHome();

    const code = await runHandoverAbandon(argv({ home, slug: "never-ran", why: ["--why", "whatever"] }));

    expect(code).not.toBe(EXIT_OK);
    expect(kinds({ runsDir, slug: "never-ran" })).toEqual([]);
  });

  it("refuses a run that is ALREADY closed, rather than appending a second ending", async () => {
    const { home, runsDir } = emptyHome();
    openRun({ runsDir, slug: "orphan-run" });
    appendRunEvent({
      event: { atIso: "2026-08-02T00:00:00.000Z", kind: "abandoned", why: "first" },
      runsDir,
      slug: "orphan-run",
    });

    const code = await runHandoverAbandon(argv({ home, slug: "orphan-run", why: ["--why", "second"] }));

    expect(code).not.toBe(EXIT_OK);
    expect(kinds({ runsDir, slug: "orphan-run" })).toEqual(["started", "abandoned"]);
  });
});

describe("handover abandon and an UNREADABLE doc", () => {
  it("REFUSES rather than abandoning when a doc on the board could not be read", async () => {
    // The counterexample an adversarial review supplied, reproduced exactly. `scanBoard` SUCCEEDS while omitting
    // an oversized doc — it lands in `unreadable`, not `docs`. An earlier cut read that as "no doc claims the
    // slug" and abandoned a run whose doc was sitting right there.
    const { home, runsDir } = emptyHome();
    openRun({ runsDir, slug: "orphan-run" });
    writeFileSync(join(home, "handovers", "orphan-run.md"), "x".repeat(OVERSIZED_BYTES), "utf8");

    const code = await runHandoverAbandon(argv({ home, slug: "orphan-run", why: ["--why", "cleanup"] }));

    expect(code).not.toBe(EXIT_OK);
    expect(kinds({ runsDir, slug: "orphan-run" })).toEqual(["started"]);
  });

  it("refuses even when the unreadable doc is a DIFFERENT one, because a slug cannot be read from it", async () => {
    const { home, runsDir } = emptyHome();
    openRun({ runsDir, slug: "orphan-run" });
    writeFileSync(join(home, "handovers", "some-other.md"), "y".repeat(OVERSIZED_BYTES), "utf8");

    const code = await runHandoverAbandon(argv({ home, slug: "orphan-run", why: ["--why", "cleanup"] }));

    expect(code).not.toBe(EXIT_OK);
    expect(kinds({ runsDir, slug: "orphan-run" })).toEqual(["started"]);
  });
});

describe("handover abandon on an orphaned run held by a HOSTLESS writer", () => {
  /** A pid guaranteed not to belong to any running process on this machine. */
  const DEAD_PID = 999_999;

  it("closes it when the recorded pid is provably dead — the assistant-surface-recon case", async () => {
    // Neither `claim` (needs a doc, and this one's is archived/gone) nor the plain ownership refusal could ever
    // end a run like this: a legacy journal with no `host` field, naming a pid that died days ago. Measured live
    // against assistant-surface-recon before this fix existed — refused every time with "another session is
    // driving it", forever, because "unknown" liveness on a hostless journal used to be indistinguishable from
    // "genuinely still running".
    const { home, runsDir } = emptyHome();
    openRun({ runsDir, slug: "orphan-run" });
    appendRunEvent({
      event: {
        atIso: "2026-08-06T00:00:00.000Z",
        kind: "launched",
        pid: DEAD_PID,
        sessionId: "dead-session",
        worktree: "/tmp/gone",
      },
      runsDir,
      slug: "orphan-run",
    });

    const code = await runHandoverAbandon(argv({ home, slug: "orphan-run", why: ["--why", "writer is dead"] }));

    expect(code).toBe(EXIT_OK);
    expect(kinds({ runsDir, slug: "orphan-run" })).toEqual(["started", "launched", "abandoned"]);
  });

  it("still REFUSES after a RESUME carries the writer to a live pid, even though the original launch pid is dead", async () => {
    // The counterexample an adversarial pass found: `resumedWriter` used to carry the
    // ORIGINAL `launched` pid forward regardless of what the `resumed` event itself recorded. A dead launch pid
    // plus a live resume meant this dead-pid liveness check read the stale dead pid and wrongly abandoned a run
    // whose actual current writer was still running. Fixed in runOwner.ts's `resumedWriter` to prefer the
    // resumed event's own pid; this proves the fix from the CALLER's side, not just the fold in isolation.
    const { home, runsDir } = emptyHome();
    openRun({ runsDir, slug: "orphan-run" });
    appendRunEvent({
      event: {
        atIso: "2026-08-06T00:00:00.000Z",
        kind: "launched",
        pid: DEAD_PID,
        sessionId: "resumed-session",
        worktree: "/tmp/gone",
      },
      runsDir,
      slug: "orphan-run",
    });
    appendRunEvent({
      event: {
        atIso: "2026-08-06T01:00:00.000Z",
        attempt: 2,
        kind: "resumed",
        pid: process.pid,
        sessionId: "resumed-session",
      },
      runsDir,
      slug: "orphan-run",
    });

    const code = await runHandoverAbandon(argv({ home, slug: "orphan-run", why: ["--why", "should not work"] }));

    expect(code).not.toBe(EXIT_OK);
    expect(kinds({ runsDir, slug: "orphan-run" })).toEqual(["started", "launched", "resumed"]);
  });

  it("still REFUSES when the hostless writer's pid is alive — dead-pid detection must not loosen a live hold", async () => {
    const { home, runsDir } = emptyHome();
    openRun({ runsDir, slug: "orphan-run" });
    appendRunEvent({
      event: {
        atIso: "2026-08-06T00:00:00.000Z",
        kind: "launched",
        pid: process.pid,
        sessionId: "live-session",
        worktree: "/tmp/still-here",
      },
      runsDir,
      slug: "orphan-run",
    });

    const code = await runHandoverAbandon(argv({ home, slug: "orphan-run", why: ["--why", "should not work"] }));

    expect(code).not.toBe(EXIT_OK);
    expect(kinds({ runsDir, slug: "orphan-run" })).toEqual(["started", "launched"]);
  });
});

describe("handover abandon and an UNDECODABLE journal line", () => {
  it("REFUSES when a journal line cannot be decoded, because the run may already have ENDED", async () => {
    // The second counterexample an adversarial review supplied. `parseLedger` DISCARDS a line it cannot decode,
    // so a journal whose ending was torn mid-write decodes to `started` alone and derives `open`. Abandoning then
    // writes a second ending over a run that may have been FINISHED — misrepresenting how it ended.
    const { home, runsDir } = emptyHome();
    openRun({ runsDir, slug: "orphan-run" });
    appendFileSync(
      join(runsDir, "orphan-run.jsonl"),
      '{"kind":"finished","atIso":"2026-08-02T00:00:00.000Z"\n',
      "utf8",
    );

    const code = await runHandoverAbandon(argv({ home, slug: "orphan-run", why: ["--why", "cleanup"] }));

    expect(code).not.toBe(EXIT_OK);
    expect(kinds({ runsDir, slug: "orphan-run" })).toEqual(["started"]);
  });
});

/** The pure decision, with every input at its safe default so each test varies exactly one. */
function verdict(over: Partial<Parameters<typeof orphanAbandonVerdict>[0]> = {}) {
  return orphanAbandonVerdict({
    boardHasSlug: false,
    boardUnreadable: [],
    journalUnreadable: [],
    phase: "open",
    slug: "orphan-run",
    ...over,
  });
}

describe("orphanAbandonVerdict", () => {
  it("abandons when the board does not carry the slug and the run is open", () => {
    expect(verdict().kind).toBe("abandon");
  });

  it("falls through when a readable doc DOES carry the slug", () => {
    expect(verdict({ boardHasSlug: true }).kind).toBe("fall-through");
  });

  it("falls through when the run is already closed", () => {
    expect(verdict({ phase: "closed" }).kind).toBe("fall-through");
  });

  it("abandons a run that is waiting on the owner — that is still open", () => {
    expect(verdict({ phase: "waiting-on-owner" }).kind).toBe("abandon");
  });

  it("REFUSES on an unreadable doc, because unreadable is not absent", () => {
    expect(verdict({ boardUnreadable: ["big.md"] }).kind).toBe("refuse");
  });

  it("names the unreadable docs in its refusal", () => {
    expect(verdict({ boardUnreadable: ["big.md", "torn.md"] })).toMatchObject({
      why: '2 doc(s) on the board could not be read (big.md, torn.md), so "orphan-run" cannot be shown to be orphaned — fix or remove them first',
    });
  });

  it("REFUSES on an undecodable journal line, because the run may already have ended", () => {
    expect(verdict({ journalUnreadable: [2] }).kind).toBe("refuse");
  });

  it("names the undecodable journal lines in its refusal", () => {
    expect(verdict({ journalUnreadable: [2, 5] })).toMatchObject({
      why: "orphan-run's journal has 2 line(s) that could not be decoded (2, 5), so it cannot show whether the run is still open",
    });
  });

  it("prefers fall-through over refuse when the doc exists AND something is unreadable", () => {
    // A present doc means this is simply not the orphan case, so the ordinary path owns it — refusing there would
    // break `abandon` for every doc-backed run whenever one unrelated file on the board is unreadable.
    expect(verdict({ boardHasSlug: true, boardUnreadable: ["big.md"] }).kind).toBe("fall-through");
  });

  it("refuses on the BOARD before looking at the journal", () => {
    expect(verdict({ boardUnreadable: ["big.md"], journalUnreadable: [2] })).toMatchObject({
      why: '1 doc(s) on the board could not be read (big.md), so "orphan-run" cannot be shown to be orphaned — fix or remove them first',
    });
  });
});
