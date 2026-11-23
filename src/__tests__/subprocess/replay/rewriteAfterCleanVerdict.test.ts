/**
 * REPLAY LANE — the turn that was reviewed clean twice and never posted.
 *
 * The fixture (`fixtures/replay/rewrite-after-clean-verdict-loses-the-lease`) is that ask's own record set
 * frozen through its `dispatched` event: a live two-hour lease, a
 * `fresh-visible-session` decision, and no review yet. What happened next is the incident — the worker
 * rewrote its answer after EVERY verdict, so each rewrite changed the digest and made the verdict that had
 * just arrived unusable. Outcomes ran broken, broken, clean, clean, broken across five rounds at a measured
 * ~20 minutes each; rounds three and four were both sendable and neither was sent; round five returned broken
 * on the core deliverable and the lease expired four minutes later with a fully investigated
 * answer never posted.
 *
 * This drives the REAL verbs over that frozen world, and pins both halves of the fix:
 *
 * - the answer is FROZEN at review — `turn resume --answer` refuses bytes that would discard a verdict the
 *   door would accept as it stands, until `--edit-reason` says why, and journals the reason when it does;
 * - the lease is judged against REVIEW TIME (`live/turn/leaseJudgement.ts`, landed for this same incident) —
 *   a clean verdict bound to the answer in hand HOLDS the clock, so `turn dispatch --sweep` at an instant
 *   that expired the dispatched lease reports the worker still working; and the rewrite that made that
 *   verdict stale is exactly what hands the clock back.
 *
 * Two behaviours it deliberately pins UNCHANGED, because a fix that moved either would be a worse bug: a
 * post on a superseded digest is still refused, and the fix-and-re-review path a `broken` verdict opens is
 * still free.
 *
 * ## What the between-rounds hold changed here, and why the cases MOVED rather than being edited
 *
 * Two cases below used to assert `lease-expired` at {@link PAST_THE_LEASE} for a world whose review RECORD
 * was still open — a stale verdict after a permitted rewrite, and a `clean` verdict the door refuses for an
 * unresolved claim. `live/turn/leaseJudgement.ts` now holds the clock for exactly that window, so both
 * report `lease-held` there. That is this incident's own correct outcome: its answer posted 55
 * minutes after the clock killed it. What each case keeps is the property it was landed for, moved to where
 * it is now falsifiable — the hold is CAPPED, so each asserts the same world expiring at
 * {@link PAST_THE_REVIEW_HOLD_CAP}, which is the witness that the UNBOUNDED usable-verdict branch did not
 * fire. The third case, an ask with no review record at all, is untouched and is what proves a hold needs a
 * record to exist.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { answerQualityFindings } from "../../../admit/answerQualityGate.js";
import type { ReviewVerdict } from "../../../admit/reviewVerdict.js";
import { readReviewVerdict } from "../../../admit/reviewVerdictFile.js";
import { bareRefContext } from "../../../cli/bareRefContext.js";
import { unwrap } from "../../../lib/result.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import { dispatchIdOf } from "../../../live/turn/dispatch.js";
import { MAX_REVIEW_HOLD_HOURS } from "../../../live/turn/leaseJudgement.js";
import { answerDigestOf } from "../../../live/turn/poster.js";
import type { ReviewRecord } from "../../../live/turn/review.js";
import { reviewPaths, writeReview } from "../../../live/turn/reviewStore.js";
import { readTurnJournal } from "../../../live/turn/turnJournalStore.js";
import { turnMarkerPath } from "../../../live/turn/turnMarkerStore.js";
import { parseAnswerArm } from "../../../outbound/assistant/answerForm.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const SLUG = "rewrite-after-clean-verdict-loses-the-lease";

/**
 * An instant past the lease this ask was dispatched under — the window in which
 * the real turn was abandoned with a fully investigated answer in hand.
 */
const PAST_THE_LEASE = "2026-09-03T08:45:00.000Z";

/**
 * The `spawnedAt` every round staged below records — the real round-3 reviewer's own spawn instant, and the
 * anchor `MAX_REVIEW_HOLD_HOURS` is measured from.
 */
