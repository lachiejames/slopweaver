/**
 * The open mode's one gate that runs before anything is booted: `validatedAnswer`, which re-reads the answer
 * through the door's own schema so a malformed one is refused here rather than by a reviewer that has already
 * been spawned to read it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validatedAnswer } from "../../../../../cli/commands/turn/reviewOpen.js";
import { briefSubject, type ReviewSubject } from "../../../../../cli/commands/turn/reviewSubject.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { buildTurnRoutingBrief } from "../../../../../live/turn/brief.js";
import type { RespondDecision } from "../../../../../live/turn/tier.js";

const RESPOND: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "context and judgement alone answer this",
  response: "respond",
  schemaVersion: 1,
  tier: "inline",
  truthMode: "none",
};

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A home carrying a brief and a `respond` decision, resolved into the subject the open mode reviews. */
function subjectInHome(): { readonly home: string; readonly subject: ReviewSubject } {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-review-open-"));
  dirs.push(home);
  const brief = buildTurnRoutingBrief({
    channel: "C2",
    messageTs: "1785000000.000200",
    question: "did the staging pool exhaust overnight?",
    routingInput: {
      availableCapabilities: [],
      context: { controlPlane: { ownerAddressingText: "pool?", structuralMetadata: [] }, quotedEvidence: [] },
      execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
    },
    surface: "channel",
    threadTs: "1785000000.000200",
    unavailableCapabilities: [],
    userId: "U0OWNER",
  });
  const briefPath = join(home, "b.json");
  const decisionPath = join(home, "d.json");
  writeFileSync(briefPath, JSON.stringify(brief), "utf8");
  writeFileSync(decisionPath, JSON.stringify(RESPOND), "utf8");
  return { home, subject: unwrap(briefSubject({ briefPath, decisionPath })) };
}

describe("validatedAnswer", () => {
  it("names the path it could not read when the answer file is not there", () => {
    const { home, subject } = subjectInHome();
    const answerPath = join(home, "absent.json");
    const read = validatedAnswer({ answerPath, home, subject });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("FILE_UNREADABLE");
    expect(unwrapErr(read).message).toContain(`could not read the answer at ${answerPath}`);
  });

  it("says the answer is not JSON rather than letting a parse throw reach the caller", () => {
    const { home, subject } = subjectInHome();
    const answerPath = join(home, "broken.json");
    writeFileSync(answerPath, "{ not json at all", "utf8");
    const read = validatedAnswer({ answerPath, home, subject });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("DOCUMENT_NOT_JSON");
    expect(unwrapErr(read).message).toContain("the answer is not JSON");
  });
});
