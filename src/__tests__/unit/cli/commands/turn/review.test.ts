/**
 * `slopweaver turn review` — the refusals reachable without a live cmux: argument parsing, a poll with no
 * review on record, an open with no dispatch record, a decision that is not a `respond`. Opening a real
 * reviewer boots a workspace and is proven live, not here.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseTurnReviewArgs, runTurnReview, turnReviewCommand } from "../../../../../cli/commands/turn/review.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { turnManifest } from "../../../../../cli/manifests/turn.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { buildTurnRoutingBrief } from "../../../../../live/turn/brief.js";
import { dispatchIdOf } from "../../../../../live/turn/dispatch.js";
import type { RoutingJudgementInput } from "../../../../../live/turn/judgement.js";

const ASK_IDENTITY = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };
const DISPATCH_ID = dispatchIdOf({ askIdentity: ASK_IDENTITY });

const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: {
    controlPlane: { ownerAddressingText: "what are my open PRs?", structuralMetadata: [] },
    quotedEvidence: [],
  },
  execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function homeWithBrief(): { readonly briefPath: string; readonly home: string } {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-turn-review-"));
  fixtureDirs.push(home);
  const briefPath = join(home, "brief.json");
  writeFileSync(
    briefPath,
    JSON.stringify(
      buildTurnRoutingBrief({
        ...ASK_IDENTITY,
        question: "what are my open PRs?",
        routingInput: ROUTING_INPUT,
        surface: "channel",
        unavailableCapabilities: [],
        userId: "U0OWNER",
      }),
    ),
    "utf8",
  );
  return { briefPath, home };
}

function writeAnswer({ home }: { home: string }): string {
  const answerPath = join(home, "answer.json");
  writeFileSync(
    answerPath,
    JSON.stringify({
      body: [{ runs: [{ text: "3 open PRs", type: "text" }], type: "paragraph" }],
      citations: [],
      grounding: {
        evidence: {
          consultedEmpty: [],
          couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
          premiseChecks: [],
          read: [],
        },
        kind: "conversation",
        provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
        reason: "context alone answers this",
      },
      images: [],
      kind: "answer",
      lead: "3 open PRs",
    }),
    "utf8",
  );
  return answerPath;
}

describe("parseTurnReviewArgs", () => {
  it("accepts the worker's form and the loop's form alike", () => {
    expect(
      unwrap(parseTurnReviewArgs({ rest: ["--dispatch", DISPATCH_ID, "--answer", "/tmp/a.json"] })).values,
    ).toStrictEqual({
      answer: "/tmp/a.json",
      dispatch: DISPATCH_ID,
    });
    expect(unwrap(parseTurnReviewArgs({ rest: ["--brief", "/b.json", "--poll"] })).values).toStrictEqual({
      brief: "/b.json",
      poll: true,
    });
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(unwrapErr(parseTurnReviewArgs({ rest: ["--dispatch", DISPATCH_ID, "--nope"] }))).toEqual([
      "unknown flag: --nope",
    ]);
  });

  it("accepts --wait and --timeout-seconds beside --poll", () => {
    expect(
      unwrap(parseTurnReviewArgs({ rest: ["--brief", "/b.json", "--poll", "--wait", "--timeout-seconds", "300"] }))
        .values,
    ).toStrictEqual({ brief: "/b.json", poll: true, "timeout-seconds": "300", wait: true });
  });
});

describe("turn review — refusals reachable without cmux", () => {
  it("prints usage on --help", async () => {
    expect(await runTurnReview(["node", "slopweaver", "turn", "review", "--help"])).toBe(EXIT_OK);
  });

  it("refuses with a usage code when neither --answer nor --poll is given", async () => {
    const { home } = homeWithBrief();
    expect(
      await runTurnReview(["node", "slopweaver", "turn", "review", "--dispatch", DISPATCH_ID, "--home", home]),
    ).toBe(EXIT_USAGE);
  });

  it("refuses a --poll naming a token this build never minted", async () => {
    const { home } = homeWithBrief();
    expect(
      await runTurnReview(["node", "slopweaver", "turn", "review", "--dispatch", "nope", "--poll", "--home", home]),
    ).toBe(EXIT_USAGE);
  });

  it("refuses a --poll for an ask no review was ever opened for", async () => {
    const { home } = homeWithBrief();
    expect(
      await runTurnReview([
        "node",
        "slopweaver",
        "turn",
        "review",
        "--dispatch",
        DISPATCH_ID,
        "--poll",
        "--home",
        home,
      ]),
    ).toBe(EXIT_ERROR);
  });

  it("refuses an open for a dispatch with no current record — nothing to bind the author to", async () => {
    const { home } = homeWithBrief();
    const answerPath = writeAnswer({ home });
    expect(
      await runTurnReview([
        "node",
        "slopweaver",
        "turn",
        "review",
        "--dispatch",
        DISPATCH_ID,
        "--answer",
        answerPath,
        "--home",
        home,
      ]),
    ).toBe(EXIT_ERROR);
  });

  it("refuses the loop's form when the decision is a no-response — there is no answer to review", async () => {
    const { briefPath, home } = homeWithBrief();
    const answerPath = writeAnswer({ home });
    const decisionPath = join(home, "decision.json");
    writeFileSync(
      decisionPath,
      JSON.stringify({ confidence: "high", rationale: "no reply owed", response: "no-response", schemaVersion: 1 }),
      "utf8",
    );
    expect(
      await runTurnReview([
        "node",
        "slopweaver",
        "turn",
        "review",
        "--brief",
        briefPath,
        "--decision",
        decisionPath,
        "--answer",
        answerPath,
        "--home",
        home,
      ]),
    ).toBe(EXIT_ERROR);
  });

  it("refuses the loop's form when only one of --brief/--decision is given", async () => {
    const { briefPath, home } = homeWithBrief();
    const answerPath = writeAnswer({ home });
    expect(
      await runTurnReview([
        "node",
        "slopweaver",
        "turn",
        "review",
        "--brief",
        briefPath,
        "--answer",
        answerPath,
        "--home",
        home,
      ]),
    ).toBe(EXIT_ERROR);
  });
});

describe("turn manifest — review", () => {
  it("declares review as local-state and door-free — it opens a workspace and writes files, never posts", () => {
    expect(turnManifest["review"]!.meta.effect).toBe("local-state");
    expect(turnManifest["review"]!.meta.doorRouted).toBe(false);
  });

  it("exposes the command the manifest lazily loads", () => {
    expect(turnReviewCommand).toBe(runTurnReview);
  });
});
