import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type InstallKnowledgeDomains, noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import { homeFlag, KnowledgeErrors } from "../../../knowledge/errors.js";
import { buildLessonRow, isLessonDomain, lessonId, normaliseClaim, parseLessonLine } from "../../../knowledge/row.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const AT = "2026-09-07T01:00:00.000Z";
const INSTALL_HOME = "/tmp/sw-home";

/** A synthetic install holding one domain of its own and one retired spelling of it. */
const ACME: InstallKnowledgeDomains = {
  aliases: { "acme-e2e": "acme" },
  domains: [{ holds: "the synthetic team monorepo", slug: "acme" }],
  home: INSTALL_HOME,
};

/** The arguments a valid row is built from, so each test varies exactly one thing. */
const valid = {
  caveat: undefined,
  claim: "A grouped count over an id-like facet truncates.",
  domain: "datadog",
  evidence: "5 of 5 buckets plus meta.page.after over 13,431,804 logs in a closed 12h window",
  installDomains: noInstallDomains({ home: INSTALL_HOME }),
  learner: "fleet",
  recordedAtIso: AT,
  repro: undefined,
  run: "some-run",
  surface: "api",
  tier: 2,
  verdict: "confirmed",
} as const;

describe("normaliseClaim", () => {
  it("lowercases, collapses whitespace and drops terminal punctuation", () => {
    expect(normaliseClaim({ claim: "  The  Facet   TRUNCATES!!  " })).toBe("the facet truncates");
  });

  it("leaves punctuation that is not terminal alone, so two different claims stay different", () => {
    expect(normaliseClaim({ claim: "it is 401, not 403." })).toBe("it is 401, not 403");
  });
});

describe("lessonId", () => {
  it("is the same for two recordings of one claim written differently", () => {
    expect(lessonId({ claim: "The facet truncates.", domain: "datadog" })).toBe(
      lessonId({ claim: "the  facet   truncates", domain: "datadog" }),
    );
  });

  it("differs when the domain differs, so one claim about two systems is two lessons", () => {
    expect(lessonId({ claim: "The facet truncates.", domain: "datadog" })).not.toBe(
      lessonId({ claim: "The facet truncates.", domain: "linear" }),
    );
  });

  it("differs when the claim differs", () => {
    expect(lessonId({ claim: "the facet truncates", domain: "datadog" })).not.toBe(
      lessonId({ claim: "the facet does not truncate", domain: "datadog" }),
    );
  });
});

describe("isLessonDomain", () => {
  it("accepts an atlas platform directory's shape", () => {
    expect(isLessonDomain({ domain: "google-admin" })).toBe(true);
  });

  it("rejects a leading hyphen", () => {
    expect(isLessonDomain({ domain: "-datadog" })).toBe(false);
  });

  it("rejects a double hyphen", () => {
    expect(isLessonDomain({ domain: "google--admin" })).toBe(false);
  });

  it("rejects uppercase, so one domain cannot exist under two spellings", () => {
    expect(isLessonDomain({ domain: "Datadog" })).toBe(false);
  });

  it("rejects a single character", () => {
    expect(isLessonDomain({ domain: "d" })).toBe(false);
  });

  it("rejects a path separator, which would otherwise read as a per-domain directory", () => {
    expect(isLessonDomain({ domain: "atlas/datadog" })).toBe(false);
  });
});

