/**
 * Which waivers `github enqueue` actually RECORDS at the door.
 *
 * The load-bearing property under test is the one the ledger's usefulness rests on in both directions: a row
 * appears only when the finding was raised AND is no longer standing, so supplying the flags over a guard
 * that found nothing manufactures nothing, and a genuinely waived finding is never silently dropped.
 */
import { describe, expect, it } from "vitest";

import {
  enqueueAcknowledgements,
  REASON_REQUIRED_SUBJECTS,
  ROLLUP_SUPERSEDED_SUBJECT,
} from "../../../../../cli/commands/github/enqueueAcknowledgements.js";
import type { GithubEnqueueArgs } from "../../../../../cli/commands/github/enqueueArgs.js";
import type { EnqueueFinding } from "../../../../../cli/commands/github/enqueueFindings.js";
import { CODEX_LOOP_SUBJECT } from "../../../../../codex/landingGate.js";

/** One finding of the named subject; only the subject is read by anything here. */
function finding({ subject }: { subject: EnqueueFinding["subject"] }): EnqueueFinding {
  return { detail: `the ${subject} detail`, kind: subject, subject };
}

/** The parsed invocation, defaulting to the flags that waive both subjects with a reason. */
function args(over: Partial<GithubEnqueueArgs> = {}): GithubEnqueueArgs {
  return {
    acknowledge: [CODEX_LOOP_SUBJECT, ROLLUP_SUPERSEDED_SUBJECT],
    acknowledgeAll: false,
    dequeue: false,
    dryRun: false,
    home: undefined,
    json: false,
    number: 9,
    owner: "acme",
    reason: "run 33717812345 replaced it",
    repo: "widget",
    ...over,
  };
}

const PAIRING = finding({ subject: CODEX_LOOP_SUBJECT });
const ROLLUP = finding({ subject: ROLLUP_SUPERSEDED_SUBJECT });

describe("enqueueAcknowledgements", () => {
  it("records BOTH rows when both findings were raised and both were waived — the measured case", () => {
    expect(enqueueAcknowledgements({ args: args(), findings: [PAIRING, ROLLUP], unacknowledged: [] })).toEqual([
      { reason: "run 33717812345 replaced it", subject: CODEX_LOOP_SUBJECT },
      { reason: "run 33717812345 replaced it", subject: ROLLUP_SUPERSEDED_SUBJECT },
    ]);
  });

  it("records only the subject that was actually RAISED, so flags over a clean guard invent nothing", () => {
    expect(enqueueAcknowledgements({ args: args(), findings: [ROLLUP], unacknowledged: [] })).toEqual([
      { reason: "run 33717812345 replaced it", subject: ROLLUP_SUPERSEDED_SUBJECT },
    ]);
  });

  it("records nothing at all when no finding was raised", () => {
    expect(enqueueAcknowledgements({ args: args(), findings: [], unacknowledged: [] })).toEqual([]);
  });

  it("records nothing for a subject still STANDING against the write", () => {
    expect(
      enqueueAcknowledgements({
        args: args({ acknowledge: [CODEX_LOOP_SUBJECT] }),
        findings: [PAIRING, ROLLUP],
        unacknowledged: [ROLLUP],
      }),
    ).toEqual([{ reason: "run 33717812345 replaced it", subject: CODEX_LOOP_SUBJECT }]);
  });

  it("records no rollup row for a blank reason, since the run id is the whole point of the row", () => {
    expect(enqueueAcknowledgements({ args: args({ reason: "   " }), findings: [ROLLUP], unacknowledged: [] })).toEqual(
      [],
    );
  });

  it("declares both reason-requiring subjects, and nothing else", () => {
    expect(REASON_REQUIRED_SUBJECTS.length).toBeGreaterThan(0);
    expect([...REASON_REQUIRED_SUBJECTS]).toEqual([CODEX_LOOP_SUBJECT, ROLLUP_SUPERSEDED_SUBJECT]);
  });
});
