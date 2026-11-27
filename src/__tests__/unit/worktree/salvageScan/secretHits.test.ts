/**
 * What a salvage scan counts as a secret in a blob, and how its decline names one.
 *
 * Every refusal case feeds the secret IN and asserts both halves — that the scan declines, and that the
 * decline does not quote it — because a `not.toContain` over input that never carried the secret proves
 * nothing (`testing.md` § the replay lane's witness rule, which applies to any redaction claim).
 */
import { describe, expect, it } from "vitest";

import type { IdentifierScanner } from "../../../../hygiene/identifierScan.js";
import { blobSecretHits, identifierHitsOrDecline, secretDecline } from "../../../../worktree/salvageFindings.js";
import { IDENTIFIERS, ORG, TOKEN } from "./harness.js";

describe("blobSecretHits", () => {
  it("finds a secret and attributes it to the blob's path", () => {
    const hits = blobSecretHits({ blobs: [{ content: `const t = "${TOKEN}";`, path: "src/config.ts" }], denylist: [] });
    expect(hits.map((hit) => [hit.label, hit.path])).toEqual([["github-oauth-token", "src/config.ts"]]);
  });

  it("counts a private denylist word as a secret, as the repository gate does", () => {
    const hits = blobSecretHits({
      blobs: [{ content: "the word zanzibar-internal appears here", path: "notes.md" }],
      denylist: ["zanzibar-internal"],
    });
    expect(hits.map((hit) => hit.label)).toEqual(["denylist"]);
  });

  it("passes an IDENTIFIER-class hit, which the repository gate reports and does not fail on", () => {
    expect(blobSecretHits({ blobs: [{ content: "see /Users/someone/dev", path: "doc.md" }], denylist: [] })).toEqual(
      [],
    );
  });

  it("scans a BINARY blob too, stricter than the repository gate, because the push publishes every byte", () => {
    const content = `\u0000\u0001${TOKEN}\u0000`;
    expect(content).toContain(TOKEN);
    expect(
      blobSecretHits({ blobs: [{ content, path: "image.png" }], denylist: [] }).map((hit) => [hit.label, hit.path]),
    ).toEqual([["github-oauth-token", "image.png"]]);
  });
});

describe("secretDecline", () => {
  it("names the class and the file and NEVER the matched text", () => {
    const content = `const t = "${TOKEN}";`;
    const line = secretDecline({
      denylist: [],
      hits: blobSecretHits({ blobs: [{ content, path: "src/config.ts" }], denylist: [] }),
      identifiers: IDENTIFIERS,
    });
    expect(line).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in src/config.ts — nothing was pushed",
    );
    expect(content).toContain(TOKEN);
    expect(line).not.toContain(TOKEN);
  });
});

describe("secretDecline over a path that is itself a secret", () => {
  it("names the class and withholds a file NAMED like a token, which would otherwise print it", () => {
    const path = `keys/${TOKEN}.txt`;
    const line = secretDecline({
      denylist: [],
      hits: blobSecretHits({ blobs: [{ content: `token=${TOKEN}\n`, path }], denylist: [] }),
      identifiers: IDENTIFIERS,
    });
    expect(line).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a path that itself matches a secret pattern — nothing was pushed",
    );
    expect(path).toContain(TOKEN);
    expect(line).not.toContain(TOKEN);
  });

  it("withholds a path carrying a PRIVATE denylist string, the class the repository gate reports by list", () => {
    const path = "zanzibar-internal/notes.txt";
    const line = secretDecline({
      denylist: ["zanzibar-internal"],
      hits: blobSecretHits({ blobs: [{ content: `token=${TOKEN}\n`, path }], denylist: [] }),
      identifiers: IDENTIFIERS,
    });
    expect(line).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a path that itself matches a secret pattern — nothing was pushed",
    );
    expect(path).toContain("zanzibar-internal");
    expect(line).not.toContain("zanzibar-internal");
  });

  it("withholds a path carrying a FORBIDDEN IDENTIFIER, so a secret decline never prints the organisation's name", () => {
    const path = `${ORG}/key.txt`;
    const line = secretDecline({
      denylist: [],
      hits: blobSecretHits({ blobs: [{ content: `token=${TOKEN}\n`, path }], denylist: [] }),
      identifiers: IDENTIFIERS,
    });
    expect(line).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a path that itself carries a forbidden identifier — nothing was pushed",
    );
    expect(path).toContain(ORG);
    expect(line).not.toContain(ORG);
  });

  it("withholds every path when the identifier scanner throws on one, rather than printing it unscanned", () => {
    const throwing: IdentifierScanner = {
      scan: () => {
        throw new Error("rules unreadable");
      },
      spans: () => [],
    };
    const line = secretDecline({
      denylist: [],
      hits: blobSecretHits({ blobs: [{ content: `token=${TOKEN}\n`, path: `${ORG}/key.txt` }], denylist: [] }),
      identifiers: throwing,
    });
    expect(line).toBe(
      "the work it would push carries 1 secret-class line(s) (github-oauth-token) in a path that could not be scanned for identifiers — nothing was pushed",
    );
  });
});

describe("identifierHitsOrDecline over a scanner that throws", () => {
  it("declines without quoting the scanner's message, which no scanner has judged", () => {
    const message = `rule for ${ORG} broke`;
    const throwing: IdentifierScanner = {
      scan: () => {
        throw new Error(message);
      },
      spans: () => [],
    };
    const line = identifierHitsOrDecline({
      identifiers: throwing,
      texts: [{ commit: false, content: "clean\n", path: "a.ts" }],
    });
    expect(message).toContain(ORG);
    expect(line).toBe(
      "what it would push could not be scanned for identifiers — the identifier scanner threw, its message withheld; nothing was pushed",
    );
  });
});
