/**
 * Whether a landing proceeds on its change set's private-terms verdict, and which base it sweeps against. Pure, no
 * mocks.
 */

import { describe, expect, it } from "vitest";
import { GithubVerbErrors } from "../../../../../cli/commands/github/errors.js";
import {
  landingBaseOf,
  PRIVATE_TERMS_UNCHECKED_ACK,
  privateTermsPermit,
  REASON_NAMES_A_TERM_LINE,
} from "../../../../../cli/commands/github/privateTermsPermit.js";
import { JUDGEMENT_NOTE } from "../../../../../hatch/render.js";
import type { ChangeSetPrivateTermsVerdict } from "../../../../../hygiene/changeSetPrivateTerms.js";
import { parsePrivateTerms } from "../../../../../hygiene/privateTerms.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";

/** The synthetic private value a reason below carries. */
const SYNTHETIC_VALUE = "acmefixtureword";

const NONE = { acknowledge: [], acknowledgeAll: false, reason: undefined } as const;
const NAMED = { acknowledge: [PRIVATE_TERMS_UNCHECKED_ACK], acknowledgeAll: false, reason: undefined } as const;
const BLANKET = { acknowledge: [], acknowledgeAll: true, reason: "a fork with no terms" } as const;

const CLEAN: ChangeSetPrivateTermsVerdict = { accepted: 0, binaryFiles: 0, kind: "clean", terms: [], textFiles: 1 };
const UNCHECKED: ChangeSetPrivateTermsVerdict = { detail: "no terms file here", kind: "unchecked", terms: [] };
const HOLD: ChangeSetPrivateTermsVerdict = {
  hits: [{ className: "owner-name", line: 1, locus: "a.ts" }],
  kind: "hold",
  reasons: [],
  terms: [],
};
/** The whole refusal an unwaived unchecked set prints: the verdict line, then the hatch row's four lines. */
const UNCHECKED_REFUSAL = [
  "private terms: NOT CHECKED — no terms file here",
  "slopweaver github <enqueue|merge --admin> blocked because the private terms did not check the change set this " +
    "landing would merge — the terms file is absent here, or the merged tree could not be read whole — so a private " +
    "word on a changed line would reach the base unseen; --acknowledge-all does not reach this subject (no terms file here).",
  "Legitimate exceptions may include this checkout is a fork or install with no private terms at all, so there is " +
    "nothing to scan for; the change set could not be read here (the merge does not apply cleanly, or the base could " +
    "not be fetched) and you have read every changed line for a private word yourself.",
  "To override use the designated escape hatch slopweaver github <enqueue|merge> --acknowledge " +
    'private-terms-unchecked --reason "<why>" (merge with --admin).',
  JUDGEMENT_NOTE,
];
const FRESH = ok({
  baseBranch: "main",
  baseSha: "b".repeat(40),
  headSha: "c".repeat(40),
  kind: "fresh" as const,
  remote: "origin",
  reverted: [],
});

