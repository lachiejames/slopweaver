/**
 * `github hold` and `github release`'s effectful shell, with every edge injected as a plain fake — no mocks.
 * The hold document is an in-memory array a fake reads and writes, so a test asserts what was WRITTEN rather
 * than what was printed about it.
 */
import { describe, expect, it } from "vitest";
import { type MergeHoldDeps, noteStaleHolds } from "../../../../../cli/commands/github/holdDeps.js";
import {
  releaseHeldPullRequest,
  releaseHold,
  runGithubHold,
  runGithubRelease,
} from "../../../../../cli/commands/github/holdRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { SupervisorEvent } from "../../../../../events/event.js";
import { err, ok } from "../../../../../lib/result.js";
import { type Measured, measured, unmeasurable } from "../../../../../measurement/status.js";
import type { HoldLedgerRow } from "../../../../../outbound/github/holdLedger.js";
import { DEFAULT_HOLD_STALE_MINUTES, type MergeHold } from "../../../../../outbound/github/mergeHold.js";

const NOW = "2026-08-28T02:00:00.000Z";
const HOME = "/home";

/** One standing hold; a case overrides only the field it is about. */
function hold(over: Partial<MergeHold> = {}): MergeHold {
  return {
    atIso: "2026-08-28T01:00:00.000Z",
    holder: "a-session",
    pr: 32,
    repo: "owner/name",
    staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
    staleWarnedAtIso: undefined,
    why: "rebase hell",
    ...over,
  };
}

/** What one run observed: the document as it now stands, every published event, and every printed line. */
interface Harness {
  readonly deps: MergeHoldDeps;
  readonly events: SupervisorEvent[];
  readonly lines: string[];
  readonly stored: () => readonly MergeHold[];
  readonly journalled: () => readonly HoldLedgerRow[];
}

/** Build the injected edges over a starting document, defaulting the clock and the session id. */
function harness(
  over: {
    holds?: readonly MergeHold[];
    nowIso?: string;
    writeFails?: boolean;
    ledgerFails?: boolean;
    holderLive?: Measured<boolean>;
    rows?: readonly HoldLedgerRow[];
  } = {},
): Harness {
  // Each field of `over` is read where, and as often as, the harness always read it: the starting document, then
  // the holder's liveness, then the ledger rows, and the clock on every call.
  const { holds: standing = [] } = over;
  let holds: readonly MergeHold[] = standing;
  const { holderLive = measured({ value: true }) } = over;
  const events: SupervisorEvent[] = [];
  const lines: string[] = [];
  const { rows: journalled = [] } = over;
  const rows: HoldLedgerRow[] = [...journalled];
  const deps: MergeHoldDeps = {
    appendLedgerRow: ({ row }) => {
      if (over.ledgerFails === true) {
        return err(["the hold ledger could not be appended to"]);
      }
      rows.push(row);
      return ok(undefined);
    },
    holderLive: () => holderLive,
    nowIso: () => {
      const { nowIso = NOW } = over;
      return nowIso;
    },
    out: ({ line }) => lines.push(line),
    publish: ({ event }) => events.push(event),
    readHolds: () => holds,
    readLedgerRows: ({ limit }) => rows.slice(-limit),
    sessionId: () => "this-session",
    writeHolds: ({ holds: next }) => {
      if (over.writeFails === true) {
        return err(["the document could not be written"]);
      }
      holds = next;
      return ok(undefined);
    },
  };
  return { deps, events, journalled: () => rows, lines, stored: () => holds };
}

/** A clock at which the fixture hold is still fresh, so a placement test sees no incidental stale warning. */
const FRESH = "2026-08-28T01:05:00.000Z";

/** A full `github hold` argv, since the verb slices four leading tokens off it. */
function holdArgv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "github", "hold", ...rest];
}

/** A full `github release` argv, for the same reason. */
function releaseArgv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "github", "release", ...rest];
}

