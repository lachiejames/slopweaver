/**
 * The pure half of a fresh cut: the shapes git answers in, the record's schema, and the scan of every file — which
 * applies every private-term class, `owner-address` included, to file text AND to the list of paths, and never
 * carries the matched text into a finding.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { emptyAcceptedOnAnchor } from "../../../freshCut/anchoredAcceptance.js";
import {
  FRESH_CUT_MESSAGE,
  firstGitlinkPath,
  freshCutRecordSchema,
  isDocumentationAddress,
  isHexObjectId,
  PATH_LIST_LOCUS,
  parseCommitDate,
  parseTreeListing,
  scanCutFiles,
  verificationLines,
} from "../../../freshCut/core.js";
import { identifierDigest } from "../../../hygiene/identifierScan.js";
import {
  CODE_OWNERS_PATH,
  OWNER_REFERENCE_DIGEST,
  OWNER_REFERENCE_PATH,
  SOURCE_REPOSITORY,
} from "../../../hygiene/ownRepository.js";
import { type PrivateTerm, parsePrivateTerms } from "../../../hygiene/privateTerms.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const BLOB_A = "a".repeat(40);
const BLOB_B = "b".repeat(40);

/** Synthetic private terms: one owner address and one person, both invented. */
const TERMS = unwrap(
  parsePrivateTerms({
    text:
      "class\tflags\tpattern\tsource\n" +
      "owner-address\ti\tzorblatt@example\\.invalid\tsynthetic\n" +
      "person\ti\tquillfeather\tsynthetic\n",
  }),
);

/** A synthetic denylisted secret string. */
const DENIED = "zz-denied-fixture-zz";

describe("isHexObjectId", () => {
  it("accepts an abbreviated and a full hexadecimal id", () => {
    expect([isHexObjectId({ given: "7adba73" }), isHexObjectId({ given: BLOB_A })]).toEqual([true, true]);
  });

  it("refuses a ref name, a too-short id and uppercase hex", () => {
    expect([
      isHexObjectId({ given: "main" }),
      isHexObjectId({ given: "abc123" }),
      isHexObjectId({ given: "ABCDEF0" }),
      isHexObjectId({ given: "HEAD~1" }),
    ]).toEqual([false, false, false, false]);
  });
});

describe("parseTreeListing", () => {
  it("parses NUL-terminated records, keeping a path with a space and a newline intact", () => {
    const output = Buffer.from(`100644 blob ${BLOB_A}\tdocs/a b.md\u0000100755 blob ${BLOB_B}\tbin/odd\nname\u0000`);
    expect(unwrap(parseTreeListing({ output }))).toEqual([
      { mode: "100644", path: "docs/a b.md", sha: BLOB_A, type: "blob" },
      { mode: "100755", path: "bin/odd\nname", sha: BLOB_B, type: "blob" },
    ]);
  });

  it("returns no entries for empty output", () => {
    expect(unwrap(parseTreeListing({ output: Buffer.alloc(0) }))).toEqual([]);
  });

  it("refuses a record that is not an ls-tree line", () => {
    expect(unwrapErr(parseTreeListing({ output: Buffer.from("not a record\u0000") }))).toContain(
      "unparseable ls-tree record",
    );
  });
});

describe("firstGitlinkPath", () => {
  it("names the first submodule entry", () => {
    const entries = [
      { mode: "100644", path: "a.txt", sha: BLOB_A, type: "blob" },
      { mode: "160000", path: "vendor/lib", sha: BLOB_B, type: "commit" },
    ];
    expect(firstGitlinkPath({ entries })).toBe("vendor/lib");
  });

  it("is undefined for a tree of blobs only", () => {
    expect(firstGitlinkPath({ entries: [{ mode: "100644", path: "a.txt", sha: BLOB_A, type: "blob" }] })).toBe(
      undefined,
    );
  });
});

describe("parseCommitDate", () => {
  it("takes git's internal date form, trailing newline trimmed", () => {
    expect(unwrap(parseCommitDate({ text: "1763600000 +1100\n" }))).toBe("1763600000 +1100");
  });

  it("refuses an ISO date", () => {
    expect(unwrapErr(parseCommitDate({ text: "2026-11-20T00:00:00Z" }))).toContain("unparseable committer date");
  });
});

