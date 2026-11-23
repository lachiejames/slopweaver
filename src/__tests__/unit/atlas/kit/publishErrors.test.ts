/**
 * The publish half of the atlas kit's typed failures: every factory renders the exact text the
 * `readonly string[]` it replaced carried, and {@link atlasPublishErrorLines} gives a list variant one line
 * per problem, in order, while a single-sentence variant prints its one line.
 */
import { describe, expect, it } from "vitest";

import { AtlasPublishErrors, atlasPublishErrorLines } from "../../../../atlas/kit/publishErrors.js";

describe("AtlasPublishErrors", () => {
  it("prints a lease taken for another atlas as the one sentence it has always been", () => {
    const error = AtlasPublishErrors.leaseForeign({
      home: "/home/b",
      leaseHome: "/home/a",
      leasePlatform: "vanta",
      platform: "workos",
    });
    expect(error.code).toBe("LEASE_FOREIGN");
    expect(atlasPublishErrorLines({ error })).toEqual([
      "the mutation lease offered was taken for vanta under /home/a, not for workos under /home/b — a lease " +
        "proves ONE atlas's lock is held and can never stand in for another's, so nothing was written",
    ]);
  });

  it("prints a moved generation as a single line, not split at its sentence joins", () => {
    const error = AtlasPublishErrors.generationMoved({ platform: "workos" });
    expect(error.code).toBe("GENERATION_MOVED");
    expect(atlasPublishErrorLines({ error })).toEqual([
      "another writer published a workos generation while this one was being built, so publishing now would " +
        "discard what it wrote — nothing was written, and running the verb again will read the newer generation " +
        "and merge onto it",
    ]);
  });

  it("ends every stamped-generation refusal with the not-published line, after the problems in order", () => {
    const error = AtlasPublishErrors.kindsIncoherent({ problems: ["first problem", "second problem"] });
    expect(error.code).toBe("KINDS_INCOHERENT");
    expect(atlasPublishErrorLines({ error })).toEqual([
      "first problem",
      "second problem",
      "nothing was written — this generation is not published",
    ]);
    expect(error.message).toBe("first problem; second problem; nothing was written — this generation is not published");
  });

  it("forwards an unreadable live generation's own lines ahead of the not-published line", () => {
    const error = AtlasPublishErrors.generationUnreadable({ reasons: ["manifest.json is not valid JSON"] });
    expect(error.code).toBe("GENERATION_UNREADABLE");
    expect(atlasPublishErrorLines({ error })).toEqual([
      "manifest.json is not valid JSON",
      "nothing was written — this generation is not published",
    ]);
  });

  it("heads an emptied kind with the empty-a-kind line and a degraded run with the FAILED line", () => {
    const emptied = AtlasPublishErrors.evidenceWouldBeLost({
      emptied: true,
      lost: ["  control (emptied): 0 entities / 0 artifact(s), replacing 500 / 0"],
      platform: "vanta",
    });
    expect(atlasPublishErrorLines({ error: emptied })).toEqual([
      "this vanta publish would empty a kind the store already holds, so it is refused:",
      "  control (emptied): 0 entities / 0 artifact(s), replacing 500 / 0",
      "nothing was written — the record that worked still stands. Fix what the run reported and run it again",
    ]);
    const degraded = AtlasPublishErrors.evidenceWouldBeLost({
      emptied: false,
      lost: ["  page (degraded): 3 entities / 0 artifact(s), replacing 3 / 3"],
      platform: "github",
    });
    expect(atlasPublishErrorLines({ error: degraded })).toEqual([
      "this github run FAILED and would publish less than the store already holds, so it is refused:",
      "  page (degraded): 3 entities / 0 artifact(s), replacing 3 / 3",
      "nothing was written — the record that worked still stands. Fix what the run reported and run it again",
    ]);
  });

  it("appends the hatch lines after the evidence-loss refusal, in that order", () => {
    const error = AtlasPublishErrors.evidenceLossRefused({
      hatchLines: ["hatch line one", "hatch line two"],
      refusal: AtlasPublishErrors.evidenceWouldBeLost({
        emptied: true,
        lost: ["  control (emptied): 0 entities / 0 artifact(s), replacing 500 / 0"],
        platform: "vanta",
      }),
    });
    expect(error.code).toBe("EVIDENCE_LOSS_REFUSED");
    expect(atlasPublishErrorLines({ error })).toEqual([
      "this vanta publish would empty a kind the store already holds, so it is refused:",
      "  control (emptied): 0 entities / 0 artifact(s), replacing 500 / 0",
      "nothing was written — the record that worked still stands. Fix what the run reported and run it again",
      "hatch line one",
      "hatch line two",
    ]);
  });

  it("says the published generation is untouched when an aborted install rolled everything back", () => {
    const cause = AtlasPublishErrors.installFailed({ cause: new Error("EACCES"), path: "/atlas/beta.jsonl" });
    const error = AtlasPublishErrors.installAborted({ cause, rollbackFailures: [] });
    expect(error.code).toBe("INSTALL_ABORTED");
    expect(atlasPublishErrorLines({ error })).toEqual([
      "cannot install /atlas/beta.jsonl: EACCES",
      "nothing was installed — the published generation is untouched",
    ]);
  });

  it("names each file the rollback could not restore instead of claiming the generation is untouched", () => {
    const cause = AtlasPublishErrors.previousNotParked({ cause: new Error("EBUSY"), path: "/atlas/alpha.jsonl" });
    const error = AtlasPublishErrors.installAborted({
      cause,
      rollbackFailures: ["the previous /atlas/a is at /atlas/a.superseding and could not be restored: EPERM"],
    });
    expect(atlasPublishErrorLines({ error })).toEqual([
      "cannot install /atlas/alpha.jsonl: the previous generation could not be moved aside: EBUSY",
      "the previous /atlas/a is at /atlas/a.superseding and could not be restored: EPERM",
    ]);
  });

  it("ends a stage failure with the untouched line", () => {
    const error = AtlasPublishErrors.stageFailed({ reasons: ["cannot write /atlas/alpha.jsonl.publishing"] });
    expect(atlasPublishErrorLines({ error })).toEqual([
      "cannot write /atlas/alpha.jsonl.publishing",
      "nothing was installed — the published generation is untouched",
    ]);
  });

  it("names the busy atlas and its holder, then says nothing was written", () => {
    const error = AtlasPublishErrors.publishLockHeld({ holder: "pid 42 since 10:00", platform: "notion" });
    expect(error.code).toBe("PUBLISH_LOCK_HELD");
    expect(atlasPublishErrorLines({ error })).toEqual([
      "another process is publishing the notion atlas: pid 42 since 10:00",
      "nothing was written — run the verb again once it has finished",
    ]);
  });

  it("lists every refused sensitivity finding between its headline and its closing line", () => {
    const error = AtlasPublishErrors.sensitiveValueRefused({
      findings: [
        { path: "$.a", reason: "a token", witness: "w1" },
        { path: "$.b", reason: "an email", witness: "w2" },
      ],
      label: "workspaces.json",
    });
    expect(atlasPublishErrorLines({ error })).toEqual([
      "refusing to write workspaces.json: the sensitivity gate found 2 thing(s) that must never reach this atlas",
      "  $.a: a token [witness w1]",
      "  $.b: an email [witness w2]",
      "nothing was written — the value itself is deliberately not printed above",
    ]);
  });

  it("names each duplicated entity id once, sorted", () => {
    const error = AtlasPublishErrors.entityIdsDuplicated({ ids: ["b", "a", "b"] });
    expect(atlasPublishErrorLines({ error })).toEqual([
      "this run produced the same entity id twice: a, b",
      "refusing to merge — one read producing two records for one thing is how a count double-counts",
    ]);
  });

  it("names each duplicated gap id once, sorted, on one line", () => {
    const error = AtlasPublishErrors.gapIdsDuplicated({ ids: ["z", "y", "z"] });
    expect(error.code).toBe("GAP_IDS_DUPLICATED");
    expect(atlasPublishErrorLines({ error })).toEqual(["this run reported the same gap twice: y, z"]);
  });
});
