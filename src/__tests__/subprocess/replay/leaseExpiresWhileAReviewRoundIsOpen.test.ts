/**
 * REPLAY LANE — the turn whose lease ran out 1.022 seconds before its reviewer's verdict landed.
 *
 * The fixture (`fixtures/replay/lease-expires-while-a-review-round-is-open`) is that ask's own record set
 * frozen through its `dispatched` event, with its clock stopped at the instant round 1's verdict was written:
 * a two-hour lease, a `fresh-visible-session` decision on `workspace:152`,
 * and round 1's archived verdict — `broken` — beside the answer bytes it read.
 *
 * What made this an incident is the SHAPE of that moment rather than its timing. Round 1 had returned, so
 * `reviewPostureOf`'s `inFlight` was false; a `broken` verdict is not a usable one, so `hasUsableVerdict` was
 * false too; and the review record's `releasedAt` was not stamped until 05:17:02.952Z. Between those two
 * instants `leaseState` fell straight through to the wall clock over a review that was plainly still running,
 * and any sweep lap landing there would have finalised a turn mid fix-and-re-review. Three laps did land in
 * that window on this ask — 04:39:27–04:39:29, 04:55:19–04:59:07 and 05:12:31–05:14:53 — for 9m41s of
 * exposure.
 *
 * ## What this pins, and what it deliberately does NOT claim
 *
 * `live/turn/leaseJudgement.ts` now holds the clock for exactly that window: an OPEN review RECORD holds it
 * whatever the current round's verdict says, capped at `MAX_REVIEW_HOLD_HOURS` from that round's own spawn.
 * The four cases below drive the shipped `turn dispatch --sweep` over the frozen world and pin all four
 * edges — no record expires, an open record holds, the cap hands the clock back, and so does a release.
 *
 * This turn was NOT in fact ended by the sweep. Its ask lifecycle log carries no `lease-expired` row at all:
 * the dispatch ended at 05:14:53.484Z on a `failed` row written by `turn answer` itself, carrying the admit
 * door's refusal text. That is a different defect with a different blast radius and it has its own board row.
 * What is fixed and pinned here is the class the finding named, which was live on this ask for those 9m41s.
 *
 * ## A frozen verdict cannot be REPLAYED as a verdict, and the reason matters here
 *
 * The freeze's allowlist redacts every claim's `readAtIso`, so the committed verdict no longer satisfies
 * `parseReviewVerdict` — `readVerdictFile` classifies it `invalid`, never `present`. That is not a defect in
 * the fixture: `readAtIso` is a timestamp inside free-prose evidence and the allowlist is a whitelist by
 * construction. It matters because `invalid` and `absent` both leave `inFlight` TRUE, so a case that staged
 * the frozen bytes verbatim would hold the clock through the MID-VERDICT branch and pass while proving
 * nothing about this fix. So round 1 is rebuilt from the fields the freeze does preserve — its `answerDigest`
 * and its `outcome`, both asserted against the file below — and the posture that results is asserted whole.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReviewVerdict } from "../../../admit/reviewVerdict.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { MAX_REVIEW_HOLD_HOURS } from "../../../live/turn/leaseJudgement.js";
import type { ReviewRecord } from "../../../live/turn/review.js";
import { reviewPostureOf } from "../../../live/turn/reviewPosture.js";
import { markReviewerReleased, reviewPaths, writeReview } from "../../../live/turn/reviewStore.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "lease-expires-while-a-review-round-is-open";
const FIXTURE_ROOT = join(repoRoot, "src", "__tests__", "fixtures", "replay", SLUG);
const FROZEN_REVIEW_DIR = join(FIXTURE_ROOT, "home/live/slack/reviews/CFIXTUREAA-1789952379.135579");

/** The lease this ask was dispatched under, from the frozen dispatch record. */
const LEASE_EXPIRES_AT = "2026-09-21T04:39:27.978Z";

/**
 * The fixture's own `replayNowIso` — the instant round 1's verdict was written, 1.022 seconds after
 * {@link LEASE_EXPIRES_AT}. Every case below judges the world at this instant unless it is testing a cap.
 */