describe("freshCutRecordSchema", () => {
  const record = {
    destination: "/private/tmp/cut",
    login: "acme-dev",
    producedAtIso: "2026-11-20T01:02:03.000Z",
    recordId: "0b7e7f8e-1f4a-4c2b-9d3e-5a6b7c8d9e0f",
    rootSha: BLOB_A,
    schemaVersion: 1,
    source: "/private/tmp/source",
    sourceCommitterDate: "1763600000 +1100",
    sourceSha: BLOB_B,
    treeSha: "c".repeat(64),
  };

  it("accepts a well-formed record, a SHA-256 tree included", () => {
    expect(freshCutRecordSchema.safeParse(record).success).toBe(true);
  });

  it("refuses an extra field, so an address can never be smuggled into the record", () => {
    expect(freshCutRecordSchema.safeParse({ ...record, address: "x@example.invalid" }).success).toBe(false);
  });

  it("refuses a relative destination and an abbreviated root SHA", () => {
    expect([
      freshCutRecordSchema.safeParse({ ...record, destination: "cut" }).success,
      freshCutRecordSchema.safeParse({ ...record, rootSha: "abc1234" }).success,
    ]).toEqual([false, false]);
  });
});

describe("FRESH_CUT_MESSAGE", () => {
  it("is the fixed, owner-agnostic message", () => {
    expect(FRESH_CUT_MESSAGE).toBe("Initial commit");
  });
});

describe("scanCutFiles", () => {
  it("finds an owner-address term with no outbound exemption, and a person term, by line and class only", () => {
    const files = [
      { bytes: Buffer.from("line one\ncontact Zorblatt@example.invalid\n"), path: "README.md" },
      { bytes: Buffer.from("nothing\nnothing\nQuillfeather was here\n"), path: "src/a.ts" },
    ];
    expect(scanCutFiles({ denylist: [], files, privateTerms: TERMS }).findings).toEqual([
      { className: "owner-address", kind: "private-term", line: 2, path: "README.md" },
      { className: "person", kind: "private-term", line: 3, path: "src/a.ts" },
    ]);
  });

  it("finds a private term in a file's PATH, reported under the path-list locus", () => {
    const files = [
      { bytes: Buffer.from("clean\n"), path: "a.txt" },
      { bytes: Buffer.from("clean\n"), path: "notes/quillfeather.md" },
    ];
    expect(scanCutFiles({ denylist: [], files, privateTerms: TERMS }).findings).toEqual([
      { className: "person", kind: "private-term", line: 2, path: PATH_LIST_LOCUS },
    ]);
  });

  it("never writes a matching path out, even when that file's content matches too", () => {
    const files = [
      { bytes: Buffer.from("clean\n"), path: "a.txt" },
      { bytes: Buffer.from("by quillfeather\n"), path: "notes/quillfeather.md" },
    ];
    const { findings } = scanCutFiles({ denylist: [], files, privateTerms: TERMS });

    expect(findings).toEqual([
      { className: "person", kind: "private-term", line: 2, path: PATH_LIST_LOCUS },
      { className: "person", kind: "private-term", line: 1, path: `${PATH_LIST_LOCUS} line 2` },
    ]);
    expect(JSON.stringify(findings).includes("quillfeather")).toBe(false);
  });

  it("withholds a matching path that holds a newline, naming the first path-list line it starts on", () => {
    const files = [
      { bytes: Buffer.from("clean\n"), path: "a\nb.txt" },
      { bytes: Buffer.from("quillfeather\n"), path: "safe\nquillfeather" },
    ];
    const { findings } = scanCutFiles({ denylist: [], files, privateTerms: TERMS });

    expect(findings).toEqual([
      { className: "person", kind: "private-term", line: 4, path: PATH_LIST_LOCUS },
      { className: "person", kind: "private-term", line: 1, path: `${PATH_LIST_LOCUS} line 3` },
    ]);
    expect(JSON.stringify(findings).includes("quillfeather")).toBe(false);
  });

  it("finds a denylisted secret as a hygiene finding, and reads a binary file's bytes with NUL as a line break", () => {
    const files = [{ bytes: Buffer.from(`\u0089PNG\u0000\u0000${DENIED}\u0000`), path: "img/logo.png" }];
    expect(scanCutFiles({ denylist: [DENIED], files, privateTerms: [] }).findings).toEqual([
      { kind: "hygiene", label: "denylist", line: 3, path: "img/logo.png" },
    ]);
  });

  it("never carries the matched text into a finding", () => {
    const files = [{ bytes: Buffer.from(`zorblatt@example.invalid ${DENIED}\n`), path: "a.txt" }];
    const serialised = JSON.stringify(scanCutFiles({ denylist: [DENIED], files, privateTerms: TERMS }).findings);
    expect([serialised.includes("owner-address"), serialised.includes("denylist")]).toEqual([true, true]);
    expect([serialised.includes("zorblatt"), serialised.includes(DENIED)]).toEqual([false, false]);
  });

  it("finds nothing in a clean cut", () => {
    const files = [{ bytes: Buffer.from("export const acme = 1;\n"), path: "src/acme.ts" }];
    expect(scanCutFiles({ denylist: [DENIED], files, privateTerms: TERMS }).findings).toEqual([]);
  });

  it("counts no exemption on a cut that holds none", () => {
    const files = [{ bytes: Buffer.from("Quillfeather\n"), path: "a.txt" }];
    expect(scanCutFiles({ denylist: [], files, privateTerms: TERMS }).exemptions).toEqual(NO_EXEMPTIONS);
  });
});

