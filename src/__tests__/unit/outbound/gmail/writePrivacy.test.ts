/**
 * The Gmail guard's two refusals over one judged request, with the policy injected through a COUNTING capability (a
 * plain seam, not a mock) so a load is seen per write: a clean write, a private term, a forbidden identifier that the
 * installation's own workspace would forgive but mail never does, a policy that changes between two writes, and the
 * dead Datadog host refused BEFORE a policy that cannot load. Synthetic terms throughout: `quillfeather` is the private
 * person term, `zorblatt` the forbidden word.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type ForbiddenIdentifierRules, identifierDigest } from "../../../../hygiene/identifierScan.js";
import { PRIVATE_TERMS_HEADER_V2, parsePrivateTerms } from "../../../../hygiene/privateTerms.js";
import { err, ok, type Result, unwrap } from "../../../../lib/result.js";
import {
  type GmailWritePrivacy,
  GmailWriteRefusedError,
  refuseGmailWrite,
} from "../../../../outbound/gmail/writePrivacy.js";
import { GmailWritePayloadErrors } from "../../../../outbound/gmail/writePrivacyErrors.js";
import {
  GMAIL_STRICT_DESTINATION,
  type GmailWriteRequest,
  gmailWriteFindings,
} from "../../../../outbound/gmail/writePrivacyPayload.js";
import { InvalidDatadogHostRefusedError } from "../../../../outbound/invalidDatadogHost.js";
import type { PrivacyPolicy } from "../../../../outbound/privacyCheck.js";
import { privateTermReviewPort } from "../../../../outbound/privateTermReview/gate.js";

/** The word `zorblatt` is forbidden. */
const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [],
    exactIds: [],
    exemptTicketReferences: [],
    spanHeads: [],
    substringCi: [],
    substringCs: [],
    teamKeys: [],
    wordCi: [identifierDigest({ text: "zorblatt" })],
    wordCs: [],
  },
  providerLocations: [],
};

/** A policy whose private terms are exactly `rows`. */
function policyWith({ rows }: { rows: readonly string[] }): PrivacyPolicy {
  const text = ["class\tflags\tpattern\tsource", ...rows, ""].join("\n");
  return { denylist: [], identifierRules: RULES, privateTerms: unwrap(parsePrivateTerms({ text })) };
}

const PERSON = ["person\ti\tquillfeather\tsynthetic"];

/** A capability answering each load from `answers` in turn, counting how many loads were asked for. */
function countingPrivacy({ answers }: { answers: readonly Result<PrivacyPolicy, string>[] }): {
  privacy: GmailWritePrivacy;
  loads: () => number;
} {
  let loads = 0;
  return {
    loads: () => loads,
    privacy: {
      resolve: () => {
        const answer = answers[Math.min(loads, answers.length - 1)]!;
        loads += 1;
        return Promise.resolve(answer);
      },
    },
  };
}

/** One judged write whose only leaf is `text`. */
function requestWith({ text }: { text: string }): GmailWriteRequest {
  return {
    command: "gmail drafts.create",
    leaves: ok([{ locus: "gmail drafts.create message.raw text", text }]),
    payload: { decoded: [text] },
  };
}

