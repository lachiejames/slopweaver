import { describe, expect, it } from "vitest";

import { MemoryVerbErrors } from "../../../../../cli/commands/memory/errors.js";

describe("MemoryVerbErrors", () => {
  it("builds corpusTooFresh carrying both measured durations in the payload and the message", () => {
    expect(MemoryVerbErrors.corpusTooFresh({ millisSinceChange: 137, quietPeriodMs: 5000 })).toEqual({
      code: "CORPUS_TOO_FRESH",
      message:
        "the corpus changed 137ms ago, inside the 5000ms quiet period — another session may be mid-save, " +
        "so this run judged nothing and will come back",
      millisSinceChange: 137,
      quietPeriodMs: 5000,
    });
  });

  it("builds exclusiveFlags joining the flags with and, in the order given", () => {
    expect(MemoryVerbErrors.exclusiveFlags({ flags: ["--dir-alpha", "--payload-bravo"] })).toEqual({
      code: "EXCLUSIVE_FLAGS",
      flags: ["--dir-alpha", "--payload-bravo"],
      message: "--dir-alpha and --payload-bravo are mutually exclusive",
    });
  });

  it("builds missingArgument naming the positional in angle brackets", () => {
    expect(MemoryVerbErrors.missingArgument({ argument: "proposal-charlie" })).toEqual({
      argument: "proposal-charlie",
      code: "MISSING_ARGUMENT",
      message: "<proposal-charlie> is required",
    });
  });

  it("builds missingDir as a MISSING_FLAG on --dir with the no-default reason", () => {
    expect(MemoryVerbErrors.missingDir()).toEqual({
      code: "MISSING_FLAG",
      flag: "--dir",
      message: "--dir is required (there is no default: auto-memory is keyed to the repository, not the cwd)",
    });
  });

  it("builds missingFlag with the caller's reason in parentheses", () => {
    expect(MemoryVerbErrors.missingFlag({ flag: "--repo-delta", why: "tree required echo" })).toEqual({
      code: "MISSING_FLAG",
      flag: "--repo-delta",
      message: "--repo-delta is required (tree required echo)",
    });
  });

  it("builds notWholeNumber quoting the offending value in backticks", () => {
    expect(MemoryVerbErrors.notWholeNumber({ flag: "--days-foxtrot", value: "seven-golf" })).toEqual({
      code: "NOT_WHOLE_NUMBER",
      flag: "--days-foxtrot",
      message: "--days-foxtrot must be a whole number of days, got `seven-golf`",
      value: "seven-golf",
    });
  });

  it("builds proposalNotFound pointing at the hygiene verb", () => {
    expect(MemoryVerbErrors.proposalNotFound({ id: "proposal-hotel" })).toEqual({
      code: "PROPOSAL_NOT_FOUND",
      id: "proposal-hotel",
      message: "no proposal carries the id `proposal-hotel` — run `slopweaver memory hygiene` to see the current ones",
    });
  });

  it("builds relativePath quoting the offending value in backticks", () => {
    expect(MemoryVerbErrors.relativePath({ flag: "--root-india", value: "relative/juliet" })).toEqual({
      code: "RELATIVE_PATH",
      flag: "--root-india",
      message: "--root-india must be an absolute path, got `relative/juliet`",
      value: "relative/juliet",
    });
  });

  it("builds unknownAnswer listing every allowed answer in the order given", () => {
    expect(
      MemoryVerbErrors.unknownAnswer({
        allowed: ["accepted-lima", "refused-mike", "parked-november"],
        value: "maybe-kilo",
      }),
    ).toEqual({
      allowed: ["accepted-lima", "refused-mike", "parked-november"],
      code: "UNKNOWN_ANSWER",
      message: "`maybe-kilo` is not an answer — use one of accepted-lima, refused-mike, parked-november",
      value: "maybe-kilo",
    });
  });
});
