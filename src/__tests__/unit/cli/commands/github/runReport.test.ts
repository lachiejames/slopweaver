/**
 * `report` prints a routed write's outcome and picks the exit code: a write the door did not perform is the
 * door's whole refusal and an error (the store's own message when it could not record the decision);
 * created/updated/unchanged exit 0; duplicate, refused and unconfirmed exit 1 — unconfirmed so a blind retry is
 * discouraged.
 */
import { describe, expect, it } from "vitest";

import { doorRefusalLines } from "../../../../../admit/doorRefusal.js";
import { DoorStoreErrors } from "../../../../../admit/doorStoreErrors.js";
import type { ThroughDoorResult } from "../../../../../admit/effects.js";
import type { DoorDecision } from "../../../../../admit/types.js";
import type { PrOutcome } from "../../../../../cli/commands/github/core.js";
import { report } from "../../../../../cli/commands/github/runReport.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";

const DECISION: DoorDecision = { findings: [], overridden: [], status: "pass" };

/** A door that warned: one registered finding carrying its correction and override token. */
const REFUSING_DECISION: DoorDecision = {
  findings: [
    {
      code: "answer.skill-load",
      correction: "read the skill, then name it in grounding.provenance.skillsLoaded",
      override: "answer.skill-load:v1",
      severity: "warn",
      summary: "no skill was loaded for an ask a skill covers",
    },
  ],
  overridden: [],
  status: "warn",
};

/** A door that declined the write: nothing was performed, and no outcome exists to print. */
const DOOR_REFUSED: ThroughDoorResult<PrOutcome> = {
  decision: REFUSING_DECISION,
  kind: "door-refused",
  performed: false,
};

/** A performed write carrying `result`. */
function performed({ result }: { result: PrOutcome }): ThroughDoorResult<PrOutcome> {
  return { decision: DECISION, kind: "performed", performed: true, result };
}

/** Run `report` with a plain collector for its output, answering the lines and the exit code. */
function reportOf({ routed }: { routed: ThroughDoorResult<PrOutcome> }): {
  lines: readonly string[];
  code: number;
} {
  const lines: string[] = [];
  const code = report({
    deps: {
      out: ({ line }) => {
        lines.push(line);
      },
    },
    routed,
  });
  return { code, lines };
}

describe("report", () => {
  it("prints the door's whole refusal, finding and override token, for a write the door did not perform", () => {
    const { code, lines } = reportOf({ routed: DOOR_REFUSED });
    expect(code).toBe(EXIT_ERROR);
    expect(lines).toEqual(doorRefusalLines({ command: "slopweaver github pr update", decision: REFUSING_DECISION }));
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("the door did not admit this (warn). Nothing was changed.");
    expect(lines[1]).toBe(
      "slopweaver github pr update blocked because no skill was loaded for an ask a skill covers [answer.skill-load].",
    );
  });

  it("says the decision was not recorded, rather than that the door declined, when the store refused it", () => {
    const error = DoorStoreErrors.storeUnavailable({ doing: "be opened", reason: "fixture: the store is down" });
    expect(reportOf({ routed: { decision: DECISION, error, kind: "recording-refused", performed: false } })).toEqual({
      code: EXIT_ERROR,
      lines: [`slopweaver github pr update not performed: ${error.message}`],
    });
  });

  it("prints a created pull request and exits 0", () => {
    expect(
      reportOf({
        routed: performed({ result: { kind: "created", number: 7, url: "https://github.com/a/b/pull/7" } }),
      }),
    ).toEqual({ code: EXIT_OK, lines: ["opened #7  https://github.com/a/b/pull/7"] });
  });

  it("prints an updated pull request and exits 0", () => {
    expect(
      reportOf({
        routed: performed({ result: { kind: "updated", number: 8, url: "https://github.com/a/b/pull/8" } }),
      }),
    ).toEqual({ code: EXIT_OK, lines: ["updated #8  https://github.com/a/b/pull/8"] });
  });

  it("prints both unchanged lines and exits 0", () => {
    expect(
      reportOf({
        routed: performed({ result: { kind: "unchanged", number: 9, url: "https://github.com/a/b/pull/9" } }),
      }),
    ).toEqual({
      code: EXIT_OK,
      lines: [
        "unchanged #9  https://github.com/a/b/pull/9",
        "  the merged description is byte-identical to the one already there, so nothing was sent.",
      ],
    });
  });

  it("prints all three unconfirmed safety lines and exits 1", () => {
    expect(
      reportOf({
        routed: performed({
          result: { detail: "the create response was lost", kind: "unconfirmed", locus: "feat/x -> main" },
        }),
      }),
    ).toEqual({
      code: EXIT_ERROR,
      lines: [
        "UNCONFIRMED: the create response was lost",
        "The reservation for feat/x -> main is held, and nothing here retries it — run this again.",
        "The next attempt reads the branch pair itself and releases or adopts whatever is there; `github pr release-reservation` settles a pair that read cannot.",
      ],
    });
  });

  it("prints a duplicate and exits 1", () => {
    expect(
      reportOf({ routed: performed({ result: { existing: 5, kind: "duplicate", locus: "feat/x -> main" } }) }),
    ).toEqual({
      code: EXIT_ERROR,
      lines: [
        "refused: feat/x -> main is already reserved by #5. A second pull request for the same branches would be a duplicate, not a retry.",
      ],
    });
  });

  it("prints a refusal and exits 1", () => {
    expect(
      reportOf({ routed: performed({ result: { kind: "refused", reason: "base branch is protected" } }) }),
    ).toEqual({ code: EXIT_ERROR, lines: ["refused: base branch is protected"] });
  });
});
