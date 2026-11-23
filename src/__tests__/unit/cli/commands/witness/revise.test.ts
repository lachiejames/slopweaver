/**
 * `witness revise` as a verb: each refusal's exit code, and the runner over injected seams — help, a usage refusal,
 * a revision that lands and is journalled, and a correction runner's own exit passed through with nothing journalled.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";
import { runWitnessReviseWith, witnessReviseExitCode } from "../../../../../cli/commands/witness/revise.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { WitnessJournalErrors } from "../../../../../live/witness/errors.js";
import type { WitnessReviseDeps } from "../../../../../live/witness/revise.js";
import { type WitnessReviseError, WitnessReviseErrors } from "../../../../../live/witness/reviseErrors.js";
import { type WitnessJournalEvent, type WitnessKey, witnessIdOf } from "../../../../../live/witness/types.js";

const KEY: WitnessKey = { channel: "C0SYN000000001", messageTs: "1789000000.000200", threadTs: "1789000000.000100" };
const ID = witnessIdOf({ key: KEY });
const POSTED_TS = "1789000000.000300";
const BECAUSE = "https://example.slack.com/archives/C0SYN000000001/p1789000000000400?thread_ts=1789000000.000100";
const ARGV = [
  "node",
  "cli",
  "witness",
  "revise",
  ID,
  "--wrong",
  "is NZ staff",
  "--correction",
  "she resolves in the AU lookup.",
  "--because",
  BECAUSE,
  "--home",
  "/unused-home",
];

/** The witness, settled posted with its reply's ts. */
const POSTED: WitnessJournalEvent = {
  ...KEY,
  kind: "settled",
  outcome: "posted",
  postedTs: POSTED_TS,
  schemaVersion: 1,
  tsIso: "2026-10-17T23:24:10.000Z",
  witnessId: ID,
};

/** Seams over a fixed journal, recording what was appended and which home the deps were built for. */
function seams({
  events,
  corrected,
}: {
  events: readonly WitnessJournalEvent[];
  corrected: Awaited<ReturnType<WitnessReviseDeps["correct"]>>;
}): { readonly deps: (args: { home: string }) => WitnessReviseDeps; readonly appended: WitnessJournalEvent[] } {
  const appended: WitnessJournalEvent[] = [];
  const deps = (): WitnessReviseDeps => ({
    append: ({ event }) => {
      appended.push(event);
      return ok(undefined);
    },
    correct: async () => corrected,
    lock: () => ok({ release: () => appended.length }),
    nowIso: () => "2026-10-18T00:40:00.000Z",
    readJournal: () => ok(events),
  });
  return { appended, deps };
}

describe("witnessReviseExitCode", () => {
  const cause = WitnessJournalErrors.unreadable({ cause: new Error("EACCES"), path: "/x" });
  it.each<[WitnessReviseError, number]>([
    [WitnessReviseErrors.locked({ reason: "held" }), EXIT_DEFERRED],
    [WitnessReviseErrors.unknown({ witnessId: ID }), EXIT_EXPECTED_EMPTY],
    [WitnessReviseErrors.alreadyRevised({ witnessId: ID }), EXIT_EXPECTED_EMPTY],
    [WitnessReviseErrors.notPosted({ outcome: "live", witnessId: ID }), EXIT_EXPECTED_EMPTY],
    [WitnessReviseErrors.postedTsMissing({ witnessId: ID }), EXIT_EXPECTED_EMPTY],
    [WitnessReviseErrors.correctionNotApplied({ exitCode: EXIT_USAGE }), EXIT_USAGE],
    [WitnessReviseErrors.journal({ cause }), EXIT_ERROR],
    [WitnessReviseErrors.recordFailed({ cause }), EXIT_ERROR],
  ])("%j exits %i", (error, code) => {
    expect(witnessReviseExitCode({ error })).toBe(code);
  });
});

describe("runWitnessReviseWith", () => {
  it("prints its usage on --help and journals nothing", async () => {
    const { appended, deps } = seams({ corrected: ok(undefined), events: [POSTED] });
    expect([
      await runWitnessReviseWith({ argv: ["node", "cli", "witness", "revise", "--help"], deps }),
      appended,
    ]).toEqual([EXIT_OK, []]);
  });

  it("refuses a run missing --because as usage, before any seam is built", async () => {
    const { appended, deps } = seams({ corrected: ok(undefined), events: [POSTED] });
    const argv = ARGV.filter((arg) => arg !== "--because" && arg !== BECAUSE);
    expect([await runWitnessReviseWith({ argv, deps }), appended]).toEqual([EXIT_USAGE, []]);
  });

  it("journals one revised row aimed at the posted reply when the correction lands", async () => {
    const { appended, deps } = seams({ corrected: ok(undefined), events: [POSTED] });
    expect(await runWitnessReviseWith({ argv: ARGV, deps })).toBe(EXIT_OK);
    expect(appended).toEqual([
      expect.objectContaining({ because: BECAUSE, kind: "revised", postedTs: POSTED_TS, witnessId: ID }),
    ]);
  });

  it("exits 3 for a witness the journal does not hold", async () => {
    const { appended, deps } = seams({ corrected: ok(undefined), events: [] });
    expect([await runWitnessReviseWith({ argv: ARGV, deps }), appended]).toEqual([EXIT_EXPECTED_EMPTY, []]);
  });

  it("passes a correction runner's own exit through and journals nothing", async () => {
    const corrected = err(WitnessReviseErrors.correctionNotApplied({ exitCode: EXIT_USAGE }));
    const { appended, deps } = seams({ corrected, events: [POSTED] });
    expect([await runWitnessReviseWith({ argv: ARGV, deps }), appended]).toEqual([EXIT_USAGE, []]);
  });
});