const ROUND_SPAWNED_AT = "2026-09-03T07:36:53.850Z";

/**
 * An instant past `ROUND_SPAWNED_AT + MAX_REVIEW_HOLD_HOURS`, where every capped hold lapses and the lease
 * decides again. Derived rather than typed, so moving the cap moves this with it.
 */
const PAST_THE_REVIEW_HOLD_CAP = new Date(
  Date.parse(ROUND_SPAWNED_AT) + (MAX_REVIEW_HOLD_HOURS + 1) * 60 * 60 * 1000,
).toISOString();

/** The line the sweep prints for the hold an OPEN review record buys between two rounds. */
const HELD_BETWEEN_ROUNDS =
  "lease held open (not expired): CFIXTUREAA/1788416854.480579 — a review round has returned but the review " +
  "is not released — the worker is inside the fix-and-re-review loop a broken verdict opens";

/** One of the frozen decision's own required capability ids, so a `verb` grounding is accepted. */
const CAPABILITY_ID = "telemetry";

/** The sweep's own summary line when the one ask in this home was abandoned on its lease. */
const SWEEP_EXPIRED =
  "sweep: 0 ready, 0 still working, 0 in-review, 0 worker-failed, 0 phantom, 1 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored";

/** The same line when the lease still holds. Asserted whole: the summary always names every count. */
const SWEEP_STILL_WORKING =
  "sweep: 0 ready, 1 still working, 0 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, 0 never-dispatched, 0 checklist-update-failed, 0 ignored";

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-rewrite-after-clean-"));
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
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(BIN, args, {
      cwd: workspace,
      encoding: "utf8",
      env: { CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"), HOME: workspace, PATH: process.env["PATH"]! },
      maxBuffer: 8 * 1024 * 1024,
    });
    return { status: 0, stderr: "", stdout };
  } catch (error: unknown) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, stderr: e.stderr, stdout: e.stdout };
  }
}

/** One valid paragraph block. */
function paragraph({ text }: { text: string }): {
  readonly runs: readonly { text: string; type: "text" }[];
  readonly type: "paragraph";
} {
  return { runs: [{ text, type: "text" }], type: "paragraph" };
}

/** An answer the frozen decision accepts, whose body text the caller varies to move its digest. */
function answerSaying({ body }: { body: string }): Record<string, unknown> {
  return {
    body: [paragraph({ text: body })],
    citations: [],
    grounding: {
      capability: { command: ["dev", "cost", "report"], id: CAPABILITY_ID, what: "the monthly spend series" },
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
        premiseChecks: [],
        read: [],
      },
      kind: "verb",
      provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
      result: "the spend series was read",
    },
    images: [],
    kind: "answer",
    lead: "here is what the spend series shows",
  };
}

/** The answer rounds one to three converged on. */
const CONVERGED_ANSWER = answerSaying({ body: "Three monitors already cover the spend series." });

/** The rewrite that superseded it — a `low`-impact reviewer note, tidied. */
const REWRITTEN_ANSWER = answerSaying({ body: "Three monitors already cover the spend series today." });

/**
 * Materialise the fixture at the moment right after `dispatched`.
 *
 * @param into the throwaway home to materialise into
 * @returns the ask identity and the dispatch id every verb is addressed by
 */
function materialiseAtDispatch({ into }: { into: string }): {
  readonly askIdentity: AskIdentity;
  readonly dispatchId: string;
} {
  const manifest = materialiseFixture({ into, slug: SLUG });
  const askIdentity = {
    channel: manifest.ask.channel,
    messageTs: manifest.ask.messageTs,
    threadTs: manifest.ask.threadTs,
  };
  const markerPath = turnMarkerPath({ askIdentity, home: into });
  if (existsSync(markerPath)) {
    rmSync(markerPath);
  }
  // `responders.json` is install config, deliberately never frozen — and `turn answer` refuses every
  // identity without it, before any door gate can run. The fixture's own asker is the only responder here.
  writeFileSync(join(into, "responders.json"), JSON.stringify([manifest.ask.askedBy]), "utf8");
  return { askIdentity, dispatchId: dispatchIdOf({ askIdentity }) };
}