/** The refusal a write threw, or undefined when it may be sent. */
async function refusalOf({
  privacy,
  request,
}: {
  privacy: GmailWritePrivacy;
  request: GmailWriteRequest;
}): Promise<unknown> {
  try {
    await refuseGmailWrite({ privacy, request });
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

/** The message of the Gmail refusal a write threw; throws when it threw anything else or nothing. */
async function refusalMessage({
  privacy,
  request,
}: {
  privacy: GmailWritePrivacy;
  request: GmailWriteRequest;
}): Promise<string> {
  const refusal = await refusalOf({ privacy, request });
  if (!(refusal instanceof GmailWriteRefusedError)) {
    throw new Error("expected the write to be refused by the Gmail privacy guard");
  }
  return refusal.message;
}

describe("refuseGmailWrite", () => {
  it("lets a clean write through, loading the policy once", async () => {
    const { privacy, loads } = countingPrivacy({ answers: [ok(policyWith({ rows: PERSON }))] });
    expect(await refusalOf({ privacy, request: requestWith({ text: "the build is green" }) })).toBe(undefined);
    expect(loads()).toBe(1);
  });

  it("refuses a private term with its locus and class, never echoing it", async () => {
    const { privacy } = countingPrivacy({ answers: [ok(policyWith({ rows: PERSON }))] });
    const message = await refusalMessage({ privacy, request: requestWith({ text: "ask quillfeather" }) });
    expect(message).toContain("gmail drafts.create refused before sending: the outbound privacy check stopped it.");
    expect(message).toContain("gmail drafts.create message.raw text line 1: a private person term (redacted here)");
    expect(message).not.toMatch(/quillfeather/iu);
  });

  it("refuses a forbidden identifier, which mail never forgives", async () => {
    const { privacy } = countingPrivacy({ answers: [ok(policyWith({ rows: [] }))] });
    const message = await refusalMessage({ privacy, request: requestWith({ text: "the zorblatt rollout" }) });
    expect(message).toContain("identifier (redacted here)");
    expect(GMAIL_STRICT_DESTINATION.identifierAudience).toBe("strict");
  });

  it("loads the policy afresh on every write, so a term added between two writes refuses the second", async () => {
    const { privacy, loads } = countingPrivacy({
      answers: [ok(policyWith({ rows: [] })), ok(policyWith({ rows: PERSON }))],
    });
    const request = requestWith({ text: "ask quillfeather" });
    expect(await refusalOf({ privacy, request })).toBe(undefined);
    expect(await refusalOf({ privacy, request })).toBeInstanceOf(GmailWriteRefusedError);
    expect(loads()).toBe(2);
  });

  it("refuses when the policy cannot load, naming the load's sentence", async () => {
    const { privacy } = countingPrivacy({ answers: [err("the private-terms file does not exist")] });
    const message = await refusalMessage({ privacy, request: requestWith({ text: "clean" }) });
    expect(message).toContain("the private-terms file does not exist");
  });

  it("refuses a request that could not be judged, after loading the policy", async () => {
    const { privacy, loads } = countingPrivacy({ answers: [ok(policyWith({ rows: [] }))] });
    const leaves = err(GmailWritePayloadErrors.writeUnreadable({ command: "gmail drafts.send", reason: "no raw" }));
    const request: GmailWriteRequest = { command: "gmail drafts.send", leaves, payload: {} };
    expect(await refusalMessage({ privacy, request })).toContain("  gmail drafts.send: no raw");
    expect(loads()).toBe(1);
  });

  it("holds the same message under another hold when the credential is bound to another mailbox", async () => {
    const home = mkdtempSync(join(tmpdir(), "gmail-principal-"));
    try {
      const text = `${PRIVATE_TERMS_HEADER_V2}\npt-00000000000a\tperson\ti\tquillfeather\ta synthetic colleague\t\trelay:acme-row\n`;
      const policy: PrivacyPolicy = {
        denylist: [],
        identifierRules: RULES,
        privateTerms: unwrap(parsePrivateTerms({ text })),
      };
      const heldAs = ({ principal }: { principal: string }) =>
        refusalMessage({
          privacy: { principal, resolve: () => Promise.resolve(ok(policy)), review: privateTermReviewPort({ home }) },
          request: requestWith({ text: "ask quillfeather" }),
        });
      const first = await heldAs({ principal: "a@acme.test" });
      const again = await heldAs({ principal: "a@acme.test" });
      const other = await heldAs({ principal: "b@acme.test" });
      expect(first).toContain("held");
      expect(again).toBe(first);
      expect(other).not.toBe(first);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("refuses a dead Datadog host FIRST, before a policy that cannot load is even asked for", async () => {
    const { privacy, loads } = countingPrivacy({ answers: [err("the private-terms file does not exist")] });
    const refusal = await refusalOf({
      privacy,
      request: requestWith({ text: "see https://app.ap1.datadoghq.com/monitors/1000001" }),
    });
    expect(refusal).toBeInstanceOf(InvalidDatadogHostRefusedError);
    expect(loads()).toBe(0);
  });
});

describe("gmailWriteFindings", () => {
  it("is empty for clean leaves and names each finding's locus", () => {
    const policy = policyWith({ rows: PERSON });
    expect(gmailWriteFindings({ leaves: [{ locus: "l", text: "clean" }], policy })).toEqual([]);
    expect(
      gmailWriteFindings({ leaves: [{ locus: "gmail x subject", text: "Quillfeather" }], policy }).map(
        (finding) => finding.message,
      ),
    ).toEqual([
      "gmail x subject line 1: a private person term (redacted here) — remove or generalise it, or if it is not " +
        "private ask the chair to narrow that terms row",
    ]);
  });
});
