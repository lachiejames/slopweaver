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
} from "../../../../../cli/commands/github/privateTermsPermit.js";
import type { ChangeSetPrivateTermsVerdict } from "../../../../../hygiene/changeSetPrivateTerms.js";
import { err, ok } from "../../../../../lib/result.js";

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
const FRESH = ok({
  baseBranch: "main",
  baseSha: "b".repeat(40),
  headSha: "c".repeat(40),
  kind: "fresh" as const,
  remote: "origin",
  reverted: [],
});

describe("privateTermsPermit", () => {
  it("proceeds on a clean change set", () => {
    expect(privateTermsPermit({ acknowledgement: NONE, verdict: CLEAN }).refused).toBe(false);
  });

  it("refuses a hold under every acknowledgement", () => {
    expect(privateTermsPermit({ acknowledgement: BLANKET, verdict: HOLD }).refused).toBe(true);
    expect(privateTermsPermit({ acknowledgement: NAMED, verdict: HOLD }).refused).toBe(true);
  });

  it("refuses an unacknowledged unchecked set with the four-line refusal carrying its detail", () => {
    const permit = privateTermsPermit({ acknowledgement: NONE, verdict: UNCHECKED });
    expect(permit.refused).toBe(true);
    expect(permit.lines[0]).toBe("private terms: NOT CHECKED — no terms file here");
    expect(permit.lines[1]).toContain("slopweaver github merge --admin blocked because");
    expect(permit.lines[1]).toContain("(no terms file here).");
    expect(permit.lines).toHaveLength(5);
  });

  it("refuses an unchecked set named with no reason, or a blank one, since the waiver is recorded", () => {
    expect(privateTermsPermit({ acknowledgement: NAMED, verdict: UNCHECKED }).refused).toBe(true);
    expect(privateTermsPermit({ acknowledgement: { ...NAMED, reason: "  " }, verdict: UNCHECKED }).refused).toBe(true);
  });

  it("proceeds on an unchecked set named with a reason, handing the waiver to the door", () => {
    const permit = privateTermsPermit({ acknowledgement: { ...NAMED, reason: " a fork " }, verdict: UNCHECKED });
    expect(permit.refused).toBe(false);
    expect(permit.acknowledgement).toEqual({ reason: "a fork", subject: "private-terms-unchecked" });
    expect(permit.lines.at(-1)).toBe("ACKNOWLEDGED: private-terms-unchecked by name — reason: a fork");
  });

  it("proceeds on an unchecked set under --acknowledge-all, carrying the reason", () => {
    const permit = privateTermsPermit({ acknowledgement: BLANKET, verdict: UNCHECKED });
    expect(permit.refused).toBe(false);
    expect(permit.acknowledgement).toEqual({ reason: "a fork with no terms", subject: "private-terms-unchecked" });
    expect(permit.lines.at(-1)).toBe(
      "ACKNOWLEDGED: private-terms-unchecked with --acknowledge-all — reason: a fork with no terms",
    );
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
