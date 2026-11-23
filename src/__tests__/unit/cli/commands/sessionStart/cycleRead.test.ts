/**
 * `readCycleProposals` over an injected reconcile pass: what it forwards to the pass, the empty leg carrying
 * the typed refusal when the pass cannot run, and how a report's proposals are counted versus mapped.
 */
import { describe, expect, it } from "vitest";

import { type CycleProposalReader, readCycleProposals } from "../../../../../cli/commands/sessionStart/cycleRead.js";
import { CycleErrors } from "../../../../../cycle/errors.js";
import type { CycleProposal, CycleReconcileReport } from "../../../../../cycle/types.js";
import { err, ok } from "../../../../../lib/result.js";
import { memoryIdentityRosterPort } from "../../../../identityRosterFixture.js";

const HOME = "/fixture/home";
const ROSTER = memoryIdentityRosterPort();
const NOW = "2026-10-13T09:00:00.000Z";

/** A close proposal whose subject states when it last moved, so the leg can map it. */
const DATED: CycleProposal = {
  action: "close-with-comment",
  daysSinceMoved: 3,
  evidence: [{ fact: "the linked pull request merged on 9 Oct", url: "https://github.com/acme/app/pull/12" }],
  headline: "INFR-1 is open but its pull request merged — close it with a comment",
  movedAtIso: "2026-10-10T09:00:00.000Z",
  oneWordReplies: ["close"],
  subject: "INFR-1",
  title: "Rotate the staging key",
  url: "https://linear.app/acme/issue/INFR-1",
};

/** A project proposal whose source states no instant, which the leg cannot turn into a row. */
const UNDATED: CycleProposal = {
  action: "project-update",
  daysSinceMoved: Number.MAX_SAFE_INTEGER,
  evidence: [{ fact: "the project has never posted a status update" }],
  headline: "Vulnerability management has no status update — post one",
  oneWordReplies: ["post"],
  subject: "Vulnerability management",
  url: "https://linear.app/acme/project/vuln",
};

/** One whole report carrying both proposals and one thing the pass could not see. */
const REPORT: CycleReconcileReport = {
  couldNotSee: ["2 pull requests the corpus never saw"],
  generatedAtIso: NOW,
  home: HOME,
  owner: "Ada",
  proposals: [DATED, UNDATED],
  proposalsOnly: true,
  scan: {
    assignedEver: 4,
    liveProjectsLed: 1,
    openInCurrentCycle: 2,
    staleInCurrentCycle: 1,
    teamsWithCurrentCycle: 1,
  },
  wrote: false,
};

/**
 * A pass that answers with the given outcome and records each input it was given.
 *
 * @returns the seam and its recorded inputs
 */
function recordingPass({ outcome }: { outcome: "report" | "refusal" }): {
  readonly readPass: CycleProposalReader;
  readonly inputs: unknown[];
} {
  const inputs: unknown[] = [];
  const readPass: CycleProposalReader = async (input) => {
    inputs.push(input);
    if (outcome === "refusal") {
      return err(CycleErrors.noLinearCorpus({ home: input.home }));
    }
    return ok(REPORT);
  };
  return { inputs, readPass };
}

describe("readCycleProposals", () => {
  it("forwards the home, the run's instant and the verify flag to the pass exactly", async () => {
    const pass = recordingPass({ outcome: "report" });

    await readCycleProposals({
      home: HOME,
      identityRoster: ROSTER,
      nowIso: NOW,
      readPass: pass.readPass,
      verify: true,
    });

    expect(pass.inputs).toEqual([{ home: HOME, identityRoster: ROSTER, nowIso: NOW, verify: true }]);
  });

  it("turns a NO_LINEAR_CORPUS refusal into an empty leg that carries the refusal and says why", async () => {
    const pass = recordingPass({ outcome: "refusal" });

    const read = await readCycleProposals({
      home: HOME,
      identityRoster: ROSTER,
      nowIso: NOW,
      readPass: pass.readPass,
      verify: true,
    });

    expect(read.refusal).toEqual(CycleErrors.noLinearCorpus({ home: HOME }));
    expect(read.refusal!.code).toBe("NO_LINEAR_CORPUS");
    expect(read.couldNotSee).toEqual([
      "the cycle leg could not run, so nothing from your Linear cycle is here: no Linear bronze under /fixture/home — run `slopweaver refresh --source linear` first",
    ]);
    expect(read.proposalsRead).toBe(0);
    expect(read.inputs).toEqual([]);
  });

  it("counts every proposal the pass made but maps only the one whose instant is stated, carrying couldNotSee through", async () => {
    const pass = recordingPass({ outcome: "report" });

    const read = await readCycleProposals({
      home: HOME,
      identityRoster: ROSTER,
      nowIso: NOW,
      readPass: pass.readPass,
      verify: true,
    });

    expect(read.proposalsRead).toBe(2);
    expect(read.inputs.map((input) => input.item.nativeId)).toEqual(["INFR-1"]);
    expect(read.couldNotSee).toEqual(["2 pull requests the corpus never saw"]);
    expect(read.refusal).toBe(undefined);
  });

  it("marks the mapped rows verified when the pass re-read live, and unverified when it did not", async () => {
    const verified = await readCycleProposals({
      home: HOME,
      identityRoster: ROSTER,
      nowIso: NOW,
      readPass: recordingPass({ outcome: "report" }).readPass,
      verify: true,
    });
    const unverified = await readCycleProposals({
      home: HOME,
      identityRoster: ROSTER,
      nowIso: NOW,
      readPass: recordingPass({ outcome: "report" }).readPass,
      verify: false,
    });

    expect(verified.inputs.map((input) => input.unverified)).toEqual([false]);
    expect(unverified.inputs.map((input) => input.unverified)).toEqual([true]);
  });
});
