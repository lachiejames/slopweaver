import { describe, expect, it } from "vitest";

import { SessionStartErrors } from "../../../cli/commands/sessionStart/errors.js";
import {
  LOCK_IN_FLAG_NAMES,
  lockInOptions,
  outcomeIssues,
  parseLockInArgs,
} from "../../../cli/commands/sessionStart/lockInCore.js";
import { unwrap } from "../../../lib/result.js";
import { LOCK_IN_OUTCOMES, LOCK_IN_VERBS } from "../../../sessionStart/lockIn.js";

const NOW = "2026-08-30T12:00:00.000Z";

const VALID: readonly string[] = [
  "--item",
  "linear:AAA-1",
  "--against",
  "2026-08-20T00:00:00.000Z",
  "--proposed",
  "close it, the work shipped",
  "--reply",
  "do",
  "--outcome",
  "approved-as-proposed",
];

const read = ({ rest }: { rest: readonly string[] }) =>
  lockInOptions({ nowIso: NOW, parsed: unwrap(parseLockInArgs({ rest })) });

describe("outcomeIssues", () => {
  it("refuses a deferral with no date, which would hold the item off the list forever", () => {
    expect(outcomeIssues({ outcome: "deferred", reason: undefined, until: undefined })).toStrictEqual([
      "--until is required with --outcome deferred, or the item is held off the list forever",
    ]);
  });

  it("refuses a date on an outcome that is not a deferral", () => {
    expect(outcomeIssues({ outcome: "dropped", reason: undefined, until: "2026-09-05T00:00:00.000Z" })).toStrictEqual([
      "--until only applies to --outcome deferred, not dropped",
    ]);
  });

  it("requires a reason on a rejection, because that is what makes the correction countable", () => {
    expect(outcomeIssues({ outcome: "rejected", reason: undefined, until: undefined })).toStrictEqual([
      "--reason is required with --outcome rejected — it is what makes the correction countable",
    ]);
  });

  it("requires a reason on an edit for the same reason", () => {
    expect(outcomeIssues({ outcome: "edited", reason: undefined, until: undefined })).toHaveLength(1);
  });

  it("passes a coherent deferral", () => {
    expect(outcomeIssues({ outcome: "deferred", reason: "not-now", until: "2026-09-05T00:00:00.000Z" })).toStrictEqual(
      [],
    );
  });

  it("passes an approval carrying nothing extra", () => {
    expect(outcomeIssues({ outcome: "approved-as-proposed", reason: undefined, until: undefined })).toStrictEqual([]);
  });
});

describe("lockInOptions", () => {
  it("builds the row, stamping the supplied instant rather than a clock", () => {
    const options = unwrap(read({ rest: VALID }));
    expect(options.row.tsIso).toBe(NOW);
    expect(options.row.identity).toBe("linear:AAA-1");
    expect(options.row.againstWhenIso).toBe("2026-08-20T00:00:00.000Z");
    expect(options.row.proposed).toBe("close it, the work shipped");
    expect(options.row.verb).toBe("do");
    expect(options.row.outcome).toBe("approved-as-proposed");
  });

  it("refuses a reply outside the vocabulary, naming what it accepts", () => {
    const refused = read({ rest: [...VALID.slice(0, 7), "teleport", ...VALID.slice(8)] });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr()).toEqual(
      SessionStartErrors.lockInRefused({
        refusals: [
          SessionStartErrors.notInVocabulary({
            allowed: ["do", "hand-off", "defer", "skip", "note"],
            flag: "--reply",
            got: "teleport",
          }),
        ],
      }),
    );
    expect(refused._unsafeUnwrapErr().message).toBe(
      "--reply must be one of do, hand-off, defer, skip, note, got teleport",
    );
  });

  it("refuses an outcome outside the vocabulary", () => {
    const refused = read({ rest: [...VALID.slice(0, 9), "maybe"] });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("LOCK_IN_REFUSED");
    expect(refused._unsafeUnwrapErr().message).toContain("--outcome must be one of");
  });

  it("reports every missing required flag at once, rather than one per run", () => {
    const refused = read({ rest: [] });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr()).toEqual(
      SessionStartErrors.lockInRefused({
        refusals: [
          SessionStartErrors.flagMissing({ flag: "--item" }),
          SessionStartErrors.flagMissing({ flag: "--against" }),
          SessionStartErrors.flagMissing({ flag: "--proposed" }),
          SessionStartErrors.vocabularyFlagMissing({ allowed: LOCK_IN_VERBS, flag: "--reply" }),
          SessionStartErrors.vocabularyFlagMissing({ allowed: LOCK_IN_OUTCOMES, flag: "--outcome" }),
        ],
      }),
    );
  });

  it("refuses a deferral with no date once every flag parsed, naming the disagreement", () => {
    const refused = read({ rest: [...VALID.slice(0, 9), "deferred"] });
    expect(refused._unsafeUnwrapErr()).toEqual(
      SessionStartErrors.outcomeIncoherent({
        reasons: ["--until is required with --outcome deferred, or the item is held off the list forever"],
      }),
    );
  });

  it("carries a note verbatim, which is the rule for every transcript", () => {
    const options = unwrap(read({ rest: [...VALID, "--note", "the fix landed in the other change"] }));
    expect(options.row.note).toBe("the fix landed in the other change");
  });

  it("omits the optional fields entirely when they were not given", () => {
    const options = unwrap(read({ rest: VALID }));
    expect(options.row.note).toBeUndefined();
    expect(options.row.reason).toBeUndefined();
    expect(options.row.deferredUntilIso).toBeUndefined();
  });
});

describe("LOCK_IN_FLAG_NAMES", () => {
  it("names every string and boolean flag the parser declares", () => {
    expect(LOCK_IN_FLAG_NAMES.toSorted()).toStrictEqual(
      [
        "--against",
        "--home",
        "--item",
        "--json",
        "--note",
        "--now",
        "--outcome",
        "--proposed",
        "--reason",
        "--reply",
        "--until",
      ].toSorted(),
    );
  });
});
