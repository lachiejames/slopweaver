/**
 * REPLAY LANE — the inline-turn-finalised-mid-review incident, re-run against the SHIPPED binary.
 *
 * Ask `C0SYN000001/1789521183.332199`. Its whole lifecycle at the moment the defect fired is two events —
 * `captured` 01:13:03.877Z, `checklist-posted` 01:13:12.738Z — because an INLINE turn journals a
 * `dispatched` row only when `cli/commands/turn/dispatchInitial.ts`'s `handleInline` runs, and this turn never
 * reached it: the loop session composed the answer itself and opened the review straight off the brief and
 * decision files. `turn review --brief <file> --decision <file> --answer <file>` never asks whether a
 * dispatch was recorded, so nothing about the routing was ever written down. Every sweep lap printed
 * `UNROUTED — ROUTE IT NOW` at a turn a session was actively working, and at 01:46:28.759Z the sweep wrote
 * `dispatch-failed` and finalised the card as abandoned — while round 1 of its review was open. The answer
 * posted at 02:01:07.174Z, fifteen minutes after the card said nobody was coming.
 *
 * ## The one file in the fixture that was reconstructed, and why it could not be frozen
 *
 * Everything here is the ask's own record set, cut and redacted by the real `slopweaver turn freeze` —
 * except `reviews/<ask>/record.json`, which is round 1's and was rebuilt before the freeze ran.
 *
 * A review RE-OPEN archives the superseded VERDICT by rename (`live/turn/reviewStore.ts`'s
 * `supersededVerdictName`) and OVERWRITES `record.json`. So the only file that ever says "a reviewer is
 * open" does not survive its own round, and by the time this incident was investigated the standing record
 * was round 2's — `spawnedAt` 01:51:45.729Z, five minutes after the moment being replayed, which
 * `live/turn/freeze/window.ts`'s `writtenAfter` correctly drops. A freeze of the live home therefore yields
 * a review directory with no record in it, and a fixture that cannot state the thing the incident is about.
 *
 * Round 1's record was rebuilt from facts the surviving record set still states: the reviewer workspace id
 * and spawn instant from the archived verdict's own filename
 * (`verdict-superseded-003921FA-…-2026-09-16T01-26-36-637Z.json`), the answer digest and author session from
 * that verdict's body, `releasedAt` absent and no verdict file — which is exactly what was on disk at
 * 01:46:28.759Z. `subprocess/replay/bareRefIncidentSynthetic.test.ts` is the standing precedent for naming a
 * reconstruction rather than passing it off as a capture.
 *
 * **The falsifiable witness**, copied from `./cardPostedNeverDispatched.test.ts`: finalising a swept ask's
 * indicators prints `could not finalise its indicators — no Slack bot token is configured` when no bot token
 * is present — a line that appears when, and only when, a post was ATTEMPTED. Its absence in the held run is
 * therefore evidence rather than silence, and its presence in the two control runs proves those reached the
 * finalisation door. Both controls run the SAME fixture at the same clock as the held run or later, so what
 * separates them is the review posture and the cap, never the input.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";
import { materialiseFixture } from "../../replayFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** The reviewer holding this turn open, from the archived round-1 verdict's own filename. */
const REVIEWER_SPAWNED_AT = "2026-09-16T01:26:36.637Z";

/**
 * Past `MAX_REVIEW_HOLD_HOURS` (2h) measured from {@link REVIEWER_SPAWNED_AT} — the instant a reviewer that
 * never returned stops being a reason to keep the card standing.
 */
const PAST_THE_CAP = "2026-09-16T03:26:37.637Z";

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-inline-review-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the materialised fixture home, with an environment carrying none of this
 * machine's real config: `HOME` is the throwaway directory, so no bot token and no cmux daemon is reachable.
 *
 * @param args the argv tail
 * @returns the exit status and both streams
 */