const AT_THE_INCIDENT = "2026-09-21T04:39:29.000Z";

/** Round 1's reviewer's own spawn instant, from its archived verdict's filename. */
const ROUND_1_SPAWNED_AT = "2026-09-21T04:28:41.703Z";

/** Round 1's archived verdict, exactly as the reviewer wrote it — `broken`, bound to the answer it read. */
const ROUND_1_VERDICT_FILE = join(
  FROZEN_REVIEW_DIR,
  "verdict-superseded-fixture-uuid-dp-2026-09-21T04-28-41-703Z.json",
);

/** The answer bytes round 1 reviewed, kept beside its verdict by `writeReviewedAnswer`. */
const ROUND_1_ANSWER_FILE = join(
  FROZEN_REVIEW_DIR,
  "answer-reviewed-sha256-5e2f925c518427fdfb0a88b6a4c1f4b9c3422e83b40d70b5913dc10ede216d23.json",
);

/** When the real turn stamped `releasedAt` on this review — 37 minutes of open record after round 1 returned. */
const RELEASED_AT = "2026-09-21T05:17:02.952Z";

/** A moment after that release, and still well inside the cap, so a hold here would have to come from the record. */
const JUST_AFTER_RELEASE = "2026-09-21T05:17:03.000Z";

/**
 * An instant past `ROUND_1_SPAWNED_AT + MAX_REVIEW_HOLD_HOURS`, where the between-rounds hold lapses and the
 * dispatched lease decides again. Derived rather than typed, so moving the cap moves this with it.
 */
const PAST_THE_REVIEW_HOLD_CAP = new Date(
  Date.parse(ROUND_1_SPAWNED_AT) + (MAX_REVIEW_HOLD_HOURS + 1) * 60 * 60 * 1000,
).toISOString();

/** The line the sweep prints for the hold an OPEN review record buys between two rounds. */
const HELD_BETWEEN_ROUNDS =
  "lease held open (not expired): CFIXTUREAA/1789952379.135579 — a review round has returned but the review " +
  "is not released — the worker is inside the fix-and-re-review loop a broken verdict opens";

/** The sweep's own summary line when the one ask in this home was abandoned on its lease. */
const SWEEP_EXPIRED =
  "sweep: 0 ready, 0 still working, 0 in-review, 0 worker-failed, 0 phantom, 1 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored";