const NO_EXEMPTIONS = { "code-owner": 0, "documentation-address": 0, "own-address": 0, "owner-reference": 0 };

/** The source repository's owner, read off the committed constant so this file never spells it. */
const SOURCE_OWNER = SOURCE_REPOSITORY.slice(0, SOURCE_REPOSITORY.indexOf("/"));

/** A case-insensitive owner-handle row over that owner, as an installation's terms file would carry one. */
const OWNER_TERMS = unwrap(
  parsePrivateTerms({ text: `class\tflags\tpattern\tsource\nowner-handle\ti\t${SOURCE_OWNER}\tsynthetic\n` }),
);

const scanOne = ({ text, path = "a.md", terms }: { text: string; path?: string; terms: readonly PrivateTerm[] }) =>
  scanCutFiles({ denylist: [], files: [{ bytes: Buffer.from(text), path }], privateTerms: terms });

describe("scanCutFiles — the own-address exemption", () => {
  it("exempts the owner inside each exact-case own address, a route, an SSH remote and a list included", () => {
    const text = [
      `see https://github.com/${SOURCE_REPOSITORY}/pull/1 and git@github.com:${SOURCE_REPOSITORY}.git`,
      `a/b,${SOURCE_REPOSITORY} and /pull-requests/${SOURCE_REPOSITORY}/2.`,
    ].join("\n");
    expect(scanOne({ terms: OWNER_TERMS, text })).toEqual({
      exemptions: { ...NO_EXEMPTIONS, "own-address": 4 },
      findings: [],
    });
  });

  it("still refuses the bare owner anywhere else, the same line as an own address included", () => {
    const text = `by ${SOURCE_OWNER}\n${SOURCE_REPOSITORY} by ${SOURCE_OWNER}\n`;
    expect(scanOne({ terms: OWNER_TERMS, text })).toEqual({
      exemptions: { ...NO_EXEMPTIONS, "own-address": 1 },
      findings: [
        { className: "owner-handle", kind: "private-term", line: 1, path: "a.md" },
        { className: "owner-handle", kind: "private-term", line: 2, path: "a.md" },
      ],
    });
  });

  it("exempts nothing in the path list, where the hygiene gate forgives nothing either", () => {
    const files = [{ bytes: Buffer.from("clean\n"), path: SOURCE_REPOSITORY }];
    expect(scanCutFiles({ denylist: [], files, privateTerms: OWNER_TERMS })).toEqual({
      exemptions: NO_EXEMPTIONS,
      findings: [{ className: "owner-handle", kind: "private-term", line: 1, path: PATH_LIST_LOCUS }],
    });
  });

  it("refuses a longer repository name and another owner's path ending in the address", () => {
    const text = [`${SOURCE_REPOSITORY}-extra`, `x${SOURCE_REPOSITORY}`, `${SOURCE_REPOSITORY}.v2`].join("\n");
    const { exemptions, findings } = scanOne({ terms: OWNER_TERMS, text });
    expect([exemptions, findings.map((finding) => finding.line)]).toEqual([NO_EXEMPTIONS, [1, 2, 3]]);
  });

  it("exempts a recased address for a row that matches the canonical spelling, never for one matching the recasing alone", () => {
    const recasedOnly = unwrap(
      parsePrivateTerms({
        text: `class\tflags\tpattern\tsource\nowner-handle\t-\t${SOURCE_OWNER.toUpperCase()}\tsynthetic\n`,
      }),
    );
    const text = `${SOURCE_REPOSITORY.toUpperCase()}\n`;
    expect([scanOne({ terms: OWNER_TERMS, text }), scanOne({ terms: recasedOnly, text })]).toEqual([
      { exemptions: { ...NO_EXEMPTIONS, "own-address": 1 }, findings: [] },
      {
        exemptions: NO_EXEMPTIONS,
        findings: [{ className: "owner-handle", kind: "private-term", line: 1, path: "a.md" }],
      },
    ]);
  });
});

