/**
 * `slack draft corrections`' shell: an input that did not read prints nothing, and one that did prints the report.
 * The fold itself is `outbound/slack/draftCorrections.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import {
  type DraftCorrectionsDeps,
  runDraftCorrections,
} from "../../../../../cli/commands/slack/draftCorrectionsRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { CORRECTION_RESIDUE } from "../../../../../outbound/slack/draftCorrections.js";

/** Run over an empty register with the two reads given, collecting every line. */
function run({ reads, json }: { reads: DraftCorrectionsDeps; json: boolean }): {
  readonly code: number;
  readonly lines: readonly string[];
} {
  const lines: string[] = [];
  const code = runDraftCorrections({
    deps: {
      ...reads,
      out: (line) => {
        lines.push(line);
      },
    },
    home: "/nowhere",
    items: [],
    json,
  });
  return { code, lines };
}

const READ_WHOLE: DraftCorrectionsDeps = {
  readSteerReceipts: () => ok({ rows: [], undecoded: 0 }),
  readVoiceRules: () => ok([]),
};

describe("runDraftCorrections", () => {
  it("prints nothing when the owner's voice rules or the relay ledger did not read", () => {
    const noRules = run({
      json: false,
      reads: { ...READ_WHOLE, readVoiceRules: () => err({ message: "no profile" }) },
    });
    const noLedger = run({
      json: false,
      reads: { ...READ_WHOLE, readSteerReceipts: () => err({ message: "ledger torn" }) },
    });

    expect([noRules, noLedger]).toEqual([
      { code: EXIT_ERROR, lines: [] },
      { code: EXIT_ERROR, lines: [] },
    ]);
  });

  it("prints the report as one JSON document, an empty register included", () => {
    const { code, lines } = run({ json: true, reads: READ_WHOLE });

    expect(code).toBe(EXIT_OK);
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ events: [], residue: CORRECTION_RESIDUE, reviewed: [] }]);
  });
});
