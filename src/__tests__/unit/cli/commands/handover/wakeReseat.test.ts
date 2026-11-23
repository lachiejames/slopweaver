/**
 * `reseatClaimed`, `reparkGuard` and the retry half's journal read, each over a real temporary home: a deferred
 * launch journals its attempt and a settlement carrying the backoff instant, the guard holds a re-park on that same
 * condition once a seat came up, and a broken wake journal stops a wake that depends on it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, unwrap } from "#lib/result.js";

import { reparkGuard, reseatClaimed } from "../../../../../cli/commands/handover/wakeReseat.js";
import { retryTarget, wakeJournalFault } from "../../../../../cli/commands/handover/wakeRetry.js";
import type { HandoverWakeDeps } from "../../../../../cli/commands/handover/wakeRows.js";
import { WorktreeCommitErrors } from "../../../../../cli/commands/handover/wakeWorktreeCommit.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { WakeObservation } from "../../../../../handover/parkWake.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { type WakeCandidate, wakeCandidates } from "../../../../../handover/wakeCandidates.js";
import { readWakeJournal } from "../../../../../handover/wakeJournalStore.js";

const NOW = "2026-10-15T03:13:00.000Z";
const WAKE_AT = "2026-10-15T03:00:00Z";
const RETRY_AFTER = "2026-10-15T03:18:00.000Z";
const OBSERVED: WakeObservation = { atIso: WAKE_AT, kind: "at" };

describe("wake reseat and retry", () => {
  let home: string;
  let runsDir: string;
  let diagnostics: string[];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "wake-reseat-"));
    runsDir = join(home, "runs");
    mkdirSync(join(home, "handovers"), { recursive: true });
    mkdirSync(runsDir, { recursive: true });
    diagnostics = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** A doc on the board whose seat parked on a clock wake, and the scan's one candidate for it. */
  function parkedCandidate({ slug }: { slug: string }): WakeCandidate {
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
        wake: { atIso: WAKE_AT, kind: "at" },
        workspaceRef: "workspace:238",
        worktree: `/wt/${slug}`,
      },
    ] as const;
    for (const event of events) {
      unwrap(appendRunEvent({ event, runsDir, slug }));
    }
    return unwrap(wakeCandidates({ home, rerunAllowed: false })).candidates.find(
      (candidate) => candidate.slug === slug,
    )!;
  }

  /** The deps the reseat and retry halves read: a fixed clock, one nonce, a backoff instant, captured diagnostics. */
  function deps(): HandoverWakeDeps {
    return {
      bootsInFlight: () => 0,
      close: () => undefined,
      finish: () => Promise.reject(new Error("no merged park is finished in this file")),
      readBranch: () => ok(null),
      readOrigin: () => err(["no origin is read in this file"]),
      readWorktreeCommit: () =>
        err(WorktreeCommitErrors.unreadable({ message: "no worktree commit is read in this file" })),
      readPrHead: () => Promise.reject(new Error("no head is read in this file")),
      mergeProof: () => err({ message: "no merge is proved in this file" }),
      nonce: () => "n-1",
      probeTreeOf: () => "session-worktree",
      now: () => new Date(NOW),
      readChecks: () => () => Promise.reject(new Error("no checks read in this file")),
      rerunAllowed: false,
      reseat: () => Promise.reject(new Error("the launch is injected, never reseat")),
      retryAfter: () => ok(RETRY_AFTER),
      sleep: async () => {},
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: () => {},
    };
  }

  it("journals a deferred launch's attempt and a settlement carrying the backoff instant", async () => {
    const candidate = parkedCandidate({ slug: "alpha" });

    const outcome = await reseatClaimed({
      candidate,
      deps: deps(),
      home,
      launch: async () => ({ action: "spawn-deferred", detail: "backoff" }),
      observed: OBSERVED,
    });

    expect([outcome.action, outcome.attemptNonce, outcome.retryAfterIso]).toEqual([
      "spawn-deferred",
      "n-1",
      RETRY_AFTER,
    ]);
    const rows = unwrap(readWakeJournal({ home }));
    expect(rows.map((row) => [row.kind, row.nonce])).toEqual([
      ["attempt", "n-1"],
      ["settled", "n-1"],
    ]);
  });

  it("holds a re-park on the condition a reseat that came up already acted on", async () => {
    const first = parkedCandidate({ slug: "beta" });
    await reseatClaimed({
      candidate: first,
      deps: deps(),
      home,
      launch: async () => {
        unwrap(
          appendRunEvent({
            event: { atIso: "2026-10-15T03:14:00.000Z", by: "cmux spawn", kind: "dispatched", target: "workspace:9" },
            runsDir,
            slug: "beta",
          }),
        );
        return { action: "spawned", detail: "seat booted" };
      },
      observed: OBSERVED,
    });
    unwrap(
      appendRunEvent({
        event: {
          atIso: "2026-10-15T03:15:00.000Z",
          branch: "beta",
          kind: "parked",
          screenTail: "❯ ",
          sessionId: "s-beta",
          wake: { atIso: WAKE_AT, kind: "at" },
          workspaceRef: "workspace:9",
          worktree: "/wt/beta",
        },
        runsDir,
        slug: "beta",
      }),
    );
    const repark = unwrap(wakeCandidates({ home, rerunAllowed: false })).candidates.find(
      (candidate) => candidate.slug === "beta",
    )!;

    const guard = unwrap(reparkGuard({ candidate: repark, home, observed: OBSERVED }));

    expect(guard.kind).toBe("acted");
  });

  it("reads a new condition when no reseat has acted on the park", () => {
    const candidate = parkedCandidate({ slug: "gamma" });

    expect(unwrap(reparkGuard({ candidate, home, observed: OBSERVED }))).toEqual({ kind: "new" });
  });

  it("stops a wake that depends on a wake journal that will not read, and reads nothing when it does not", () => {
    mkdirSync(join(home, "ledgers"), { recursive: true });
    writeFileSync(join(home, "ledgers", "handover-wake.jsonl"), '{"kind":"attempt"\n');

    expect([
      wakeJournalFault({ deps: deps(), home, required: false }),
      wakeJournalFault({ deps: deps(), home, required: true }),
    ]).toEqual([false, true]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("no park reseats until it is repaired");
  });

  it("stops a retry on a nonce the journal never recorded with a usage exit", async () => {
    const target = await retryTarget({ deps: deps(), dryRun: false, home, nonce: "n-unknown" });

    expect(target).toEqual({ exit: EXIT_USAGE, kind: "stop" });
  });
});