describe("privateTermsPermit", () => {
  it("proceeds on a clean change set, recording no waiver", () => {
    const permit = privateTermsPermit({ acknowledgement: NONE, verdict: CLEAN });
    expect(permit.refused).toBe(false);
    expect(permit.acknowledgement).toBe(undefined);
  });

  it("refuses a hold under every acknowledgement, recording no waiver under either", () => {
    const blanket = privateTermsPermit({ acknowledgement: BLANKET, verdict: HOLD });
    const named = privateTermsPermit({ acknowledgement: { ...NAMED, reason: "a fork" }, verdict: HOLD });
    expect(blanket.refused).toBe(true);
    expect(named.refused).toBe(true);
    expect(blanket.acknowledgement).toBe(undefined);
    expect(named.acknowledgement).toBe(undefined);
  });

  it("refuses an unacknowledged unchecked set with the four-line refusal carrying its detail", () => {
    expect(privateTermsPermit({ acknowledgement: NONE, verdict: UNCHECKED })).toEqual({
      acknowledgement: undefined,
      lines: UNCHECKED_REFUSAL,
      refused: true,
    });
  });

  it("refuses an unchecked set named with no reason, or a blank one, since the waiver is recorded", () => {
    const refused = { acknowledgement: undefined, lines: UNCHECKED_REFUSAL, refused: true };
    expect(privateTermsPermit({ acknowledgement: NAMED, verdict: UNCHECKED })).toEqual(refused);
    expect(privateTermsPermit({ acknowledgement: { ...NAMED, reason: "  " }, verdict: UNCHECKED })).toEqual(refused);
  });

  it("judges the reason as typed as well as trimmed, so a whitespace-bound term cannot slip past the ledger", () => {
    const terms = unwrap(
      parsePrivateTerms({
        text: `class\tflags\tpattern\tsource\nowner-name\ti\t${SYNTHETIC_VALUE}(?=\\s+$)\tsynthetic\n`,
      }),
    );
    const permit = privateTermsPermit({
      acknowledgement: { ...NAMED, reason: `${SYNTHETIC_VALUE} ` },
      verdict: { ...UNCHECKED, terms },
    });
    expect(permit).toEqual({
      acknowledgement: undefined,
      lines: [UNCHECKED_REFUSAL[0], REASON_NAMES_A_TERM_LINE, ...UNCHECKED_REFUSAL.slice(1)],
      refused: true,
    });
    expect(permit.lines.filter((line) => line.toLowerCase().includes(SYNTHETIC_VALUE))).toEqual([]);
  });

  it("proceeds on an unchecked set named with a reason, handing the waiver to the door", () => {
    const permit = privateTermsPermit({ acknowledgement: { ...NAMED, reason: " a fork " }, verdict: UNCHECKED });
    expect(permit).toEqual({
      acknowledgement: { reason: "a fork", subject: "private-terms-unchecked" },
      lines: [UNCHECKED_REFUSAL[0], "ACKNOWLEDGED: private-terms-unchecked by name — reason: a fork"],
      refused: false,
    });
  });

  it("refuses an unchecked set under --acknowledge-all, since no blanket flag passes a scan that never ran", () => {
    expect(privateTermsPermit({ acknowledgement: BLANKET, verdict: UNCHECKED })).toEqual({
      acknowledgement: undefined,
      lines: UNCHECKED_REFUSAL,
      refused: true,
    });
  });

  it("proceeds when the subject is named beside --acknowledge-all, recording it by name", () => {
    const permit = privateTermsPermit({
      acknowledgement: { ...BLANKET, acknowledge: [PRIVATE_TERMS_UNCHECKED_ACK] },
      verdict: UNCHECKED,
    });
    expect(permit).toEqual({
      acknowledgement: { reason: "a fork with no terms", subject: "private-terms-unchecked" },
      lines: [
        "private terms: NOT CHECKED — no terms file here",
        "ACKNOWLEDGED: private-terms-unchecked by name — reason: a fork with no terms",
      ],
      refused: false,
    });
  });

  it("refuses a named waiver whose reason a loaded term matches, handing nothing to the door", () => {
    const terms = unwrap(
      parsePrivateTerms({ text: `class\tflags\tpattern\tsource\nowner-name\ti\t${SYNTHETIC_VALUE}\tsynthetic\n` }),
    );
    const permit = privateTermsPermit({
      acknowledgement: { ...NAMED, reason: `a fork near ${SYNTHETIC_VALUE.toUpperCase()}` },
      verdict: { ...UNCHECKED, terms },
    });
    expect(permit).toEqual({
      acknowledgement: undefined,
      lines: [UNCHECKED_REFUSAL[0], REASON_NAMES_A_TERM_LINE, ...UNCHECKED_REFUSAL.slice(1)],
      refused: true,
    });
    expect(permit.lines.filter((line) => line.toLowerCase().includes(SYNTHETIC_VALUE))).toEqual([]);
  });

  it("hands no waiver to the door on a clean set or a hold", () => {
    expect(privateTermsPermit({ acknowledgement: BLANKET, verdict: CLEAN }).acknowledgement).toBe(undefined);
    expect(privateTermsPermit({ acknowledgement: BLANKET, verdict: HOLD }).acknowledgement).toBe(undefined);
  });
});

describe("landingBaseOf", () => {
  it("names the tip the measurement just fetched", () => {
    expect(landingBaseOf({ measurement: FRESH })).toEqual({ kind: "fetched", sha: "b".repeat(40) });
  });

  it("names no base, saying why, when the measurement was skipped", () => {
    expect(landingBaseOf({ measurement: ok({ kind: "skipped" as const, why: "a fork head" }) })).toEqual({
      detail: "the base was not fetched (a fork head), so no merged change set exists to read",
      kind: "unfetched",
    });
  });

  it("names no base when the measurement failed", () => {
    const failed = err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: ["offline"] }));
    expect(landingBaseOf({ measurement: failed })).toEqual({
      detail: "the base was not measured, so no merged change set exists to read",
      kind: "unfetched",
    });
  });
});
