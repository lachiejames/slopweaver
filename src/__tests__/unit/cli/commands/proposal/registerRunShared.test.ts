import { describe, expect, it } from "vitest";

import { ProposalErrors } from "../../../../../cli/commands/proposal/errors.js";
import {
  announce,
  type ProposalRegisterDeps,
  refuse,
  refuseParse,
  VERB_ARG_OFFSET,
} from "../../../../../cli/commands/proposal/registerRunShared.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/**
 * Plain edges that record what each received; the clock records that it was read and nothing else.
 *
 * @returns the edges and what they observed
 */
function recordingDeps(): {
  readonly deps: ProposalRegisterDeps;
  readonly errLines: string[];
  readonly outLines: string[];
  readonly clockReads: number[];
} {
  const errLines: string[] = [];
  const outLines: string[] = [];
  const clockReads: number[] = [];
  return {
    clockReads,
    deps: {
      err: (line) => {
        errLines.push(line);
      },
      now: () => {
        clockReads.push(1);
        return new Date(0);
      },
      out: (line) => {
        outLines.push(line);
      },
    },
    errLines,
    outLines,
  };
}

describe("VERB_ARG_OFFSET", () => {
  it("is four: past node, the script, the noun and the verb", () => {
    expect(VERB_ARG_OFFSET).toBe(4);
  });
});

describe("refuse", () => {
  it("prints every line to stderr in order and returns the code unchanged", () => {
    const recorded = recordingDeps();
    expect(refuse({ code: 7, deps: recorded.deps, lines: ["line-alpha", "line-bravo"] })).toBe(7);
    expect(recorded.errLines).toEqual(["line-alpha", "line-bravo"]);
    expect(recorded.outLines).toEqual([]);
    expect(recorded.clockReads).toEqual([]);
  });

  it("prints nothing for an empty list and still returns the code", () => {
    const recorded = recordingDeps();
    expect(refuse({ code: 0, deps: recorded.deps, lines: [] })).toBe(0);
    expect(recorded.errLines).toEqual([]);
  });
});

describe("announce", () => {
  it("prints the human line without --json and answers EXIT_OK", () => {
    const recorded = recordingDeps();
    expect(announce({ deps: recorded.deps, json: false, line: "a-slug → decided", payload: { slug: "a-slug" } })).toBe(
      EXIT_OK,
    );
    expect(recorded.outLines).toEqual(["a-slug → decided"]);
    expect(recorded.errLines).toEqual([]);
  });

  it("prints the payload as indented JSON with --json, and not the line", () => {
    const recorded = recordingDeps();
    announce({ deps: recorded.deps, json: true, line: "a-slug → decided", payload: { slug: "a-slug" } });
    expect(recorded.outLines).toEqual(['{\n  "slug": "a-slug"\n}']);
  });
});

describe("refuseParse", () => {
  it("prints one stderr line per flag problem and answers EXIT_USAGE", () => {
    const recorded = recordingDeps();
    const error = ProposalErrors.flagsInvalid({ reasons: ["unknown flag: --charlie", "--why needs a value"] });
    expect(refuseParse({ deps: recorded.deps, error })).toBe(EXIT_USAGE);
    expect(recorded.errLines).toEqual(["unknown flag: --charlie", "--why needs a value"]);
    expect(recorded.outLines).toEqual([]);
  });

  it("prints a single-message error's message once", () => {
    const recorded = recordingDeps();
    expect(refuseParse({ deps: recorded.deps, error: ProposalErrors.whyRequired() })).toBe(EXIT_USAGE);
    expect(recorded.errLines).toEqual(['--why "<reason>" is required']);
  });
});
