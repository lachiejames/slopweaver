/**
 * The past-the-cap refusal, read over a real state home and a real checkout: two reviewed diffs refuse a third
 * before anything is spent, a diff already reviewed still runs, a supervisor-approved extension for THIS exact diff
 * in THIS repository, granted by the session holding the pin, admits it and names its row, and a later fix is
 * refused again. Past the cap is a hold: the break-glass variable opens only a fold that cannot be read. A
 * baseline-bump witness counts in its own lane: two spent general passes leave it its first, a third witness is
 * refused in the witness lane's words, and a witness extension admits it.
 *
 * Zero mocks: general passes are Claude fallback receipts written through the in-memory register port — the cap is
 * on review, not on a provider, so they spend the same two passes a Codex row does. A fallback review is always
 * general, so witness passes are real Codex pass records written under the home's orchestration root.
 */

import { appendFileSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ALLOW_CODEX_REVIEW_PASS_CAP_ENV,
  pastCapVerdict,
  reviewCapVerdict,
} from "../../../../../cli/commands/codex/reviewCapGate.js";
import { writeCodexArtifact } from "../../../../../codex/artifactStore.js";
import type { FallbackRegisterPort } from "../../../../../codex/fallbackPort.js";
import { captureTreeFingerprint, resolveGitCommonDir, resolveRepoRoot } from "../../../../../codex/gitDiff.js";
import { appendPassExtension } from "../../../../../codex/passExtensionStore.js";
import type { ReviewLane } from "../../../../../codex/reviewLane.js";
import { witnessClaimPrefix } from "../../../../../codex/reviewLane.js";
import { witnessPropertyId } from "../../../../../devLint/baselineBump.js";
import { hatchFor } from "../../../../../hatch/lookup.js";
import { unwrap } from "../../../../../lib/result.js";
import { writeSupervisorPin } from "../../../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import {
  FALLBACK_FIXTURE_OUTAGE,
  memoryFallbackRegisterPort,
  unavailableFallbackRegisterPort,
} from "../../../../fallbackRegisterFixture.js";
import { memorySupersessionPort } from "../../../../landingRegistersFixture.js";
import { REAL_GIT_TIMEOUT_MS } from "../../../../tempGitRepo.js";
import { diffAtMinute, recordFallback, removeScratch, scratch, scratchRepo } from "./fallbackBranchFixture.js";

afterEach(() => {
  removeScratch();
});

const VERB = "codex review";
const EXTENSION_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CHAIR_ID = "11111111-0000-3333-4444-555555555555";
const SEAT_ID = "66666666-0000-8888-9999-000000000000";
const BUMP_DIGEST = "e".repeat(64);

/** The last line every past-cap hold ends with. */
const NO_HATCH =
  "This hold has no escape hatch: a pass past the cap is the pinned supervisor's to approve, and a variable any " +
  "session could set would be a seat granting itself one. SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP opens only a fold " +
  "that cannot be read.";

/** A home and a checkout whose branch has had `minutes.length` review passes, one distinct diff each. */
async function reviewedBranch({
  minutes,
}: {
  minutes: readonly number[];
}): Promise<{ dir: string; home: string; port: FallbackRegisterPort; repoRoot: string }> {
  const home = scratch({ label: "home" });
  mkdirSync(stateHomePaths({ home }).orchestration, { recursive: true });
  const dir = scratchRepo();
  const port = memoryFallbackRegisterPort();
  for (const minute of minutes) {
    await recordFallback({ dir, home, minute, port, propertyId: "r3-07", verdict: "BROKEN" });
  }
  return { dir, home, port, repoRoot: unwrap(resolveRepoRoot({ cwd: dir })) };
}

/**
 * One Codex witness pass on `feature`, over the diff at `minute`, recorded as `codex review` writes it — the only
 * shape the witness lane counts.
 */