describe("scanCutFiles — the code-owner exemption", () => {
  const text = `# owners @${SOURCE_OWNER}\n* @${SOURCE_OWNER}\n/docs @${SOURCE_OWNER}-bot\n`;

  it("exempts the owner's account field on a rule row of the code-owner file and nothing else in it", () => {
    const { exemptions, findings } = scanOne({ path: CODE_OWNERS_PATH, terms: OWNER_TERMS, text });
    expect([exemptions, findings.map((finding) => finding.line)]).toEqual([
      { ...NO_EXEMPTIONS, "code-owner": 1 },
      [1, 3],
    ]);
  });

  it("exempts nothing in a code-owner file at any other path", () => {
    const { exemptions, findings } = scanOne({ path: "docs/CODEOWNERS", terms: OWNER_TERMS, text });
    expect([exemptions, findings.map((finding) => finding.line)]).toEqual([NO_EXEMPTIONS, [1, 2, 3]]);
  });
});

// The owner reference is read out of the committed README by its digest, so this file never spells it.
const README = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", OWNER_REFERENCE_PATH),
  "utf8",
);
const REFERENCE = [...README.matchAll(/\[[^\]\n]+\]\([^)\s]+\)/g)]
  .map((match) => match[0])
  .find((text) => identifierDigest({ text }) === OWNER_REFERENCE_DIGEST)!;

/** A row matching the whole reference text, so only a span covering all of it can exempt the match. */
const REFERENCE_TERMS = unwrap(
  parsePrivateTerms({
    text: `class\tflags\tpattern\tsource\nowner-name\t-\t${REFERENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\tsynthetic\n`,
  }),
);

describe("scanCutFiles — the owner-reference exemption", () => {
  it("exempts the one rendered owner link in the README", () => {
    expect(scanOne({ path: OWNER_REFERENCE_PATH, terms: REFERENCE_TERMS, text: `intro\n${REFERENCE}\n` })).toEqual({
      exemptions: { ...NO_EXEMPTIONS, "owner-reference": 1 },
      findings: [],
    });
  });

  it("refuses a second copy in the README, the same link in any other file, and one inside code", () => {
    const twice = scanOne({ path: OWNER_REFERENCE_PATH, terms: REFERENCE_TERMS, text: `${REFERENCE}\n${REFERENCE}\n` });
    const elsewhere = scanOne({ path: "docs/README.md", terms: REFERENCE_TERMS, text: `${REFERENCE}\n` });
    const inCode = scanOne({ path: OWNER_REFERENCE_PATH, terms: REFERENCE_TERMS, text: `\`${REFERENCE}\`\n` });
    expect([twice.findings.length, elsewhere.findings.length, inCode.findings.length]).toEqual([1, 1, 1]);
    expect([twice.exemptions, elsewhere.exemptions, inCode.exemptions]).toEqual([
      { ...NO_EXEMPTIONS, "owner-reference": 1 },
      NO_EXEMPTIONS,
      NO_EXEMPTIONS,
    ]);
  });
});

/** A synthetic public-IPv4 row, the shape an installation's terms file guards addresses with. */
const ADDRESS_TERMS = unwrap(
  parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nplace\t-\t\\d{1,3}(?:\\.\\d{1,3}){3}\tsynthetic\n" }),
);