function runSlopweaver({ args }: { args: readonly string[] }): { status: number; stdout: string; stderr: string } {
  // `spawnSync`, not `execFileSync`: the latter returns stdout ALONE on a zero exit and discards stderr, so
  // the finalisation witness this file's header names would read as an empty string on exactly the runs that
  // are supposed to print it.
  const result = spawnSync(BIN, [...args], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...accountSandboxChildEnv(),
      CMUX_SOCKET_PATH: join(workspace, "no-such-cmux.sock"),
      HOME: workspace,
      PATH: process.env["PATH"]!,
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  // `status` is null when the child was killed by a SIGNAL rather than exiting, so the absence is named
  // here instead of collapsed into a number: a sweep that was killed and a sweep that refused are different
  // failures, and every assertion below reads this as an exit code.
  const { status } = result;
  if (status === null) {
    throw new Error(`slopweaver ${args.join(" ")} was killed by signal ${String(result.signal)}, never exiting`);
  }
  return { status, stderr: result.stderr, stdout: result.stdout };
}

/**
 * The ask's lifecycle kinds as they stand on disk right now — what proves a run settled something, or
 * settled nothing.
 *
 * @returns one kind per row, in file order
 */
function lifecycleKinds(): readonly string[] {
  return readFileSync(join(home, "live", "slack", "asks.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { kind: string }).kind);
}

describe("replay: inline-turn-reaped-mid-review", () => {
  it("holds the never-dispatched bound while the reviewer is mid-verdict", { timeout: 60_000 }, () => {
    const manifest = materialiseFixture({ into: home, slug: "inline-turn-reaped-mid-review" });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `IN REVIEW — DO NOT ROUTE: ${manifest.ask.channel}/${manifest.ask.messageTs} — last event 33m ago and ` +
        "no dispatch was ever recorded, but an independent reviewer is mid-verdict, and its time is not the " +
        `worker's to pay for (reviewer spawned ${REVIEWER_SPAWNED_AT})`,
    );
    expect(result.stdout).toContain(
      "sweep: 0 ready, 0 still working, 1 in-review, 0 worker-failed, 0 phantom, 0 lease-expired, " +
        "0 never-dispatched, 0 checklist-update-failed, 0 ignored",
    );
    // Neither of the other two readings of an unrouted ask may fire: `UNROUTED — ROUTE IT NOW` is as wrong
    // about a turn under review as the finalisation is, and acting on either posts a second card over the
    // one the person in the thread is watching.
    expect(result.stdout).not.toContain("NEVER-DISPATCHED");
    expect(result.stdout).not.toContain("UNROUTED — ROUTE IT NOW");
    // No route command anywhere in the output: the held line is the one finding that says do not act.
    expect(result.stdout).not.toContain("slopweaver turn brief");
    // The witness, ABSENT — proving no post was attempted rather than merely that less was printed.
    expect(`${result.stdout}${result.stderr}`).not.toContain("could not finalise its indicators");
    // And nothing was written: the fixture's two rows, unchanged.
    expect(lifecycleKinds()).toEqual(["captured", "checklist-posted"]);
  });

  it("finalises the same ask at the same clock once no reviewer is open", { timeout: 60_000 }, () => {
    // The control that makes the run above evidence. One input differs — the review directory is gone, so
    // `reviewPostureOf` reads `inFlight: false` — and the incident's exact old behaviour returns.
    const manifest = materialiseFixture({ into: home, slug: "inline-turn-reaped-mid-review" });
    rmSync(join(home, "live", "slack", "reviews"), { force: true, recursive: true });
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", manifest.replayNowIso],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `NEVER-DISPATCHED — ROUTE IT NOW: ${manifest.ask.channel}/${manifest.ask.messageTs} — no session ever ` +
        "picked this up — it was seen 33m ago (last event 2026-09-16T01:13:12.738Z) and no routing decision " +
        "was ever recorded for it",
    );
    expect(result.stdout).not.toContain("IN REVIEW — DO NOT ROUTE");
    expect(result.stderr).toContain("could not finalise its indicators — no Slack bot token is configured");
    expect(lifecycleKinds()).toEqual(["captured", "checklist-posted", "dispatch-failed"]);
  });

  it(
    "lapses the hold at the cap, so a reviewer that never returned cannot stall the bound",
    { timeout: 60_000 },
    () => {
      // The second control, and the one that stops this change reintroducing `card-posted-never-dispatched`:
      // an uncapped hold is not a bound at all. Same fixture, same open reviewer, only the clock moved past
      // `MAX_REVIEW_HOLD_HOURS` from its spawn.
      const manifest = materialiseFixture({ into: home, slug: "inline-turn-reaped-mid-review" });
      const result = runSlopweaver({
        args: ["turn", "dispatch", "--sweep", "--home", home, "--now", PAST_THE_CAP],
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        `NEVER-DISPATCHED — ROUTE IT NOW: ${manifest.ask.channel}/${manifest.ask.messageTs} — no session ever ` +
          "picked this up — it was seen 133m ago",
      );
      expect(result.stdout).not.toContain("IN REVIEW — DO NOT ROUTE");
      expect(result.stderr).toContain("could not finalise its indicators — no Slack bot token is configured");
      expect(lifecycleKinds()).toEqual(["captured", "checklist-posted", "dispatch-failed"]);
    },
  );

  it("holds on a clean verdict nobody has posted yet, with no reviewer left running", { timeout: 60_000 }, () => {
    // The other arm of `live/turn/inlineReviewHold.ts`, and the one the cap deliberately does not bound: a
    // verdict the door would accept, bound to the answer in hand, means the work is finished and the only
    // thing left is to post it. Finalising THAT is the failure `live/turn/leaseJudgement.ts`'s header
    // measures — destroying a finished answer to enforce a clock.
    const manifest = materialiseFixture({ into: home, slug: "inline-turn-reaped-mid-review" });
    const reviewDir = join(home, "live", "slack", "reviews", `${manifest.ask.channel}-${manifest.ask.messageTs}`);
    const record = JSON.parse(readFileSync(join(reviewDir, "record.json"), "utf8")) as {
      answerDigest: string;
      authorSession: string;
      verdictPath: string;
      reviewerSession: string;
    };
    writeFileSync(
      record.verdictPath,
      JSON.stringify({
        answerDigest: record.answerDigest,
        authorSession: record.authorSession,
        claims: [],
        imageObservations: [],
        outcome: "clean",
        reviewerSession: record.reviewerSession,
        schemaVersion: 1,
      }),
    );
    const result = runSlopweaver({
      args: ["turn", "dispatch", "--sweep", "--home", home, "--now", PAST_THE_CAP],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "a clean verdict for this exact answer is already written — the work is done and the answer is postable",
    );
    expect(result.stdout).not.toContain("NEVER-DISPATCHED");
    expect(`${result.stdout}${result.stderr}`).not.toContain("could not finalise its indicators");
    expect(lifecycleKinds()).toEqual(["captured", "checklist-posted"]);
  });
});