/** The same line when something still holds the clock. Asserted whole: the summary always names every count. */
const SWEEP_STILL_WORKING =
  "sweep: 0 ready, 1 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored";

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-open-round-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, in an environment carrying none of this
 * machine's real config — no Slack token, and a cmux socket that does not exist.
 *
 * @param args the argv tail
 * @returns the exit status and both streams, already joined for assertion
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; output: string } {
  try {
    const stdout = execFileSync(BIN, args, {
      cwd: workspace,
      encoding: "utf8",
      env: { CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"), HOME: workspace, PATH: process.env["PATH"]! },
      maxBuffer: 8 * 1024 * 1024,
    });
    return { output: stdout, status: 0 };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { output: `${e.stdout}${e.stderr}`, status: e.status };
  }
}

/** Materialise the fixture and hand back the ask every verb below is addressed by. */
function materialiseAtDispatch(): AskIdentity {
  const manifest = materialiseFixture({ into: home, slug: SLUG });
  return { channel: manifest.ask.channel, messageTs: manifest.ask.messageTs, threadTs: manifest.ask.threadTs };
}

/** The reviewer locator this lane's rebuilt round records — a plain address, never a claim about progress. */
const REVIEWER = {
  host: "claude-code" as const,
  surfaceId: "fixture-reviewer-surface",
  surfaceRef: "surface:163",
  workspaceId: "fixture-reviewer-workspace",
  workspaceRef: "workspace:154",
};

/** How the rebuilt packet names the reviewer — what its verdict must carry back as `reviewerSession`. */
const REVIEWER_SESSION = `reviewer workspace ${REVIEWER.workspaceRef} (${REVIEWER.workspaceId})`;

/** How the rebuilt packet names the author. */
const AUTHOR_SESSION = "author claude-code session fixture-worker";

/**
 * The two fields of round 1's archived verdict the freeze preserves whole — what the rebuilt round below is
 * anchored to, read straight off the committed file rather than restated.
 *
 * @returns the digest that round bound itself to, and the outcome it returned
 */
function frozenRoundOne(): { readonly answerDigest: string; readonly outcome: string } {
  const raw = JSON.parse(readFileSync(ROUND_1_VERDICT_FILE, "utf8")) as {
    answerDigest: string;
    outcome: string;
  };
  return { answerDigest: raw.answerDigest, outcome: raw.outcome };
}

/**
 * Put round 1 back the way it stood at {@link AT_THE_INCIDENT}: a record through the REAL review store, a
 * `broken` verdict at the path that record names, and the bytes that round read at the path it points to.
 *
 * The real record is outside the freeze window — it was rewritten for round 3 — and the archived
 * verdict does not parse once redacted, so both are rebuilt here around the digest and outcome the file does
 * carry. Sessions are this lane's own, matched on both sides so `readVerdictFile` classifies the verdict
 * `present` for this record rather than `superseded`: a reviewer's verdict counts only for the round that
 * addressed it.
 *
 * @param askIdentity the ask being reviewed
 * @returns the record as written, for a caller that wants to release it
 */
function stageRoundOne({ askIdentity }: { askIdentity: AskIdentity }): ReviewRecord {
  const paths = reviewPaths({ askIdentity, home });
  const frozen = frozenRoundOne();
  const record: ReviewRecord = {
    ...askIdentity,
    answerDigest: frozen.answerDigest,
    answerPath: join(home, "answer.json"),
    authorSession: AUTHOR_SESSION,
    carriedUnresolved: [],
    packetPath: paths.packet,
    reviewer: REVIEWER,
    reviewerSession: REVIEWER_SESSION,
    round: 1,
    schemaVersion: 2,
    spawnedAt: ROUND_1_SPAWNED_AT,
    verdictPath: paths.verdict,
  };
  writeReview({ home, packet: "the packet this lane does not read", record });
  const verdict: ReviewVerdict = {
    answerDigest: frozen.answerDigest,
    authorSession: AUTHOR_SESSION,
    claims: [
      {
        impact: "high",
        support: "unsupported",
        text: "the answer does not yet name what the ask existed for",
      },
    ],
    outcome: "broken",
    reviewerSession: REVIEWER_SESSION,
    schemaVersion: 1,
    voice: { pathsChecked: ["lead", "body"], rulesChecked: 4, violations: [] },
  };
  writeFileSync(paths.verdict, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
  copyFileSync(ROUND_1_ANSWER_FILE, record.answerPath);
  return record;
}

/** Sweep the materialised home at one instant. */
function sweepAt({ nowIso }: { nowIso: string }): { status: number; output: string } {
  return runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", nowIso, "--home", home] });
}

describe("replay: lease-expires-while-a-review-round-is-open", () => {
  it("froze the state BEFORE the defect fired — a lapsed lease, an open round, and none of the endings", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    expect(manifest.through).toBe("dispatched");
    expect(manifest.withheldEventKinds).toEqual(["failed", "answered"]);
    expect(manifest.regresses).toEqual(["bot-answer-review-rounds-uncapped"]);
    // The clock is stopped at the instant round 1's verdict landed, which is 1.022s past the lease — so the
    // fixture's own `replayNowIso` IS the moment under test, not an instant chosen to make a case pass.
    expect(manifest.replayNowIso).toBe(AT_THE_INCIDENT);
    expect(Date.parse(AT_THE_INCIDENT)).toBeGreaterThan(Date.parse(LEASE_EXPIRES_AT));
    // The review record, the live verdict and the turn marker every later round wrote are all withheld: what
    // survives is round 1's ARCHIVED verdict and the bytes it read, which is the whole state at that moment.
    expect(manifest.files).toEqual([
      "home/live/slack/asks.jsonl",
      "home/briefs/CFIXTUREAA-1789952379.135579.json",
      "home/live/slack/dispatches/CFIXTUREAA-1789952379.135579.json",
      "home/live/slack/checkpoints/CFIXTUREAA-1789952379.135579/draft-sha256-5e2f925c518427fdfb0a88b6a4c1f4b9c3422e83b40d70b5913dc10ede216d23.json",
      "home/live/slack/checkpoints/CFIXTUREAA-1789952379.135579/log.jsonl",
      "home/live/slack/reviews/CFIXTUREAA-1789952379.135579/answer-reviewed-sha256-5e2f925c518427fdfb0a88b6a4c1f4b9c3422e83b40d70b5913dc10ede216d23.json",
      "home/live/slack/reviews/CFIXTUREAA-1789952379.135579/verdict-superseded-fixture-uuid-dp-2026-09-21T04-28-41-703Z.json",
    ]);
  });

  it("abandons the turn at the dispatched lease when no review record stands over it at all", () => {
    // The witness that a hold needs a RECORD. The same instant holds in the next case, and the only
    // difference between the two worlds is the two files `stageRoundOne` writes.
    materialiseAtDispatch();
    expect(sweepAt({ nowIso: AT_THE_INCIDENT }).output).toContain(SWEEP_EXPIRED);
  });

  it("holds the clock at that same instant once round 1's BROKEN verdict sits on an unreleased record", () => {
    // The incident itself. This used to report `lease-expired` and finalise a turn whose worker
    // was about to open round 2 — which it did, and again for round 3.
    const askIdentity = materialiseAtDispatch();
    const record = stageRoundOne({ askIdentity });

    // The rebuilt round really is the frozen one: same digest, and the outcome the real reviewer returned.
    expect(frozenRoundOne()).toEqual({
      answerDigest: "sha256:5e2f925c518427fdfb0a88b6a4c1f4b9c3422e83b40d70b5913dc10ede216d23",
      outcome: "broken",
    });
    expect(record.answerDigest).toBe(frozenRoundOne().answerDigest);

    // The posture the hold has to come from, read through the one on-disk reader. `inFlight` is FALSE here:
    // round 1 has written its verdict, so the mid-verdict hold cannot be what saves this turn, and neither
    // can the usable-verdict one over a `broken` outcome. Only `recordOpen` is true.
    expect(reviewPostureOf({ askIdentity, home })).toEqual({
      hasUsableVerdict: false,
      inFlight: false,
      recordOpen: true,
      spawnedAt: ROUND_1_SPAWNED_AT,
    });

    const swept = sweepAt({ nowIso: AT_THE_INCIDENT });
    expect(swept.output).toContain(HELD_BETWEEN_ROUNDS);
    expect(swept.output).toContain(SWEEP_STILL_WORKING);
  });

  it("hands the same turn back to the clock once round 1's own cap has run out", () => {
    // The falsifiable half: the between-rounds hold is a cap measured from the round's spawn, not a second
    // lease, so the identical world expires past `spawnedAt + MAX_REVIEW_HOLD_HOURS`.
    const askIdentity = materialiseAtDispatch();
    stageRoundOne({ askIdentity });
    expect(sweepAt({ nowIso: PAST_THE_REVIEW_HOLD_CAP }).output).toContain(SWEEP_EXPIRED);
  });

  it("still holds at the real release instant while the record is open, and expires the moment it is stamped", () => {
    // Both halves at ONE instant, inside the cap, so the only thing that moves is `releasedAt`. The real turn
    // stamped it at 05:17:02.952Z — 37 minutes of open record after round 1 returned, every second of which
    // the old code would have called expired.
    const askIdentity = materialiseAtDispatch();
    const record = stageRoundOne({ askIdentity });
    expect(sweepAt({ nowIso: JUST_AFTER_RELEASE }).output).toContain(HELD_BETWEEN_ROUNDS);

    markReviewerReleased({ atIso: RELEASED_AT, home, record });

    expect(reviewPostureOf({ askIdentity, home }).recordOpen).toBe(false);
    expect(sweepAt({ nowIso: JUST_AFTER_RELEASE }).output).toContain(SWEEP_EXPIRED);
  });
});