function recordWitness({ dir, home, minute }: { dir: string; home: string; minute: number }): void {
  const now = unwrap(captureTreeFingerprint({ cwd: dir }));
  const propertyId = witnessPropertyId({ digest: BUMP_DIGEST });
  const written = writeCodexArtifact({
    orchestrationRoot: stateHomePaths({ home }).orchestration,
    record: {
      artifactId: `witness-0000-${String(minute)}`,
      attempts: [],
      bound: { conclusionWindowMs: 36_000, totalMs: 240_000, warnAfterMs: 204_000 },
      createdAtIso: `2026-09-24T12:${String(minute).padStart(2, "0")}:00.000Z`,
      observedElapsedMs: 1,
      outcome: {
        answer: { counterexample: "a reachable state", evidence: "e", propertyId, summary: "s", verdict: "BROKEN" },
        kind: "answered",
        rawFinalResponse: '{"verdict":"BROKEN"}',
      },
      repoRoot: unwrap(resolveRepoRoot({ cwd: dir })),
      requestedApprovalPolicy: "never",
      requestedModel: "gpt-5.6-sol",
      requestedNetworkAccess: true,
      requestedReasoningEffort: "medium",
      requestedSandboxMode: "workspace-write",
      requestedWebSearch: true,
      requestedWritableRoots: [],
      schemaVersion: 1,
      scope: {
        baseRef: "origin/main",
        baseSha: now.headSha,
        diffBytes: 1,
        diffSha256: diffAtMinute({ minute }),
        headSha: now.headSha,
        mode: "review",
        pass: "r3",
        property: { id: propertyId, statement: `${witnessClaimPrefix({ digest: BUMP_DIGEST })} the bump holds` },
      },
      tree: { branch: "feature", dirtyBytes: 0, fingerprint: now.digest, headSha: now.headSha, treeSha: now.treeSha },
    },
  });
  expect(written.isOk()).toBe(true);
}

/** The gate asked over one diff of `feature`, with no hatch unless `env` opens it. */
function verdictAt({
  env = {},
  fallbackPort,
  home,
  lane = "general",
  minute,
  repoRoot,
}: {
  env?: Readonly<Record<string, string | undefined>>;
  fallbackPort: FallbackRegisterPort;
  home: string;
  lane?: ReviewLane;
  minute: number;
  repoRoot: string;
}): ReturnType<typeof reviewCapVerdict> {
  return reviewCapVerdict({
    branch: "feature",
    diff: { repoRoot, sha256: diffAtMinute({ minute }) },
    env,
    fallbackPort,
    home,
    lane,
    supersessions: memorySupersessionPort(),
    verb: VERB,
  });
}

/** The last three lines the unreadable-fold refusal ends with — the one refusal the hatch still opens. */
function refusalTail(): readonly string[] {
  const hatch = hatchFor({ id: "codex-review-pass-cap" });
  return [
    `Legitimate exceptions may include ${hatch.exceptions.join("; ")}.`,
    `To override use the designated escape hatch ${ALLOW_CODEX_REVIEW_PASS_CAP_ENV}=1 ${hatch.command}.`,
    "Use good judgement to determine whether the owner would approve of this, then proceed or correct your approach.",
  ];
}

/** The general lane's way on, as the past-cap hold prints it. */
const GENERAL_WAY_ON =
  "The way on: send the pinned supervisor one line naming the run, this diff and why; only it records " +
  '`slopweaver codex extend --run <slug> --diff <sha256> --lane general --reason "<why>"`, or land it with every ' +
  "finding still standing acknowledged as codex-loop-incomplete with a --reason (`codex status --check` prints " +
  "each one).";

