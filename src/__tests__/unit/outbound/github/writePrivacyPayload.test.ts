/**
 * What the GitHub write transport's privacy guard judges in one request, and the verdict over it. Synthetic rules,
 * terms and organisation throughout: `quillfeather` is the private person term, `zorblatt` the forbidden word.
 */
import { describe, expect, it } from "vitest";

import { type ForbiddenIdentifierRules, identifierDigest } from "../../../../hygiene/identifierScan.js";
import { parsePrivateTerms, WITHHELD_REFUSAL_LINE } from "../../../../hygiene/privateTerms.js";
import { unwrap } from "../../../../lib/result.js";
import {
  githubWriteFindings,
  githubWriteLeaves,
  githubWriteOperation,
  githubWriteTarget,
} from "../../../../outbound/github/writePrivacyPayload.js";
import type { PrivacyDestination, PrivacyPolicy } from "../../../../outbound/privacyCheck.js";
import { writePrivacyRefusal } from "../../../../outbound/writePrivacyLeaves.js";

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

const TERMS = unwrap(
  parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nperson\ti\tquillfeather\tsynthetic\n" }),
);

const POLICY: PrivacyPolicy = { denylist: [], identifierRules: RULES, privateTerms: TERMS };

const STRICT: PrivacyDestination = {
  identifierAudience: "strict",
  installationIdentifiers: undefined,
  ownRepository: undefined,
};

const COMMENT_URL = "/repos/{owner}/{repo}/issues/{issue_number}/comments";

/** A REST comment write as the hook sees it, transport keys included. */
const COMMENT = {
  baseUrl: "https://api.github.com",
  body: "first line\nthanks quillfeather",
  headers: { authorization: "token ghp_not_a_real_token", "user-agent": "acme" },
  issue_number: 7,
  mediaType: { format: "" },
  method: "POST",
  owner: "acme",
  repo: "widgets",
  url: COMMENT_URL,
};

describe("githubWriteLeaves", () => {
  it("judges the content fields and skips every transport and destination key", () => {
    expect(githubWriteLeaves({ payload: COMMENT })).toEqual([
      { locus: `github POST ${COMMENT_URL} body`, text: "first line\nthanks quillfeather" },
    ]);
  });

  it("names each item of a list by its index", () => {
    const payload = { labels: ["bug", "quillfeather"], method: "POST", url: "/repos/{owner}/{repo}/issues/{n}/labels" };
    expect(githubWriteLeaves({ payload }).map((leaf) => leaf.locus)).toEqual([
      "github POST /repos/{owner}/{repo}/issues/{n}/labels labels[0]",
      "github POST /repos/{owner}/{repo}/issues/{n}/labels labels[1]",
    ]);
  });

  it("judges a branch or tag name carried as a path parameter", () => {
    const payload = { method: "DELETE", ref: "heads/quillfeather-notes", url: "/repos/{owner}/{repo}/git/refs/{ref}" };
    expect(githubWriteLeaves({ payload })).toEqual([
      { locus: "github DELETE /repos/{owner}/{repo}/git/refs/{ref} ref", text: "heads/quillfeather-notes" },
    ]);
  });

  it("judges a GraphQL mutation's nested variables and never its document", () => {
    const payload = {
      method: "POST",
      query: "mutation($input: AddCommentInput!) { addComment(input: $input) { clientMutationId } }",
      url: "/graphql",
      variables: { input: { body: "hello", subjectId: "PR_kwFIXTURE" } },
    };
    expect(githubWriteLeaves({ payload })).toEqual([
      { locus: "github POST /graphql variables.input.body", text: "hello" },
      { locus: "github POST /graphql variables.input.subjectId", text: "PR_kwFIXTURE" },
    ]);
  });

  it("walks a cyclic value once rather than forever", () => {
    const loop: Record<string, unknown> = { note: "once" };
    loop["self"] = loop;
    expect(githubWriteLeaves({ payload: { loop, method: "POST", url: "/x" } })).toEqual([
      { locus: "github POST /x loop.note", text: "once" },
    ]);
  });

  it("finds nothing to judge in a payload that is not a record", () => {
    expect(githubWriteLeaves({ payload: "body" })).toEqual([]);
  });
});