describe("scanCutFiles — the documentation-address exemption", () => {
  it("exempts each TEST-NET address and the placeholder, a sentence-ending dot included", () => {
    const text = "192.0.2.10\nhost 198.51.100.7:8080\n(203.0.113.255).\nuse 1.2.3.4.\n";
    expect(scanOne({ terms: ADDRESS_TERMS, text })).toEqual({
      exemptions: { ...NO_EXEMPTIONS, "documentation-address": 4 },
      findings: [],
    });
  });

  it("refuses a real address, one just outside a block, a bad octet and a placeholder that is part of a longer one", () => {
    const text = "8.8.8.8\n192.0.3.1\n192.0.2.256\n1.2.3.45\n198.51.100.07\n";
    const { exemptions, findings } = scanOne({ terms: ADDRESS_TERMS, text });
    expect([exemptions, findings.map((finding) => finding.line)]).toEqual([NO_EXEMPTIONS, [1, 2, 3, 4, 5]]);
  });

  it("judges the whole dotted run, so a row cut short by its own boundary cannot pass a real address", () => {
    const narrow = unwrap(
      parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nplace\t-\t1\\.2\\.3\\.4\tsynthetic\n" }),
    );
    const { exemptions, findings } = scanOne({ terms: narrow, text: "11.2.3.45\n1.2.3.4\n" });
    expect([exemptions, findings]).toEqual([
      { ...NO_EXEMPTIONS, "documentation-address": 1 },
      [{ className: "place", kind: "private-term", line: 1, path: "a.md" }],
    ]);
  });

  it("still hits a line holding a documentation address beside a real one of the same class", () => {
    expect(scanOne({ terms: ADDRESS_TERMS, text: "192.0.2.1 then 8.8.4.4\n" })).toEqual({
      exemptions: { ...NO_EXEMPTIONS, "documentation-address": 1 },
      findings: [{ className: "place", kind: "private-term", line: 1, path: "a.md" }],
    });
  });
});

describe("isDocumentationAddress", () => {
  it("accepts each TEST-NET block's edges and the placeholder", () => {
    expect(
      ["192.0.2.0", "192.0.2.255", "198.51.100.0", "203.0.113.255", "1.2.3.4"].map((address) =>
        isDocumentationAddress({ address }),
      ),
    ).toEqual([true, true, true, true, true]);
  });

  it("refuses a neighbouring block, five octets, a leading zero and an empty octet", () => {
    expect(
      ["192.0.1.1", "203.0.114.1", "192.0.2.1.5", "192.0.2.01", "192.0..2"].map((address) =>
        isDocumentationAddress({ address }),
      ),
    ).toEqual([false, false, false, false, false]);
  });
});

describe("verificationLines", () => {
  it("prints counts and the report path, never a finding's path", () => {
    const lines = verificationLines({
      reportPath: "/home/fresh-cuts/r/verify-1.json",
      reviewedUnmatched: 5,
      verification: {
        destinationTreeSha: BLOB_A,
        exemptions: { "code-owner": 1, "documentation-address": 2, "own-address": 40, "owner-reference": 1 },
        filesScanned: 3,
        findings: [
          { className: "person", kind: "private-term", line: 1, path: "secret/quillfeather.md" },
          { kind: "hygiene", label: "denylist", line: 2, path: "b.txt" },
        ],
        acceptedOnAnchor: { ...emptyAcceptedOnAnchor(), money: 4, topic: 2 },
        recordId: "r",
        reviewedAccepted: 31,
        reviewedResidueSha256: "e".repeat(64),
        schemaVersion: 3,
        sourceTreeSha: BLOB_A,
        status: "refused",
        verifiedAtIso: "2026-11-20T01:02:03.000Z",
      },
    });
    expect(lines).toEqual([
      `fresh-cut verify: tree ${BLOB_A} matches the record and the cut's root`,
      "fresh-cut verify: 3 files scanned — 1 hygiene finding(s), 1 private-term finding(s)",
      "fresh-cut verify: private-term matches exempted — own-address 40, code-owner 1, owner-reference 1, documentation-address 2",
      "fresh-cut verify: reviewed, accepted: 31",
      "fresh-cut verify: of those, accepted on an owner anchor — owner-name 0, owner-handle 0, person 0, organisation 0, place 0, health 0, money 4, topic 2",
      "fresh-cut verify: reviewed, unmatched: 5",
      "fresh-cut verify: REFUSED — report /home/fresh-cuts/r/verify-1.json",
    ]);
  });
});
