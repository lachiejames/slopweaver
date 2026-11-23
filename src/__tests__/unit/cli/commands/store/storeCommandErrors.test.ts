/**
 * The store verbs' typed failures print exactly what the `readonly string[]` they replaced printed: one line per
 * flag problem, refusal or facet line, and the message otherwise.
 */
import { describe, expect, it } from "vitest";
import { StoreCommandErrors, storeCommandErrorLines } from "../../../../../cli/commands/store/errors.js";

describe("storeCommandErrorLines", () => {
  it("gives each flag problem its own line", () => {
    const reasons = ["unknown flag: --sauce", "--limit needs a value"];
    const error = StoreCommandErrors.flagsInvalid({ reasons });
    expect(storeCommandErrorLines({ error })).toEqual(reasons);
    expect(error.message).toBe("unknown flag: --sauce; --limit needs a value");
  });

  it("gives each accumulated refusal its own line", () => {
    const reasons = ['--limit takes a whole number, not "no"', '--offset takes a whole number, not "nope"'];
    const error = StoreCommandErrors.argumentsRefused({ reasons });
    expect(storeCommandErrorLines({ error })).toEqual(reasons);
    expect(error.message).toBe('--limit takes a whole number, not "no"; --offset takes a whole number, not "nope"');
  });

  it("keeps an unknown facet's name first and the facets it could have named after it", () => {
    expect(
      storeCommandErrorLines({ error: StoreCommandErrors.facetUnknown({ facet: "body", known: ["source", "kind"] }) }),
    ).toEqual(['no facet named "body"', "facets: source, kind"]);
  });

  it("keeps a bad batch's refusal first and the usage after it", () => {
    expect(
      storeCommandErrorLines({
        error: StoreCommandErrors.batchInvalid({ flag: "batch", got: "0", usage: "usage: x" }),
      }),
    ).toEqual(['--batch must be a whole number of at least 1, not "0"', "usage: x"]);
  });

  it("gives a single-message variant its message", () => {
    expect(storeCommandErrorLines({ error: StoreCommandErrors.throughMissing() })).toEqual([
      "--through <tag> is required: the last migration this database already reflects, e.g. 0000_polite_lady_mastermind",
    ]);
  });
});

describe("StoreCommandErrors", () => {
  it("names what was typed when the exclusions verb is unknown", () => {
    const error = StoreCommandErrors.exclusionVerbUnknown({ got: "delete" });
    expect(error.code).toBe("VERB_UNKNOWN");
    expect(error.message).toBe('store exclusions: expected "detect" or "purge", got delete');
  });

  it("says nothing was typed rather than printing undefined", () => {
    expect(StoreCommandErrors.exclusionVerbUnknown({ got: undefined }).message).toBe(
      'store exclusions: expected "detect" or "purge", got nothing',
    );
  });

  it("names the flag and the value a whole number was refused for", () => {
    const error = StoreCommandErrors.integerRequired({ flag: "limit", got: "lots" });
    expect(error.code).toBe("INVALID_FLAG_VALUE");
    expect(error.message).toBe('--limit takes a whole number, not "lots"');
  });
});

describe("StoreCommandErrors parser leaves", () => {
  it.each([
    [
      StoreCommandErrors.waveQuestionMissing(),
      "ARGUMENT_MISSING",
      "name the question — a wave with no question briefs nobody",
    ],
    [StoreCommandErrors.waveTermMissing(), "ARGUMENT_MISSING", "--term is required, once per keyword to probe"],
    [StoreCommandErrors.variantNeedsName(), "ARGUMENT_MISSING", "--variant needs --name — a variant of what?"],
    [
      StoreCommandErrors.slotsInvalid({ got: "0" }),
      "INVALID_FLAG_VALUE",
      '--slots must be a whole number of at least 1, not "0"',
    ],
    [
      StoreCommandErrors.loadSourceUnknown({ known: ["github", "slack"], unknown: ["x", "y"] }),
      "INVALID_FLAG_VALUE",
      "store load pulls github, slack — not x, y",
    ],
    [
      StoreCommandErrors.fromPrefixInvalid({ got: "latest" }),
      "INVALID_FLAG_VALUE",
      '--from takes a <project>/<instant>/ prefix as the destination spells it, not "latest"',
    ],
    [
      StoreCommandErrors.containerNameInvalid({ got: "-bad" }),
      "INVALID_FLAG_VALUE",
      '--container "-bad" is not a name docker accepts',
    ],
    [
      StoreCommandErrors.rangeInvalid({ flag: "port", got: "9", max: 65535, min: 1024 }),
      "INVALID_FLAG_VALUE",
      '--port takes a whole number from 1024 to 65535, not "9"',
    ],
    [
      StoreCommandErrors.directoryValueMissing({ name: "out", verb: "export" }),
      "ARGUMENT_MISSING",
      "store export: --out needs a <dir> value",
    ],
    [
      StoreCommandErrors.approveDigestInvalid(),
      "INVALID_FLAG_VALUE",
      "store import: --approve needs the plan digest the plan printed, sha256: and 64 hex",
    ],
    [
      StoreCommandErrors.stopOnConflictNeedsApply(),
      "FLAG_REFUSED",
      "store import: --stop-on-conflict decides how --apply <batch-id> meets a difference; it needs --apply",
    ],
    [
      StoreCommandErrors.applyBatchIdInvalid(),
      "INVALID_FLAG_VALUE",
      "store import: --apply needs the staged batch id staging printed, a lowercase uuid",
    ],
    [
      StoreCommandErrors.applyTakesNoPlanFlags({ names: ["from", "approve"] }),
      "FLAG_REFUSED",
      "store import: --apply applies a batch already staged, so it takes no --from, --approve",
    ],
    [
      StoreCommandErrors.packageVersionMissing({ why: "it carries no version field" }),
      "ARGUMENT_MISSING",
      "this checkout's package.json gives no version: it carries no version field",
    ],
  ])("builds %#", (error, code, line) => {
    expect(error.code).toBe(code);
    expect(storeCommandErrorLines({ error })).toEqual([line]);
  });
});