describe("buildLessonRow", () => {
  it("builds a row carrying its derived id", () => {
    const row = unwrap(buildLessonRow(valid));
    expect(row.id).toBe(lessonId({ claim: valid.claim, domain: "datadog" }));
    expect(row.domain).toBe("datadog");
    expect(row.tier).toBe(2);
    expect(row.verdict).toBe("confirmed");
    expect(row.run).toBe("some-run");
    expect(row.recordedAtIso).toBe(AT);
  });

  it("omits repro and caveat entirely rather than storing an empty string", () => {
    const row = unwrap(buildLessonRow({ ...valid, caveat: "   ", repro: "" }));
    expect(row.repro).toBeUndefined();
    expect(row.caveat).toBeUndefined();
  });

  it("keeps a trimmed repro", () => {
    const row = unwrap(buildLessonRow({ ...valid, repro: "  slopweaver knowledge list  " }));
    expect(row.repro).toBe("slopweaver knowledge list");
  });

  it("refuses a domain that is not a slug, naming the code a caller branches on", () => {
    const error = unwrapErr(buildLessonRow({ ...valid, domain: "Datadog Logs" }));
    expect(error.code).toBe("INVALID_DOMAIN");
  });

  it("refuses an empty claim", () => {
    const error = unwrapErr(buildLessonRow({ ...valid, claim: "   " }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("claim");
  });

  it("refuses a claim over the length cap, because a lesson that long is two lessons", () => {
    const error = unwrapErr(buildLessonRow({ ...valid, claim: "x".repeat(401) }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("401");
  });

  it("refuses an empty evidence, so a claim can never be recorded with nothing behind it", () => {
    const error = unwrapErr(buildLessonRow({ ...valid, evidence: "" }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("evidence");
  });

  it("carries the learner it was given", () => {
    expect(unwrap(buildLessonRow({ ...valid, learner: "owner" })).learner).toBe("owner");
    expect(unwrap(buildLessonRow({ ...valid, learner: "fleet" })).learner).toBe("fleet");
  });

  it("gives the owner's row and the fleet's the SAME id for one claim, so the two are one series", () => {
    const ownerRow = unwrap(buildLessonRow({ ...valid, learner: "owner" }));
    const theirs = unwrap(buildLessonRow({ ...valid, learner: "fleet" }));
    expect(ownerRow.id).toBe(theirs.id);
  });

  it("refuses a retired spelling of a domain, naming the one it folded into", () => {
    const error = unwrapErr(buildLessonRow({ ...valid, domain: "github-actions" }));
    expect([error.code, error.message]).toEqual([
      "DOMAIN_RETIRED",
      'domain "github-actions" folded into "ci" — record it under --domain ci',
    ]);
  });

  it("refuses a slug no vocabulary holds, naming the verb that adds one to the store", () => {
    const error = unwrapErr(buildLessonRow({ ...valid, domain: "acme" }));
    expect([error.code, error.message]).toEqual([
      "DOMAIN_NOT_CONFIGURED",
      'domain "acme" is not configured — `slopweaver knowledge domains` lists every domain and what it holds; ' +
        "one of this install's own is added to its store with " +
        '`slopweaver knowledge domains add --slug acme --holds "<what it holds>" --home /tmp/sw-home`',
    ]);
  });

  it("quotes a home with a space in the add instruction, so the printed command runs against that home", () => {
    const error = KnowledgeErrors.domainNotConfigured({ domain: "acme", home: "/tmp/sw home" });
    expect(error.message).toContain(`--holds "<what it holds>" --home '/tmp/sw home'\``);
  });

  it("prints a relative home starting with -- as an absolute one, which the flag parser accepts as a value", () => {
    expect(homeFlag({ home: "--tenant-home" })).toBe(`--home ${join(process.cwd(), "--tenant-home")}`);
  });

  it("accepts an install's own domain, and refuses its retired spelling with the domain it folded into", () => {
    expect(unwrap(buildLessonRow({ ...valid, domain: "acme", installDomains: ACME })).domain).toBe("acme");
    const error = unwrapErr(buildLessonRow({ ...valid, domain: "acme-e2e", installDomains: ACME }));
    expect([error.code, error.message]).toEqual([
      "DOMAIN_RETIRED",
      'domain "acme-e2e" folded into "acme" — record it under --domain acme',
    ]);
  });

  it("carries the claim it retires, and omits the field when it retires none", () => {
    expect(unwrap(buildLessonRow({ ...valid, supersedes: "l-0123456789abcdef" })).supersedes).toBe(
      "l-0123456789abcdef",
    );
    expect(unwrap(buildLessonRow(valid)).supersedes).toBeUndefined();
  });
});

describe("parseLessonLine", () => {
  it("round-trips a row this module built", () => {
    const row = unwrap(buildLessonRow({ ...valid, caveat: "only the OPEN state was tested", repro: "curl x" }));
    const back = unwrap(parseLessonLine({ line: JSON.stringify(row), lineNumber: 1 }));
    expect(back).toEqual(row);
  });

  it("refuses a line that is not JSON, naming the line number", () => {
    const error = unwrapErr(parseLessonLine({ line: "{not json", lineNumber: 7 }));
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("line 7");
  });

  it("refuses a verdict outside the closed vocabulary, so a hand edit cannot widen it", () => {
    const row = unwrap(buildLessonRow(valid));
    const line = JSON.stringify({ ...row, verdict: "probably" });
    expect(unwrapErr(parseLessonLine({ line, lineNumber: 2 })).code).toBe("CORRUPT_ROW");
  });

  it("refuses a tier outside the closed vocabulary", () => {
    const row = unwrap(buildLessonRow(valid));
    const line = JSON.stringify({ ...row, tier: 5 });
    expect(unwrapErr(parseLessonLine({ line, lineNumber: 3 })).code).toBe("CORRUPT_ROW");
  });

  it("refuses a tier that is the right number as a string, so a projection's column type is safe", () => {
    const row = unwrap(buildLessonRow(valid));
    const line = JSON.stringify({ ...row, tier: "2" });
    expect(unwrapErr(parseLessonLine({ line, lineNumber: 4 })).code).toBe("CORRUPT_ROW");
  });

  it("refuses a row missing evidence", () => {
    const row = unwrap(buildLessonRow(valid));
    const { evidence: _dropped, ...rest } = row;
    expect(unwrapErr(parseLessonLine({ line: JSON.stringify(rest), lineNumber: 5 })).code).toBe("CORRUPT_ROW");
  });

  it("reads a row written before the learner field existed as the fleet's", () => {
    const row = unwrap(buildLessonRow(valid));
    const { learner: _absent, ...legacy } = row;
    const back = unwrap(parseLessonLine({ line: JSON.stringify(legacy), lineNumber: 6 }));
    expect(back.learner).toBe("fleet");
  });

  it("round-trips the owner's own row rather than defaulting it back to the fleet", () => {
    const row = unwrap(buildLessonRow({ ...valid, learner: "owner" }));
    expect(unwrap(parseLessonLine({ line: JSON.stringify(row), lineNumber: 7 })).learner).toBe("owner");
  });

  it("refuses a learner outside the vocabulary rather than quietly reading it as the fleet's", () => {
    const row = unwrap(buildLessonRow(valid));
    const line = JSON.stringify({ ...row, learner: "ada" });
    expect(unwrapErr(parseLessonLine({ line, lineNumber: 8 })).code).toBe("CORRUPT_ROW");
  });

  it("refuses an explicitly null learner, which is a hand edit rather than an absent field", () => {
    const row = unwrap(buildLessonRow(valid));
    const line = JSON.stringify({ ...row, learner: null });
    expect(unwrapErr(parseLessonLine({ line, lineNumber: 9 })).code).toBe("CORRUPT_ROW");
  });
});