/** The reviewer locator a staged round records — a plain address, never a claim about progress. */
const REVIEWER = {
  host: "claude-code" as const,
  surfaceId: "fixture-reviewer-surface",
  surfaceRef: "surface:143",
  workspaceId: "fixture-reviewer-workspace",
  workspaceRef: "workspace:141",
};

/** How the packet names the reviewer — what its verdict must carry back as `reviewerSession`. */
const REVIEWER_SESSION = `reviewer workspace ${REVIEWER.workspaceRef} (${REVIEWER.workspaceId})`;

/** How the packet names the author. */
const AUTHOR_SESSION = "author claude-code session fixture-worker";

/**
 * Stage one review round over the answer the worker just validated, through the REAL review store, and drop
 * the reviewer's verdict at the path the record names.
 *
 * The reviewer itself is a visible cmux session this lane cannot open, so the round's own two artefacts are
 * written here and every verb under test then reads them exactly as it reads a real reviewer's.
 *
 * @param answerDigest the digest the round binds to, taken from the verb's own reported digest
 * @param answerPath the answer file the round was opened over
 * @param askIdentity the ask being reviewed
 * @param outcome the verdict the reviewer returned
 * @param round which round this is, 1-based
 * @param unresolvedHighImpact a `clean` verdict that still leaves a `high`-impact claim unsupported — the
 *   shape the door refuses as `ANSWER_CLAIM_UNRESOLVED` while its outcome reads clean
 */