describe("reviewCapVerdict", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("lets the second pass run over a new diff, and says which pass it is", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10] });
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 20, repoRoot });
    expect(verdict).toEqual({ lines: ["codex review: review pass 2 of 2 on feature"], refused: false });
  });

  it("holds a third diff before anything is spent, printing its full sha256 and the supervisor's route", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict).toEqual({
      lines: [
        "codex review: PAST THE CAP — feature has had 2 review passes (diffs dddddddddddd…, dddddddddddd…) " +
          `against a cap of 2, and no extension by the pinned supervisor approves this diff, ${diffAtMinute({ minute: 30 })}.`,
        GENERAL_WAY_ON,
        NO_HATCH,
      ],
      refused: true,
    });
  });

  it("holds a third diff with the break-glass variable set and no extension — the variable is no grant", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const env = { [ALLOW_CODEX_REVIEW_PASS_CAP_ENV]: "1" };
    const verdict = await verdictAt({ env, fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict.refused).toBe(true);
    expect(verdict.lines.at(-1)).toBe(NO_HATCH);
  });

  it("still runs another property over a diff the branch already reviewed — that is the same pass", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 10, repoRoot });
    expect(verdict).toEqual({ lines: ["codex review: review pass 1 of 2 on feature"], refused: false });
  });

  it("refuses when the fold cannot be read, since it cannot tell this diff is within the cap", async () => {
    const { home, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await verdictAt({ fallbackPort: unavailableFallbackRegisterPort(), home, minute: 30, repoRoot });
    const hatch = hatchFor({ id: "codex-review-pass-cap" });
    expect(verdict).toEqual({
      lines: [
        `${hatch.command} blocked because ${hatch.caught} (which review pass this diff would be on feature cannot ` +
          `be told, so it might be past the cap: the fallback receipts could not be read: ${FALLBACK_FIXTURE_OUTAGE.message} ` +
          "— the landing floor refuses on the same read, so repair it first).",
        ...refusalTail(),
      ],
      refused: true,
    });
  });

  it("runs under the hatch when the fold cannot be read, and says so", async () => {
    const { home, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await verdictAt({
      env: { [ALLOW_CODEX_REVIEW_PASS_CAP_ENV]: "1" },
      fallbackPort: unavailableFallbackRegisterPort(),
      home,
      minute: 30,
      repoRoot,
    });
    expect(verdict).toEqual({
      lines: [
        "codex review: the two-pass review cap could not be checked (the fallback receipts could not be read: " +
          `${FALLBACK_FIXTURE_OUTAGE.message}), and SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP=1 runs this review ` +
          "anyway — say why in the pull request",
      ],
      refused: false,
    });
  });

  it("refuses nothing on a detached HEAD, which no branch's count covers", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await reviewCapVerdict({
      branch: null,
      diff: { repoRoot, sha256: diffAtMinute({ minute: 30 }) },
      env: {},
      fallbackPort: port,
      home,
      lane: "general",
      supersessions: memorySupersessionPort(),
      verb: VERB,
    });
    expect(verdict).toEqual({ lines: [], refused: false });
  });

  it("lets a witness run on a branch whose two general passes are spent, announced as a witness pass", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    const verdict = await verdictAt({ fallbackPort: port, home, lane: "baseline-bump-witness", minute: 30, repoRoot });
    expect(verdict).toEqual({ lines: ["codex review: baseline-bump witness pass 1 of 2 on feature"], refused: false });
  });
});

describe("pastCapVerdict in the witness lane", () => {
  it("holds a third witness diff in its own words, sending the bump to the supervisor rather than a leftover", () => {
    const verdict = pastCapVerdict({
      branch: "feature",
      diffSha256: "c".repeat(64),
      extensionNote: undefined,
      lane: "baseline-bump-witness",
      reviewed: ["a".repeat(64), "b".repeat(64)],
      verb: VERB,
    });
    expect(verdict).toEqual({
      lines: [
        "codex review: PAST THE CAP — feature has had 2 baseline-bump witness passes (diffs aaaaaaaaaaaa…, " +
          `bbbbbbbbbbbb…) against a cap of 2, and no extension by the pinned supervisor approves this diff, ${"c".repeat(64)}.`,
        "The way on: send the pinned supervisor one line naming the run, this diff and why; only it records " +
          '`slopweaver codex extend --run <slug> --diff <sha256> --lane baseline-bump-witness --reason "<why>"`, ' +
          "since baseline-bump-unwitnessed has no landing acknowledgement.",
        NO_HATCH,
      ],
      refused: true,
    });
  });
});

