/**
 * The ask-shaped verbs' manifest entries, and the lifecycle meta both manifests share.
 *
 * Declared metadata only — every entry is lazy, so nothing here loads a command module. What this file
 * guards is that splitting them out of `handover.ts` did not drop any of them or change what the shared
 * meta says about them.
 */
import { describe, expect, it } from "vitest";

import { ASK_USAGE } from "../../../../cli/commands/handover/askUsage.js";
import { RECHECK_USAGE } from "../../../../cli/commands/handover/recheckUsage.js";
import { SET_WORKSPACE_USAGE } from "../../../../cli/commands/handover/setWorkspaceUsage.js";
import { SHOT_USAGE } from "../../../../cli/commands/handover/shotUsage.js";
import { handoverManifest } from "../../../../cli/manifests/handover.js";
import { handoverAskManifest } from "../../../../cli/manifests/handoverAsks.js";
import { lifecycleMeta } from "../../../../cli/manifests/handoverLifecycleMeta.js";

describe("handoverAskManifest", () => {
  // The criterion is the ASK SHAPE, not row creation: `offer` creates no row, but it goes through the same
  // `askOfferVerdict` both recording verbs do, and its usage text carries the same shape. A module drawn
  // round "creates a row" would put the two readers of one gate in two files. `reconfirm` sits beside them
  // because it re-dates that same shape's still-real check, the one field a card ages an ask by. `set-repo`
  // completes a row `register` left with no `repo:`, and `register`'s own usage names it. `tag` writes the same typed
  // tags `register --tag` seats a row with, one grammar and one lock between them. `set-workspace` states whose work
  // a row is, which `repo:` cannot, and `set-priority` the band it ranks in. `quote` writes the words an ask's anchor names onto its row, which its card leads with.
  // `withdraw` takes that same card back when its still-real check stops being true, the inverse of `reconfirm`.
  // `example` gives an open ask the concrete scenes its card leads with and `shot` the boxed
  // picture it shows. `recheck` re-dates a ready FINDING's trunk check the way `reconfirm`
  // re-dates a waiting ask's still-real check, offering it again once the trunk-moved hold took it off ready.
  it("holds exactly the verbs that record an ask's shape, re-date or withdraw it, or seat its row", () => {
    expect(Object.keys(handoverAskManifest).toSorted()).toEqual([
      "ask",
      "example",
      "offer",
      "quote",
      "recheck",
      "reconfirm",
      "register",
      "set-priority",
      "set-repo",
      "set-workspace",
      "shot",
      "tag",
      "withdraw",
    ]);
  });

  it("quotes `handover shot`'s usage off its leaf, naming the picture and its boxes", () => {
    expect(SHOT_USAGE.split("\n")[0]).toBe(
      "usage: slopweaver handover shot <slug> --shot <png> --box <x,y,width,height=label> [--box ...] " +
        "[--dir <path>] [--home <dir>]",
    );
  });

  it("quotes `handover recheck`'s usage off its leaf, naming the one flag it requires", () => {
    expect(handoverAskManifest["recheck"]!.meta.usage).toBe(RECHECK_USAGE);
    expect(RECHECK_USAGE.split("\n")[0]).toBe(
      "usage: slopweaver handover recheck <slug> --still-real <line> [--dir <path>] [--home <dir>]",
    );
  });

  it("quotes `handover set-workspace`'s usage off its leaf, naming both forms", () => {
    expect(handoverAskManifest["set-workspace"]!.meta.usage).toBe(SET_WORKSPACE_USAGE);
    expect(SET_WORKSPACE_USAGE.split("\n").slice(0, 2)).toEqual([
      "usage: slopweaver handover set-workspace <slug> [<slug> ...] --workspace team|self --because <why> " +
        "[--dir <path>] [--home <dir>]",
      "       slopweaver handover set-workspace --respell [--dir <path>] [--home <dir>]",
    ]);
  });

  it("reaches the one folded manifest, so the split did not drop a verb", () => {
    expect(handoverManifest["ask"]).toBe(handoverAskManifest["ask"]);
    expect(handoverManifest["offer"]).toBe(handoverAskManifest["offer"]);
    expect(handoverManifest["register"]).toBe(handoverAskManifest["register"]);
    expect(handoverManifest["reconfirm"]).toBe(handoverAskManifest["reconfirm"]);
    expect(handoverManifest["withdraw"]).toBe(handoverAskManifest["withdraw"]);
    expect(handoverManifest["set-repo"]).toBe(handoverAskManifest["set-repo"]);
    expect(handoverManifest["recheck"]).toBe(handoverAskManifest["recheck"]);
    expect(handoverManifest["tag"]).toBe(handoverAskManifest["tag"]);
    expect(handoverManifest["set-workspace"]).toBe(handoverAskManifest["set-workspace"]);
    expect(handoverManifest["set-priority"]).toBe(handoverAskManifest["set-priority"]);
    expect(handoverManifest["example"]).toBe(handoverAskManifest["example"]);
  });

  // The two halves of the rule that keeps a card from printing the owner's choice over a different message: the
  // options ARE the destinations, so `offer` derives them and advertises no flag that spells them. The
  // usage says so WITHOUT writing the token, because `helpTruth.test.ts` reads every `--word` in a usage
  // string as an advertised flag and `offer`'s parser refuses that one — prose naming it would be a lie
  // the ratchet correctly catches.
  it("advertises `--action` on `offer` and no flag spelling the options beside it", () => {
    const usage = handoverAskManifest["offer"]!.meta.usage;

    expect(usage).toContain("--action <json|path|->");
    expect(usage).toContain("this verb advertises no flag that spells them, and one is refused by name");
    expect(usage).not.toContain("--options");
  });

  it("quotes `handover ask`'s usage off its leaf, naming the flag a seat records its reading in", () => {
    expect(handoverAskManifest["ask"]!.meta.usage).toBe(ASK_USAGE);
    expect(ASK_USAGE.split("\n")[0]).toContain(" [--read-owner-words <slug,...>]");
  });

  it("advertises the three shape flags on `ask`, which is what the gate refuses without", () => {
    const usage = handoverAskManifest["ask"]!.meta.usage;

    expect(usage).toContain("--problem <line>");
    expect(usage).toContain("--options <lines>");
    expect(usage).toContain("--lean <line>");
  });

  // Both exemptions, because the measured defect was reading one as the other: `register` computed "needs a
  // shape" as "is not a finding", so `github landing --register` — a dispatch row, correctly carrying
  // neither flag — was refused on every invocation.
  it("advertises them on `register` too, and names BOTH rows that are exempt", () => {
    const usage = handoverAskManifest["register"]!.meta.usage;

    expect(usage).toContain("--problem <line>");
    expect(usage).toContain("absent on the two rows that ask the owner to pick nothing");
    expect(usage).toContain("a --finding, which is a session's own observation");
    expect(usage).toContain("a --dispatch, which is work a seat picks up");
  });

  it("marks `register` as creating a work item and `ask` as not, which is what each does", () => {
    expect(handoverAskManifest["register"]!.meta.createsWorkItem).toBe(true);
    expect(handoverAskManifest["ask"]!.meta.createsWorkItem).toBe(false);
  });
});

describe("lifecycleMeta", () => {
  it("carries the three strings through and fixes everything else", () => {
    expect(lifecycleMeta({ example: "e", summary: "s", usage: "u" })).toEqual({
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "e",
      parseRejectIsIoFree: true,
      summary: "s",
      usage: "u",
    });
  });
});