function stageReviewRound({
  answerDigest,
  answerPath,
  askIdentity,
  outcome,
  round,
  unresolvedHighImpact = false,
}: {
  answerDigest: string;
  answerPath: string;
  askIdentity: AskIdentity;
  outcome: ReviewVerdict["outcome"];
  round: number;
  unresolvedHighImpact?: boolean;
}): string {
  const paths = reviewPaths({ askIdentity, home });
  const record: ReviewRecord = {
    ...askIdentity,
    answerDigest,
    answerPath,
    authorSession: AUTHOR_SESSION,
    carriedUnresolved: [],
    packetPath: paths.packet,
    reviewer: REVIEWER,
    reviewerSession: REVIEWER_SESSION,
    round,
    schemaVersion: 2,
    spawnedAt: ROUND_SPAWNED_AT,
    verdictPath: paths.verdict,
  };
  writeReview({ home, packet: "the packet this lane does not read", record });
  const verdict: ReviewVerdict = {
    answerDigest,
    authorSession: AUTHOR_SESSION,
    claims: [
      outcome === "clean" && !unresolvedHighImpact
        ? { evidence: "the spend series itself", impact: "high", support: "supported", text: "three monitors cover it" }
        : { impact: "high", support: "unsupported", text: "no row proposes the monitor the ask existed for" },
    ],
    outcome,
    reviewerSession: REVIEWER_SESSION,
    schemaVersion: 1,
    // A reviewer that read the operator's rules against the answer's own rendered strings and found nothing.
    // An ABSENT `voice` is its own door finding, so leaving it off here would make every case below assert
    // the lease behaviour through a second, unrelated refusal; the voice half's own refusals are tested in
    // `unit/admit/answerQualityGate.test.ts`.
    voice: { pathsChecked: ["lead", "body"], rulesChecked: 3, violations: [] },
  };
  writeFileSync(paths.verdict, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
  return paths.verdict;
}

/**
 * The digest of the answer currently on disk, through the SAME two functions the verbs use — the door's own
 * parse and `answerDigestOf`. Never a hash computed here: a second implementation would drift from the one
 * the door checks against and this lane would stop testing anything.
 *
 * @param answerPath the answer file
 * @returns the `sha256:<hex>` digest a verdict must carry to be about these bytes
 */
function digestOfAnswerOnDisk({ answerPath }: { answerPath: string }): string {
  const raw: unknown = JSON.parse(readFileSync(answerPath, "utf8"));
  return answerDigestOf({ answer: unwrap(parseAnswerArm({ context: bareRefContext({ home }), raw })) });
}

/**
 * Validate an answer through the real verb.
 *
 * @param answer the answer to write and validate
 * @param answerPath where to write it
 * @param dispatchId the dispatch this worker was resumed for
 * @param editReason the `--edit-reason` to pass, when the caller means to state one
 * @returns the verb's exit status and combined output
 */
function validateAnswer({
  answer,
  answerPath,
  dispatchId,
  editReason,
}: {
  answer: Record<string, unknown>;
  answerPath: string;
  dispatchId: string;
  editReason: string | undefined;
}): { readonly status: number; readonly output: string } {
  writeFileSync(answerPath, JSON.stringify(answer), "utf8");
  const result = runSlopweaver({
    args: [
      "turn",
      "resume",
      "--dispatch",
      dispatchId,
      "--answer",
      answerPath,
      "--home",
      home,
      ...(editReason === undefined ? [] : ["--edit-reason", editReason]),
    ],
  });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

describe("replay: rewrite-after-clean-verdict-loses-the-lease", () => {
  it("froze the state BEFORE the defect fired — a live lease, and none of the endings it wrote", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    expect(manifest.through).toBe("dispatched");
    expect(manifest.withheldEventKinds).toEqual(["failed", "answered"]);
    expect(manifest.replayNowIso).toBe("2026-09-03T06:30:32.895Z");
    // Every durable file the incident's own ending wrote is withheld too, so the fixture describes ONE
    // moment. Before this rule the marker rode along reading `"kind": "failed"`.
    expect(manifest.files).toEqual([
      "home/live/slack/asks.jsonl",
      "home/briefs/CFIXTUREAA-1788416854.480579.json",
      "home/live/slack/dispatches/CFIXTUREAA-1788416854.480579.json",
    ]);
  });

  it("refuses the rewrite that discarded the clean verdict, naming the round, the rule and the cost", () => {
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    expect(validateAnswer({ answer: CONVERGED_ANSWER, answerPath, dispatchId, editReason: undefined }).status).toBe(0);
    const digest = digestOfAnswerOnDisk({ answerPath });
    stageReviewRound({ answerDigest: digest, answerPath, askIdentity, outcome: "clean", round: 3 });

    const rewritten = validateAnswer({ answer: REWRITTEN_ANSWER, answerPath, dispatchId, editReason: undefined });

    expect(rewritten.status).not.toBe(0);
    expect(rewritten.output).toContain("round 3 returned a verdict you could post RIGHT NOW");
    expect(rewritten.output).toContain("a new digest needs a new verdict");
    expect(rewritten.output).toContain("this edit costs another review round");
    // Nothing was journalled: a refused edit is not an edit.
    expect(readTurnJournal({ askIdentity, home })).toEqual([]);
  });

  it("lets the same rewrite through once its author says why, and journals the reason", () => {
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    validateAnswer({ answer: CONVERGED_ANSWER, answerPath, dispatchId, editReason: undefined });
    const digest = digestOfAnswerOnDisk({ answerPath });
    stageReviewRound({ answerDigest: digest, answerPath, askIdentity, outcome: "clean", round: 3 });

    const rewritten = validateAnswer({
      answer: REWRITTEN_ANSWER,
      answerPath,
      dispatchId,
      editReason: "the table omitted the monitor the ask existed for",
    });

    expect(rewritten.status).toBe(0);
    expect(rewritten.output).toContain("SLOPWEAVER_TURN_READY");
    const journal = readTurnJournal({ askIdentity, home });
    expect(journal.length).toBe(1);
    const row = journal[0]!;
    expect(row.kind).toBe("answer-edited");
    expect(row).toMatchObject({
      discardedSendableVerdict: true,
      fromDigest: digest,
      reason: "the table omitted the monitor the ask existed for",
      toDigest: digestOfAnswerOnDisk({ answerPath }),
    });
  });

  it("leaves the fix-and-re-review path a BROKEN verdict opens completely free", () => {
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    validateAnswer({ answer: CONVERGED_ANSWER, answerPath, dispatchId, editReason: undefined });
    const digest = digestOfAnswerOnDisk({ answerPath });
    stageReviewRound({ answerDigest: digest, answerPath, askIdentity, outcome: "broken", round: 5 });

    const fixed = validateAnswer({ answer: REWRITTEN_ANSWER, answerPath, dispatchId, editReason: undefined });

    expect(fixed.status).toBe(0);
    expect(fixed.output).toContain("SLOPWEAVER_TURN_READY");
    expect(readTurnJournal({ askIdentity, home })).toEqual([]);
  });

  it("abandons the turn at the dispatched lease when no review ever held the clock", () => {
    materialiseAtDispatch({ into: home });
    const swept = runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", PAST_THE_LEASE, "--home", home] });
    expect(`${swept.stdout}${swept.stderr}`).toContain(SWEEP_EXPIRED);
  });

  it("holds the clock at the same instant once a clean verdict binds to the answer in hand", () => {
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    validateAnswer({ answer: CONVERGED_ANSWER, answerPath, dispatchId, editReason: undefined });
    const digest = digestOfAnswerOnDisk({ answerPath });
    stageReviewRound({ answerDigest: digest, answerPath, askIdentity, outcome: "clean", round: 3 });

    // Drop the READY marker the validate wrote: the sweep reports a finished worker BEFORE the lease gets a
    // say, so leaving it there would make this pass whatever the lease said. What is under test is the lease
    // arm alone, at the exact instant the previous test proves expires it.
    rmSync(turnMarkerPath({ askIdentity, home }));

    const swept = runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", PAST_THE_LEASE, "--home", home] });
    const output = `${swept.stdout}${swept.stderr}`;
    expect(output).toContain(
      "lease held open (not expired): CFIXTUREAA/1788416854.480579 — a clean verdict for this exact answer is " +
        "already written — the work is done and the answer is postable",
    );
    expect(output).toContain(SWEEP_STILL_WORKING);
  });

  it("keeps the turn alive once a rewrite has made that verdict stale — the review round is still OPEN", () => {
    // The incident's own shape: the round-3 verdict was sendable, the worker rewrote anyway, and the sweep
    // was left judging a turn with no usable verdict against a lease it had already outrun. That used to
    // report `lease-expired` — and the real turn's answer posted 55 minutes after the
    // clock killed it, which is what says the lease was wrong rather than the worker. The record is still
    // open here, so the hold that survives is the BETWEEN-ROUNDS one, capped rather than unbounded.
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    validateAnswer({ answer: CONVERGED_ANSWER, answerPath, dispatchId, editReason: undefined });
    const digest = digestOfAnswerOnDisk({ answerPath });
    stageReviewRound({ answerDigest: digest, answerPath, askIdentity, outcome: "clean", round: 3 });
    validateAnswer({ answer: REWRITTEN_ANSWER, answerPath, dispatchId, editReason: "a low-impact note, tidied" });
    rmSync(turnMarkerPath({ askIdentity, home }));

    const swept = runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", PAST_THE_LEASE, "--home", home] });
    const output = `${swept.stdout}${swept.stderr}`;
    expect(output).toContain(HELD_BETWEEN_ROUNDS);
    expect(output).toContain(SWEEP_STILL_WORKING);
  });

  it("hands that same turn back to the clock once the round's own cap has run out", () => {
    // The falsifiable half of the case above: the between-rounds hold is a cap, not a second lease, so at an
    // instant past `spawnedAt + MAX_REVIEW_HOLD_HOURS` the identical world expires.
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    validateAnswer({ answer: CONVERGED_ANSWER, answerPath, dispatchId, editReason: undefined });
    const digest = digestOfAnswerOnDisk({ answerPath });
    stageReviewRound({ answerDigest: digest, answerPath, askIdentity, outcome: "clean", round: 3 });
    validateAnswer({ answer: REWRITTEN_ANSWER, answerPath, dispatchId, editReason: "a low-impact note, tidied" });
    rmSync(turnMarkerPath({ askIdentity, home }));

    const swept = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--now", PAST_THE_REVIEW_HOLD_CAP, "--home", home],
    });
    expect(`${swept.stdout}${swept.stderr}`).toContain(SWEEP_EXPIRED);
  });

  it("CAPS a CLEAN verdict the door would still refuse for an unresolved claim — no unbounded hold", () => {
    // The usable-verdict hold is the one branch `MAX_REVIEW_HOLD_HOURS` does not bound, so a verdict that
    // reads clean but carries an unresolved `high`-impact claim would hold the lease open forever on an
    // answer no door would take. `verdictIsSendable` is the door's own bar, which is why the sweep asks it.
    // What such a verdict still earns is the CAPPED between-rounds hold — its review record is open and the
    // worker's next move is to resolve the claim — so the witness that the unbounded branch did not fire is
    // the expiry at the cap, asserted below.
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    validateAnswer({ answer: CONVERGED_ANSWER, answerPath, dispatchId, editReason: undefined });
    const digest = digestOfAnswerOnDisk({ answerPath });
    const verdictPath = stageReviewRound({
      answerDigest: digest,
      answerPath,
      askIdentity,
      outcome: "clean",
      round: 3,
      unresolvedHighImpact: true,
    });
    // The witness that this verdict really is one the door refuses, so the sweep below is not asserting
    // something that could never have gone the other way.
    const verdict = unwrap(readReviewVerdict({ path: verdictPath }));
    expect(answerQualityFindings({ answerDigest: digest, verdict }).map((finding) => finding.code)).toEqual([
      "ANSWER_CLAIM_UNRESOLVED",
    ]);
    rmSync(turnMarkerPath({ askIdentity, home }));

    const held = runSlopweaver({ args: ["turn", "dispatch", "--sweep", "--now", PAST_THE_LEASE, "--home", home] });
    expect(`${held.stdout}${held.stderr}`).toContain(HELD_BETWEEN_ROUNDS);

    const capped = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--now", PAST_THE_REVIEW_HOLD_CAP, "--home", home],
    });
    expect(`${capped.stdout}${capped.stderr}`).toContain(SWEEP_EXPIRED);
  });

  it("leaves a permitted rewrite's verdict STALE — the door's refusal is untouched by any of this", () => {
    // The door itself cannot be driven here: `turn answer` refuses for want of a Slack bot token long before
    // any gate runs, and giving this lane a token would make it post. So the assertion is the door's OWN
    // predicate, run over the two files the replay actually produced. Its refusal codes are covered directly
    // in `unit/admit/answerQualityGate.test.ts`.
    const { askIdentity, dispatchId } = materialiseAtDispatch({ into: home });
    const answerPath = join(home, "answer.json");
    validateAnswer({ answer: CONVERGED_ANSWER, answerPath, dispatchId, editReason: undefined });
    const digest = digestOfAnswerOnDisk({ answerPath });
    const verdictPath = stageReviewRound({
      answerDigest: digest,
      answerPath,
      askIdentity,
      outcome: "clean",
      round: 3,
    });
    // Before the rewrite the same pair passes, which is what makes the refusal below evidence rather than
    // an assertion that could never have gone the other way.
    const verdict = unwrap(readReviewVerdict({ path: verdictPath }));
    expect(answerQualityFindings({ answerDigest: digestOfAnswerOnDisk({ answerPath }), verdict })).toEqual([]);

    // The rewrite the incident actually made, this time with its reason stated — the digest moves anyway.
    validateAnswer({ answer: REWRITTEN_ANSWER, answerPath, dispatchId, editReason: "a low-impact note, tidied" });

    const findings = answerQualityFindings({ answerDigest: digestOfAnswerOnDisk({ answerPath }), verdict });
    expect(findings.map((finding) => finding.code)).toEqual(["ANSWER_VERDICT_STALE"]);
  });
});