describe("runGithubHold", () => {
  it("writes the hold, stamped with this session and this clock", () => {
    const h = harness();

    const code = runGithubHold({
      argv: holdArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--why", "rebase hell", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.stored()).toEqual([
      {
        atIso: NOW,
        holder: "this-session",
        pr: 32,
        repo: "owner/name",
        staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
        staleWarnedAtIso: undefined,
        why: "rebase hell",
      },
    ]);
  });

  it("publishes `held` so a supervisor learns of it without being told", () => {
    const h = harness();

    runGithubHold({
      argv: holdArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--why", "rebase hell", "--home", HOME] }),
      deps: h.deps,
    });

    expect(h.events.map((event) => `${event.source}/${event.kind}`)).toEqual(["github-hold/held"]);
  });

  it("labels a hold placed outside a visible session rather than refusing it", () => {
    const h = harness();
    const deps: MergeHoldDeps = { ...h.deps, sessionId: () => undefined };

    runGithubHold({
      argv: holdArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--why", "x", "--home", HOME] }),
      deps,
    });

    expect(h.stored()[0]!.holder).toBe("an unidentified session");
  });

  it("refuses a second hold on the same repository, naming the one that stands", () => {
    const h = harness({ holds: [hold()], nowIso: FRESH });

    const code = runGithubHold({
      argv: holdArgv({ rest: ["--pr", "41", "--repo", "owner/name", "--why", "me too", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.stored()).toEqual([hold()]);
    expect(h.lines[0]).toContain("owner/name#32 already holds this repository's merge queue");
  });

  it("holds a DIFFERENT repository alongside, because the partition is two repositories", () => {
    const h = harness({ holds: [hold()], nowIso: FRESH });

    const code = runGithubHold({
      argv: holdArgv({ rest: ["--pr", "7", "--repo", "owner/other", "--why", "its own reason", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.stored().map((entry) => `${entry.repo}#${String(entry.pr)}`)).toEqual(["owner/name#32", "owner/other#7"]);
  });

  it("re-holding the SAME pull request succeeds and publishes nothing new", () => {
    const h = harness({ holds: [hold()], nowIso: FRESH });

    const code = runGithubHold({
      argv: holdArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--why", "again", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.events).toEqual([]);
    expect(h.stored()).toEqual([hold()]);
  });

  it("refuses when the document cannot be written, rather than reporting a hold that does not exist", () => {
    const h = harness({ writeFails: true });

    const code = runGithubHold({
      argv: holdArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--why", "x", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.events).toEqual([]);
    expect(h.lines[0]).toBe("refused: the document could not be written");
  });

  it("reports usage and exits 2 on a rejected invocation, having written nothing", () => {
    const h = harness();

    const code = runGithubHold({ argv: holdArgv({ rest: ["--pr", "32"] }), deps: h.deps });

    expect(code).toBe(EXIT_USAGE);
    expect(h.stored()).toEqual([]);
  });

  it("--status prints every standing hold and its age", () => {
    const h = harness({ holds: [hold()] });

    const code = runGithubHold({ argv: holdArgv({ rest: ["--status", "--home", HOME] }), deps: h.deps });

    expect(code).toBe(EXIT_OK);
    expect(h.lines).toEqual(["owner/name#32\theld 60m STALE\tby a-session\trebase hell"]);
  });

  it("--status --json carries the computed age and staleness a caller would otherwise recompute", () => {
    const h = harness({ holds: [hold()] });

    runGithubHold({ argv: holdArgv({ rest: ["--status", "--json", "--home", HOME] }), deps: h.deps });

    expect(JSON.parse(h.lines[0]!).holds[0].ageMinutes).toBe(60);
    expect(JSON.parse(h.lines[0]!).holds[0].stale).toBe(true);
  });

  it("--status flags a holder that is no longer a live session, and names the release command", () => {
    const h = harness({ holderLive: measured({ value: false }), holds: [hold()], nowIso: FRESH });

    runGithubHold({ argv: holdArgv({ rest: ["--status", "--home", HOME] }), deps: h.deps });

    expect(h.lines).toEqual([
      "owner/name#32\theld 5m\tby a-session GONE\trebase hell",
      "  its holder a-session is not in the live-session registry — nobody is landing #32. " +
        "Release it with `slopweaver github release --pr 32 --repo owner/name` once you have checked whether it landed.",
    ]);
  });

  it("--status leaves a gone holder's hold standing — it reports, it does not expire", () => {
    const h = harness({ holderLive: measured({ value: false }), holds: [hold()], nowIso: FRESH });

    runGithubHold({ argv: holdArgv({ rest: ["--status", "--home", HOME] }), deps: h.deps });

    expect(h.stored()).toEqual([hold()]);
  });

  it("--status --json carries the holder's liveness verdict, not a flattened boolean", () => {
    const h = harness({
      holderLive: unmeasurable<boolean>({ why: "the registry would not decode" }),
      holds: [hold()],
      nowIso: FRESH,
    });

    runGithubHold({ argv: holdArgv({ rest: ["--status", "--json", "--home", HOME] }), deps: h.deps });

    expect(JSON.parse(h.lines[0]!).holds[0].holderGone).toBe(false);
    expect(JSON.parse(h.lines[0]!).holds[0].holderLive).toEqual({
      known: false,
      why: "the registry would not decode",
    });
  });

  it("journals a `held` row carrying the pull request, the session and the instant", () => {
    const h = harness();

    runGithubHold({
      argv: holdArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--why", "rebase hell", "--home", HOME] }),
      deps: h.deps,
    });

    expect(h.journalled()).toEqual([
      {
        atIso: NOW,
        heldAtIso: NOW,
        heldMinutes: 0,
        holder: "this-session",
        kind: "held",
        pr: 32,
        repo: "owner/name",
        schemaVersion: 1,
        sha: undefined,
        staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
        why: "rebase hell",
      },
    ]);
  });

  it("journals nothing for a hold it refused, so the ledger records holds that stood", () => {
    const h = harness({ holds: [hold()], nowIso: FRESH });

    runGithubHold({
      argv: holdArgv({ rest: ["--pr", "41", "--repo", "owner/name", "--why", "mine", "--home", HOME] }),
      deps: h.deps,
    });

    expect(h.journalled()).toEqual([]);
  });

  it("warns about a failed ledger append rather than failing the hold it just placed", () => {
    const h = harness({ ledgerFails: true });

    const code = runGithubHold({
      argv: holdArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--why", "rebase hell", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.lines[0]).toBe("warning: the hold ledger could not be appended to");
    expect(h.stored()).toHaveLength(1);
  });

  it("--history prints the journalled rows a released hold would otherwise have taken with it", () => {
    const h = harness();
    runGithubHold({
      argv: holdArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--why", "rebase hell", "--home", HOME] }),
      deps: h.deps,
    });
    h.lines.length = 0;

    const code = runGithubHold({ argv: holdArgv({ rest: ["--history", "--home", HOME] }), deps: h.deps });

    expect(code).toBe(EXIT_OK);
    expect(h.lines).toEqual([`${NOW}\theld\towner/name#32\t0m\tby this-session\trebase hell`]);
  });

  it("--history says plainly that nothing has ever held this home's queue", () => {
    const h = harness();

    runGithubHold({ argv: holdArgv({ rest: ["--history", "--home", HOME] }), deps: h.deps });

    expect(h.lines).toEqual([
      "no hold has been journalled in this home: nothing has held the merge queue through the door.",
    ]);
  });

  it("--history --limit bounds what it reports to the most recent rows", () => {
    const h = harness();
    for (const pr of ["32", "41"]) {
      runGithubHold({
        argv: holdArgv({ rest: ["--pr", pr, "--repo", `owner/name-${pr}`, "--why", "w", "--home", HOME] }),
        deps: h.deps,
      });
    }
    h.lines.length = 0;

    runGithubHold({ argv: holdArgv({ rest: ["--history", "--limit", "1", "--home", HOME] }), deps: h.deps });

    expect(h.lines).toEqual([`${NOW}\theld\towner/name-41#41\t0m\tby this-session\tw`]);
  });

  it("refuses --status --history together rather than silently picking one tense", () => {
    const h = harness();

    const code = runGithubHold({ argv: holdArgv({ rest: ["--status", "--history", "--home", HOME] }), deps: h.deps });

    expect(code).toBe(EXIT_USAGE);
    expect(h.lines[0]).toBe(
      "--status reports what is held NOW and --history what has been held; ask for one or the other",
    );
  });

  it("refuses --history alongside a placement flag, so a placement is never downgraded to a report", () => {
    const h = harness();

    const code = runGithubHold({
      argv: holdArgv({ rest: ["--history", "--pr", "32", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.lines[0]).toBe("--history reports and places nothing, so it refuses --pr");
  });

  it("refuses --limit on a placement, where it means nothing", () => {
    const h = harness();

    const code = runGithubHold({
      argv: holdArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--why", "w", "--limit", "5", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(h.lines[0]).toBe("--limit bounds the --history journal and means nothing when placing a hold");
    expect(h.stored()).toEqual([]);
  });
});

describe("noteStaleHolds", () => {
  it("publishes one warning for a hold past its threshold and marks it", () => {
    const h = harness({ holds: [hold()] });

    const after = noteStaleHolds({ deps: h.deps, holds: [hold()], home: HOME });

    expect(h.events.map((event) => event.kind)).toEqual(["stale"]);
    expect(after[0]!.staleWarnedAtIso).toBe(NOW);
    expect(h.stored()[0]!.staleWarnedAtIso).toBe(NOW);
  });

  it("publishes nothing the second time, so eight readers produce one warning", () => {
    const h = harness({ holds: [hold()] });

    noteStaleHolds({ deps: h.deps, holds: h.stored(), home: HOME });
    noteStaleHolds({ deps: h.deps, holds: h.stored(), home: HOME });

    expect(h.events.map((event) => event.kind)).toEqual(["stale"]);
  });

  it("writes nothing at all while every hold is fresh", () => {
    const h = harness({ holds: [hold()], nowIso: FRESH, writeFails: true });

    const after = noteStaleHolds({ deps: h.deps, holds: [hold()], home: HOME });

    expect(after).toEqual([hold()]);
    expect(h.lines).toEqual([]);
  });

  it("warns about a failed write rather than sinking the caller that was doing something else", () => {
    const h = harness({ holds: [hold()], writeFails: true });

    const after = noteStaleHolds({ deps: h.deps, holds: [hold()], home: HOME });

    expect(after[0]!.staleWarnedAtIso).toBe(NOW);
    expect(h.lines).toEqual(["warning: the document could not be written"]);
  });

  it("journals a `stale` row carrying how long the hold had already stood", () => {
    const h = harness({ holds: [hold()] });

    noteStaleHolds({ deps: h.deps, holds: [hold()], home: HOME });

    expect(h.journalled().map((row) => [row.kind, row.heldMinutes, row.holder])).toEqual([["stale", 60, "a-session"]]);
  });

  it("journals one `stale` row however many readers look, matching the one warning", () => {
    const h = harness({ holds: [hold()] });

    noteStaleHolds({ deps: h.deps, holds: h.stored(), home: HOME });
    noteStaleHolds({ deps: h.deps, holds: h.stored(), home: HOME });

    expect(h.journalled()).toHaveLength(1);
  });
});

describe("runGithubRelease", () => {
  it("clears the hold and publishes `released` with the landed commit", () => {
    const h = harness({ holds: [hold()] });

    const code = runGithubRelease({
      argv: releaseArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--sha", "abc1234", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.stored()).toEqual([]);
    expect(h.events[0]!.why).toContain("landed as abc1234");
  });

  it("says so plainly when no landed commit was recorded", () => {
    const h = harness({ holds: [hold()] });

    runGithubRelease({
      argv: releaseArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--home", HOME] }),
      deps: h.deps,
    });

    expect(h.events[0]!.why).toContain("no landed commit was recorded");
  });

  it("refuses to release a hold held for a DIFFERENT pull request", () => {
    const h = harness({ holds: [hold()] });

    const code = runGithubRelease({
      argv: releaseArgv({ rest: ["--pr", "41", "--repo", "owner/name", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.stored()).toEqual([hold()]);
    expect(h.events).toEqual([]);
  });

  it("succeeds quietly when nothing is held, so a release is safe to run twice", () => {
    const h = harness();

    const code = runGithubRelease({
      argv: releaseArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--home", HOME] }),
      deps: h.deps,
    });

    expect(code).toBe(EXIT_OK);
    expect(h.lines).toEqual(["no merge hold stands on owner/name."]);
  });

  it("journals a `released` row carrying the duration and the landed commit", () => {
    const h = harness({ holds: [hold()] });

    runGithubRelease({
      argv: releaseArgv({ rest: ["--pr", "32", "--repo", "owner/name", "--sha", "abc1234", "--home", HOME] }),
      deps: h.deps,
    });

    expect(h.journalled().filter((row) => row.kind === "released")).toEqual([
      {
        atIso: NOW,
        heldAtIso: "2026-08-28T01:00:00.000Z",
        heldMinutes: 60,
        holder: "a-session",
        kind: "released",
        pr: 32,
        repo: "owner/name",
        schemaVersion: 1,
        sha: "abc1234",
        staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
        why: "rebase hell",
      },
    ]);
  });

  it("journals no `released` row for a release it refused", () => {
    const h = harness({ holds: [hold()], nowIso: FRESH });

    runGithubRelease({
      argv: releaseArgv({ rest: ["--pr", "41", "--repo", "owner/name", "--home", HOME] }),
      deps: h.deps,
    });

    expect(h.journalled()).toEqual([]);
  });

  it("leaves another repository's hold exactly where it is", () => {
    const h = harness({ holds: [hold(), hold({ pr: 7, repo: "owner/other" })] });

    releaseHold({ deps: h.deps, home: HOME, pr: 32, repo: "owner/name", sha: undefined });

    expect(h.stored()).toEqual([hold({ pr: 7, repo: "owner/other" })]);
  });
});

describe("releaseHeldPullRequest", () => {
  it("clears the hold when the merge that landed WAS the held pull request", () => {
    const h = harness({ holds: [hold()] });

    releaseHeldPullRequest({ deps: h.deps, home: HOME, pr: 32, repo: "owner/name", sha: "abc1234" });

    expect(h.stored()).toEqual([]);
  });

  it("leaves a hold standing when some OTHER pull request merged past it", () => {
    const h = harness({ holds: [hold()] });

    releaseHeldPullRequest({ deps: h.deps, home: HOME, pr: 41, repo: "owner/name", sha: "abc1234" });

    expect(h.stored()).toEqual([hold()]);
    expect(h.lines).toEqual([]);
  });

  it("says nothing at all when no hold stood, so an ordinary merge stays quiet", () => {
    const h = harness();

    releaseHeldPullRequest({ deps: h.deps, home: HOME, pr: 32, repo: "owner/name", sha: "abc1234" });

    expect(h.lines).toEqual([]);
    expect(h.events).toEqual([]);
  });
});