describe("reviewCapVerdict past the cap, with the supervisor's extension", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /** Record `CHAIR_ID` as the pinned supervisor in `home`, the pin the gate checks a row's grantor against. */
  function pinChair({ home }: { home: string }): void {
    writeSupervisorPin({
      home,
      record: {
        pinnedAtIso: "2026-11-27T00:00:00.000Z",
        session: { host: "claude-code", id: CHAIR_ID },
        workspaceId: "806BA6F7-0000-4A34-97FF-B35915EE6FB7",
        workspaceRef: "workspace:374",
      },
    });
  }

  /** One extension row for `feature`, approving the diff at `minute` in `lane` of the repository `gitCommonDir` names. */
  function extension({
    gitCommonDir,
    grantor = CHAIR_ID,
    home,
    lane = "general",
    minute = 30,
    run = "acme-parser",
  }: {
    gitCommonDir: string;
    grantor?: string;
    home: string;
    lane?: ReviewLane;
    minute?: number;
    run?: string;
  }): void {
    const appended = appendPassExtension({
      home,
      row: {
        after: undefined,
        atIso: "2026-11-27T01:00:00.000Z",
        branch: "feature",
        diffSha256: diffAtMinute({ minute }),
        gitCommonDir,
        grantedBy: { host: "claude-code", id: grantor },
        id: EXTENSION_ID,
        lane,
        reason: "the fix moved the parser",
        repoRoot: "/nowhere",
        run,
        schemaVersion: 1,
      },
    });
    expect(appended.isOk()).toBe(true);
  }

  /** A branch with two spent general passes, the chair pinned, and the checkout's shared `.git`. */
  async function cappedAndPinned(): Promise<{
    dir: string;
    gitCommonDir: string;
    home: string;
    port: FallbackRegisterPort;
    repoRoot: string;
  }> {
    const branch = await reviewedBranch({ minutes: [10, 20] });
    pinChair({ home: branch.home });
    return { ...branch, gitCommonDir: unwrap(resolveGitCommonDir({ cwd: branch.repoRoot })) };
  }

  const ADMITTED =
    `codex review: review pass 3 on feature, past its cap of 2, extension ${EXTENSION_ID} by the pinned supervisor ` +
    "for run acme-parser: the fix moved the parser";

  /** The opening line of a general-lane hold over the diff at minute 30 after two passes, with `note` inside it. */
  function heldLine({ note }: { note: string }): string {
    return (
      "codex review: PAST THE CAP — feature has had 2 review passes (diffs dddddddddddd…, dddddddddddd…) against " +
      `a cap of 2, and no extension by the pinned supervisor approves this diff, ${diffAtMinute({ minute: 30 })} (${note}).`
    );
  }

  it("admits the exact diff the pinned supervisor extended, naming the row, the run and the reason", async () => {
    const { gitCommonDir, home, port, repoRoot } = await cappedAndPinned();
    extension({ gitCommonDir, home });
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict).toEqual({ lines: [ADMITTED], refused: false });
  });

  it("holds a later fix once the approved diff was reviewed, and keeps admitting the approved diff", async () => {
    const { dir, gitCommonDir, home, port, repoRoot } = await cappedAndPinned();
    extension({ gitCommonDir, home });
    await recordFallback({ dir, home, minute: 30, port, propertyId: "r3-07", verdict: "BROKEN" });
    const next = await verdictAt({ fallbackPort: port, home, minute: 40, repoRoot });
    expect(next.refused).toBe(true);
    expect(next.lines[0]).toBe(
      "codex review: PAST THE CAP — feature has had 3 review passes (diffs dddddddddddd…, dddddddddddd…, " +
        "dddddddddddd…) against a cap of 2, and no extension by the pinned supervisor approves this diff, " +
        `${diffAtMinute({ minute: 40 })}.`,
    );
    const same = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(same).toEqual({ lines: [ADMITTED], refused: false });
  });

  it("holds a new diff the extension does not name, though the branch holds one", async () => {
    const { gitCommonDir, home, port, repoRoot } = await cappedAndPinned();
    extension({ gitCommonDir, home, minute: 50 });
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict.refused).toBe(true);
  });

  it("admits the approved diff whichever run on the branch reviews it, since it is the same pass", async () => {
    const { gitCommonDir, home, port, repoRoot } = await cappedAndPinned();
    extension({ gitCommonDir, home, run: "acme-earlier" });
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict.refused).toBe(false);
    expect(verdict.lines[0]).toContain(`extension ${EXTENSION_ID} by the pinned supervisor for run acme-earlier`);
  });

  it("holds still when the extension names another repository's branch of the same name", async () => {
    const { home, port, repoRoot } = await cappedAndPinned();
    extension({ gitCommonDir: "/elsewhere/.git", home });
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict.refused).toBe(true);
    expect(verdict.lines[0]).toBe(
      "codex review: PAST THE CAP — feature has had 2 review passes (diffs dddddddddddd…, dddddddddddd…) against " +
        `a cap of 2, and no extension by the pinned supervisor approves this diff, ${diffAtMinute({ minute: 30 })}.`,
    );
  });

  it("never lends a witness extension to the general lane", async () => {
    const { gitCommonDir, home, port, repoRoot } = await cappedAndPinned();
    extension({ gitCommonDir, home, lane: "baseline-bump-witness" });
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict.refused).toBe(true);
  });

  it("admits a third witness diff the supervisor extended in the witness lane, announced as a witness pass", async () => {
    const { dir, gitCommonDir, home, port, repoRoot } = await cappedAndPinned();
    recordWitness({ dir, home, minute: 41 });
    recordWitness({ dir, home, minute: 42 });
    const capped = await verdictAt({ fallbackPort: port, home, lane: "baseline-bump-witness", minute: 30, repoRoot });
    expect(capped.refused).toBe(true);
    extension({ gitCommonDir, home, lane: "baseline-bump-witness" });
    const verdict = await verdictAt({ fallbackPort: port, home, lane: "baseline-bump-witness", minute: 30, repoRoot });
    expect(verdict).toEqual({
      lines: [
        `codex review: baseline-bump witness pass 3 on feature, past its cap of 2, extension ${EXTENSION_ID} by the ` +
          "pinned supervisor for run acme-parser: the fix moved the parser",
      ],
      refused: false,
    });
  });

  it("holds a row granted by a session that does not hold the pin, and says so", async () => {
    const { gitCommonDir, home, port, repoRoot } = await cappedAndPinned();
    extension({ gitCommonDir, grantor: SEAT_ID, home });
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict.refused).toBe(true);
    expect(verdict.lines[0]).toBe(
      heldLine({
        note:
          "1 extension row(s) naming this diff were granted by a session that does not hold the supervisor pin " +
          "(workspace:374) and approve nothing",
      }),
    );
  });

  it("holds every row when no supervisor pin is recorded, since no grantor can be shown to hold it", async () => {
    const { home, port, repoRoot } = await reviewedBranch({ minutes: [10, 20] });
    extension({ gitCommonDir: unwrap(resolveGitCommonDir({ cwd: repoRoot })), home });
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict.refused).toBe(true);
    expect(verdict.lines[0]).toBe(
      heldLine({ note: "no supervisor pin is recorded, so no extension's grantor can be shown to hold it" }),
    );
  });

  it("holds over an unreadable register row and says so, approving nothing from it", async () => {
    const { home, port, repoRoot } = await cappedAndPinned();
    const path = stateHomePaths({ home }).codexPassExtensionsJsonl;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, "{not json\n");
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict.refused).toBe(true);
    expect(verdict.lines[0]).toBe(
      heldLine({ note: "1 pass-extension row(s) would not decode and approve nothing (line 1: not JSON)" }),
    );
  });

  it("holds when the whole register will not read — its directory a link to another home's — approving nothing", async () => {
    const { gitCommonDir, home, port, repoRoot } = await cappedAndPinned();
    const elsewhere = scratch({ label: "elsewhere" });
    extension({ gitCommonDir, home: elsewhere });
    const path = stateHomePaths({ home }).codexPassExtensionsJsonl;
    mkdirSync(dirname(dirname(path)), { recursive: true });
    symlinkSync(dirname(stateHomePaths({ home: elsewhere }).codexPassExtensionsJsonl), dirname(path));
    const verdict = await verdictAt({ fallbackPort: port, home, minute: 30, repoRoot });
    expect(verdict.refused).toBe(true);
    expect(verdict.lines[0]).toBe(
      heldLine({
        note:
          `the pass-extension register at ${path} would not read: its directory ${dirname(path)} is a symbolic ` +
          "link, which a register never is, so no extension was read",
      }),
    );
  });
});