describe("githubWriteTarget", () => {
  it("is the request's own owner and repo", () => {
    expect(githubWriteTarget({ payload: COMMENT })).toBe("acme/widgets");
  });

  it("names no repository for a mutation addressed by node id alone", () => {
    expect(githubWriteTarget({ payload: { method: "POST", url: "/graphql", variables: { id: "PR_kwFIXTURE" } } })).toBe(
      undefined,
    );
  });
});

describe("githubWriteFindings", () => {
  it("refuses a private term on its own line, naming the field and the class, never the term", () => {
    const findings = githubWriteFindings({ destination: STRICT, payload: COMMENT, policy: POLICY });
    expect(findings.map((finding) => finding.message)).toEqual([
      `github POST ${COMMENT_URL} body line 2: a private person term (redacted here) — remove or generalise it, ` +
        "or if it is not private ask the chair to narrow that terms row",
    ]);
    expect(findings.map((finding) => finding.message).join("\n")).not.toContain("quillfeather");
  });

  it("passes first person, which is a pull request author's rule and not a privacy one", () => {
    const payload = { body: "I think this works", method: "POST", url: COMMENT_URL };
    expect(githubWriteFindings({ destination: STRICT, payload, policy: POLICY })).toEqual([]);
  });

  it("refuses an installation path in a label", () => {
    const payload = { labels: ["/Users/fixture-person/notes"], method: "POST", url: "/x" };
    expect(
      githubWriteFindings({ destination: STRICT, payload, policy: POLICY }).map((finding) => finding.code),
    ).toEqual(["INSTALLATION_STATE"]);
  });

  it("forgives the target repository's own address and refuses the same word on any other", () => {
    const payload = { body: "see https://github.com/zorblatt/widgets", method: "POST", url: COMMENT_URL };
    const own: PrivacyDestination = {
      identifierAudience: "strict",
      installationIdentifiers: undefined,
      ownRepository: "zorblatt/widgets",
    };
    expect(githubWriteFindings({ destination: own, payload, policy: POLICY })).toEqual([]);
    expect(
      githubWriteFindings({ destination: STRICT, payload, policy: POLICY }).map((finding) => finding.code),
    ).toEqual(["HYGIENE"]);
  });
});

describe("writePrivacyRefusal", () => {
  it("withholds a line whose locus a private term matches, and prints the rest", () => {
    const terms = unwrap(parsePrivateTerms({ text: "class\tflags\tpattern\tsource\ntopic\ti\twidgets\tsynthetic\n" }));
    const refusal = writePrivacyRefusal({
      command: githubWriteOperation({ payload: { method: "POST", url: "/repos/acme/widgets/labels" } }),
      reasons: ["clean reason"],
      terms,
    });
    expect(refusal.split("\n")).toEqual([
      WITHHELD_REFUSAL_LINE,
      "  clean reason",
      "  This is a refusal, with no override: reword the text, or repair the private terms file, then run the command again.",
    ]);
  });

  it("withholds the whole refusal when a term matches only the text as printed, its indent included", () => {
    const terms = unwrap(
      parsePrivateTerms({
        text: "class\tflags\tpattern\tsource\ntopic\t-\t  \tsynthetic\nperson\ti\tquillfeather\tsynthetic\n",
      }),
    );
    const findings = githubWriteFindings({
      destination: STRICT,
      payload: { ...COMMENT, body: "quillfeather" },
      policy: { ...POLICY, privateTerms: terms },
    });
    const refusal = writePrivacyRefusal({
      command: githubWriteOperation({ payload: COMMENT }),
      reasons: findings.map((finding) => finding.message),
      terms,
    });
    expect(findings).toHaveLength(1);
    expect(refusal).toBe(WITHHELD_REFUSAL_LINE);
    expect(terms.some(({ re }) => new RegExp(re.source, re.flags).test(refusal))).toBe(false);
  });

  it("says what was stopped, each reason, and that there is no override", () => {
    expect(
      writePrivacyRefusal({
        command: githubWriteOperation({ payload: COMMENT }),
        reasons: ["one", "two"],
        terms: TERMS,
      }),
    ).toBe(
      [
        `github POST ${COMMENT_URL} refused before sending: the outbound privacy check stopped it.`,
        "  one",
        "  two",
        "  This is a refusal, with no override: reword the text, or repair the private terms file, then run the command again.",
      ].join("\n"),
    );
  });
});
