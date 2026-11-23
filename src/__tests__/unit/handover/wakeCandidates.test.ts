/**
 * What `handover wake` reads off the board and the run journal before it reseats anything, over a real board and
 * real journals in a throwaway home: which parks are candidates, whether one still stands, and whether a reseat's
 * journal proves a seat came up.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { RunEvent } from "../../../handover/ledger.js";
import type { ParkWake } from "../../../handover/parkWake.js";
import { appendRunEvent, readRunJournal, runJournalPath } from "../../../handover/runStore.js";
import { parkMoved, parkStanding, WakeScanErrors, wakeCandidates } from "../../../handover/wakeCandidates.js";
import { lastReseatedParkBefore, reseatUnproven } from "../../../handover/wakeProofs.js";

const AFTER = "2026-10-15T03:14:00.000Z";
const CLOCK_WAKE: ParkWake = { atIso: "2026-10-15T03:00:00Z", kind: "at" };

describe("wakeCandidates", () => {
  let home: string;
  let runsDir: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "wake-candidates-"));
    runsDir = join(home, "runs");
    mkdirSync(join(home, "handovers"), { recursive: true });
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** A doc on the board and a journal whose seat parked on a clock wake, or on a question. */
  function parkedRow({ slug, waking = true }: { slug: string; waking?: boolean }): void {
    writeFileSync(
      join(home, "handovers", `${slug}.md`),
      ["---", `slug: ${slug}`, "summary: a run", "status: in-progress", "---", "", `# ${slug}`, ""].join("\n"),
    );
    const events = [
      { atIso: "2026-10-15T01:00:00.000Z", branch: slug, docHash: "h", kind: "started" },
      { atIso: "2026-10-15T01:00:01.000Z", kind: "launched", pid: 7, sessionId: `s-${slug}`, worktree: `/wt/${slug}` },
      {
        atIso: "2026-10-15T02:00:00.000Z",
        branch: slug,
        kind: "parked",
        screenTail: "❯ ",
        sessionId: `s-${slug}`,
        ...(waking ? { wake: CLOCK_WAKE } : { question: "which base?" }),
        workspaceRef: "workspace:238",
        worktree: `/wt/${slug}`,
      },
    ] as const;
    for (const event of events) {
      unwrap(appendRunEvent({ event, runsDir, slug }));
    }
  }

  /** Append each line to a slug's journal. */
  function append({ events, slug }: { events: readonly RunEvent[]; slug: string }): void {
    for (const event of events) {
      unwrap(appendRunEvent({ event, runsDir, slug }));
    }
  }

  it("names a park on a wake, in board order, and passes over a park on a question", () => {
    parkedRow({ slug: "clock" });
    parkedRow({ slug: "asking", waking: false });
    const scanned = unwrap(wakeCandidates({ home, rerunAllowed: false }));
    expect(scanned.candidates.map((candidate) => [candidate.slug, candidate.parkIndex])).toEqual([["clock", 2]]);
    expect([scanned.duplicateSlugs, scanned.unreadable]).toEqual([[], []]);
  });

  it("refuses the whole scan while a board doc will not read, naming it", () => {
    parkedRow({ slug: "clock" });
    mkdirSync(join(home, "handovers", "broken.md"));
    const refused = unwrapErr(wakeCandidates({ home, rerunAllowed: false }));
    expect(refused).toEqual(WakeScanErrors.docUnreadable({ unreadable: ["broken.md"] }));
    expect(refused.message).toBe(
      "1 board doc(s) would not read (broken.md), and any of them may share a waking row's slug — fix them; no park wakes until they read",
    );
  });

  it("says a park still stands until a later line clears or replaces it", () => {
    parkedRow({ slug: "clock" });
    const standing = parkMoved({ parkIndex: 2, runsDir, slug: "clock" });
    append({ events: [{ atIso: AFTER, kind: "abandoned", why: "cancelled" }], slug: "clock" });
    expect([standing, parkMoved({ parkIndex: 2, runsDir, slug: "clock" })]).toEqual([
      undefined,
      "the park has cleared",
    ]);
  });

  it("says a park stands, is gone, or is unknown when its journal does not re-read whole", () => {
    // What the Fleet page drops a park from an older board read by (the fleet-page count).
    for (const slug of ["stands", "gone", "garbled"]) {
      parkedRow({ slug });
    }
    append({ events: [{ atIso: AFTER, kind: "abandoned", why: "cancelled" }], slug: "gone" });
    writeFileSync(runJournalPath({ runsDir, slug: "garbled" }), "{not json\n", { flag: "a" });
    expect(
      ["stands", "gone", "garbled", "never-parked"].map((slug) => parkStanding({ parkIndex: 2, runsDir, slug })),
    ).toEqual(["standing", "gone", "unknown", "gone"]);
  });

  // A second wake running at once may suspend the park after this one's scan found it.
  it("says a park no longer stands for a reseat once another wake suspended it on the owner's question", () => {
    parkedRow({ slug: "clock" });
    const question = "which base?";
    append({ events: [{ atIso: "2026-10-15T02:10:00.000Z", kind: "question", question }], slug: "clock" });
    const before = parkMoved({ parkIndex: 2, runsDir, slug: "clock" });
    const suspension: RunEvent = {
      atIso: AFTER,
      judgedLength: 4,
      kind: "park-wake-suspended",
      parkIndex: 2,
      question,
      questionAskedIso: "2026-10-15T02:10:00.000Z",
      why: "o/r#7 merged",
    };
    append({ events: [suspension], slug: "clock" });
    expect([before, parkMoved({ parkIndex: 2, runsDir, slug: "clock" })]).toEqual([
      undefined,
      "another wake suspended its wake on the owner's question",
    ]);
    // Only the wake is suspended: the park itself still stands, on the owner, so the Fleet page keeps it.
    expect(parkStanding({ parkIndex: 2, runsDir, slug: "clock" })).toBe("standing");
  });

  it("believes a reseat only when the first line to clear the park is dispatched", () => {
    parkedRow({ slug: "proven" });
    parkedRow({ slug: "abandoned-first" });
    parkedRow({ slug: "still-parked" });
    append({ events: [{ atIso: AFTER, by: "cmux spawn", kind: "dispatched", target: "workspace:9" }], slug: "proven" });
    append({
      events: [
        { atIso: AFTER, kind: "abandoned", why: "cancelled" },
        { atIso: AFTER, by: "cmux spawn", kind: "dispatched", target: "workspace:9" },
      ],
      slug: "abandoned-first",
    });
    expect(
      ["proven", "abandoned-first", "still-parked"].map((slug) => reseatUnproven({ parkIndex: 2, runsDir, slug })),
    ).toEqual([
      undefined,
      "cmux spawn exited 0 and the park cleared, but not first by a `dispatched` line, so nothing proves a seat came up",
      "cmux spawn exited 0 but no `dispatched` line cleared the park; still parked",
    ]);
  });

  // The 9b shape: the reseated seat parked again before the wake re-read its journal.
  it("still believes a reseat whose seat parked again at once, and names the park it came up from", () => {
    parkedRow({ slug: "fast" });
    append({
      events: [
        { atIso: AFTER, by: "cmux spawn", kind: "dispatched", target: "workspace:9" },
        { atIso: AFTER, kind: "launched", pid: 9, sessionId: "s2-fast", worktree: "/wt/fast" },
        {
          atIso: "2026-10-15T03:15:00.000Z",
          branch: "fast",
          kind: "parked",
          screenTail: "❯ ",
          sessionId: "s2-fast",
          wake: CLOCK_WAKE,
          workspaceRef: "workspace:9",
          worktree: "/wt/fast",
        },
      ],
      slug: "fast",
    });
    const { events } = unwrap(readRunJournal({ runsDir, slug: "fast" }));
    expect(reseatUnproven({ parkIndex: 2, runsDir, slug: "fast" })).toBe(undefined);
    expect([
      lastReseatedParkBefore({ events, parkIndex: 5 }),
      lastReseatedParkBefore({ events, parkIndex: 2 }),
    ]).toEqual(["2@2026-10-15T02:00:00.000Z", undefined]);
  });

  // a reseat in an earlier cycle of the same slug is another run, never what this park came up from.
  it("names no reseated park across a cycle boundary", () => {
    parkedRow({ slug: "rerun" });
    append({
      events: [
        { atIso: AFTER, by: "cmux spawn", kind: "dispatched", target: "workspace:9" },
        { atIso: AFTER, kind: "abandoned", why: "cancelled" },
        { atIso: "2026-10-15T04:00:00.000Z", branch: "rerun", docHash: "h2", kind: "started" },
        { atIso: "2026-10-15T04:00:01.000Z", kind: "launched", pid: 9, sessionId: "s2-rerun", worktree: "/wt/rerun" },
        {
          atIso: "2026-10-15T04:10:00.000Z",
          branch: "rerun",
          kind: "parked",
          screenTail: "❯ ",
          sessionId: "s2-rerun",
          wake: CLOCK_WAKE,
          workspaceRef: "workspace:9",
          worktree: "/wt/rerun",
        },
      ],
      slug: "rerun",
    });
    const { events } = unwrap(readRunJournal({ runsDir, slug: "rerun" }));
    expect(lastReseatedParkBefore({ events, parkIndex: 7 })).toBe(undefined);
  });
});
