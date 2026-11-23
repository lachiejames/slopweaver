import { describe, expect, it } from "vitest";

import { slopweaverHome } from "../../../config.js";
import { IDENTIFIER_KINDS } from "../../../hygiene/identifierScan.js";
import { partitionHits, scanReportLines } from "../../../hygiene/repoScan.js";
import {
  CREDENTIAL_LABELS,
  denylistStatusLine,
  type Hit,
  IDENTIFIER_VERDICT,
  isRefusedHit,
  isSecretHit,
  loadDenylist,
  loadDenylistResult,
  loadLineListResult,
  loadTextFileResult,
  REFUSABLE_IDENTIFIER_LABELS,
  SYNTHETIC_WORKSPACE_ID_LABEL,
  scanContent,
} from "../../../hygiene/scan.js";
import { stateHomePaths } from "../../../stateHome.js";

const noDenylist: readonly string[] = [];

describe("scanContent", () => {
  it("flags an absolute home path", () => {
    // Assemble the path so this test file does not itself carry a literal the scanner would flag.
    const hits = scanContent({ content: 'const p = "/ho' + 'me/alice/keys"', denylist: noDenylist, path: "a.ts" });
    expect(hits.map((h) => h.label)).toContain("absolute-home-path");
  });

  it("flags token shapes only when a real token follows the prefix", () => {
    const real = scanContent({ content: "token=ghp_" + "a".repeat(30), denylist: noDenylist, path: "a.ts" });
    expect(real.map((h) => h.label)).toContain("github-oauth-token");
    const bare = scanContent({ content: "the ghp_ prefix alone", denylist: noDenylist, path: "a.ts" });
    expect(bare).toHaveLength(0);
  });

  it("flags a Slack app token and a Linear API key in the shape each provider issues, and not a fake", () => {
    // Assembled from parts so this file carries no literal the gate itself would flag. Only the SECRET hits are
    // compared: the app id inside the token is also, correctly, a raw-workspace-id identifier hit.
    const appToken = ["xapp", "1", ["A0", "123ABCDEF"].join(""), "12345678901234", "f".repeat(64)].join("-");
    const linearKey = ["lin", "api", "A".repeat(40)].join("_");
    const labels = ({ content }: { content: string }): readonly string[] =>
      scanContent({ content, denylist: noDenylist, path: "a.ts" })
        .map((h) => h.label)
        .filter((label) => isSecretHit({ label }));

    expect(labels({ content: `SLACK_APP_TOKEN=${appToken}` })).toEqual(["slack-app-token"]);
    expect(labels({ content: `LINEAR_API_KEY=${linearKey}` })).toEqual(["linear-api-key"]);
    expect(labels({ content: `k=${["lin", "api", "abcdefghijklmnopqrstuvwx"].join("_")}` })).toEqual([]);
    expect(labels({ content: `k=${["lin", "api", "replay-not-real"].join("_")}` })).toEqual([]);
    expect(labels({ content: `k=${["lin", "api", "A".repeat(41)].join("_")}` })).toEqual([]);
  });

  it("flags a token shape that a word character precedes", () => {
    // The two shapes that used to be `\b`-anchored. `client_secret_<value>` and a concatenated `xsk-<key>`
    // are the commonest real spellings of each, and both begin one word character too late for `\b`, so the
    // gate reported clean over them. Assembled from parts so this file carries no floggable literal.
    const secretHits = scanContent({
      content: `client_${["secret", "_"].join("")}${"a".repeat(20)}`,
      denylist: noDenylist,
      path: "a.ts",
    });
    expect(secretHits.map((h) => h.label)).toContain("client-secret");
    // 48 characters, which is the length OpenAI actually issues — see the PATTERNS note in `scan.ts` for the
    // measurement that replaced the old 20-character floor with the provider's own shape.
    const keyHits = scanContent({
      content: `x${["sk", "-"].join("")}${"a".repeat(48)}`,
      denylist: noDenylist,
      path: "a.ts",
    });
    expect(keyHits.map((h) => h.label)).toContain("openai-style-key");
  });

  it("flags a PROJECT-family key, and not the URL slug that used to read as one", () => {
    // Both assembled: the gate cannot tell a fixture from a leak, and a literal here would redden it.
    // 48 base64url characters with an uppercase letter in them is a key; a lowercase hyphenated slug is a
    // Linear branch name. The 49-hit measurement behind this split is in `scan.ts`'s PATTERNS note.
    const key = `${["sk", "proj", ""].join("-")}aBcDeFgHiJkLmNoPqRsTuVwX_aBcDeFgHiJkLmNoPqRsTuVwX`;
    expect(scanContent({ content: key, denylist: noDenylist, path: "a.ts" }).map((h) => h.label)).toContain(
      "openai-style-key",
    );

    const slug = `https://example.invalid/issue/T-1/request-for-zende${["sk", "admin", ""].join("-")}access-to-the-support-desk`;
    expect(scanContent({ content: slug, denylist: noDenylist, path: "a.ts" })).toEqual([]);
  });

  it("flags a raw workspace-id shape", () => {
    const hits = scanContent({ content: "channel C0123" + "ABCDEF here", denylist: noDenylist, path: "a.ts" });
    expect(hits.map((h) => h.label)).toContain("raw-workspace-id");
  });

  /** The raw-workspace-id excerpts one line produces, so each case states exactly which token was a hit. */
  const workspaceIds = ({ content }: { content: string }): readonly string[] =>
    scanContent({ content, denylist: noDenylist, path: "a.ts" })
      .filter((h) => h.label === "raw-workspace-id")
      .map((h) => h.excerpt);

  it("flags every one of the eight provider prefixes, DM, group, team and enterprise included", () => {
    // Assembled so this file carries no literal the gate would report.
    const body = "0123" + "ABCDEF";
    expect(["C", "U", "A", "W", "D", "G", "T", "E"].map((prefix) => workspaceIds({ content: prefix + body }))).toEqual(
      ["C", "U", "A", "W", "D", "G", "T", "E"].map((prefix) => [prefix + body]),
    );
    expect(workspaceIds({ content: "B" + body })).toEqual([]);
  });

  it("reports the three synthetic shapes under their own label, and nothing that merely resembles them", () => {
    const fixture = "UFIX" + "TURE01";
    const synthetic = "C0SY" + "N12345";
    const docExample = "C0123" + "456789";
    expect(workspaceIds({ content: `${fixture} ${synthetic} ${docExample}` })).toEqual([]);
    // Still a hit — `turn freeze` and the cassette tripwire refuse every hit — but under a label no gate refuses.
    expect(
      [fixture, synthetic, docExample].map((content) =>
        scanContent({ content, denylist: noDenylist, path: "a.ts" }).map((h) => [h.label, h.excerpt]),
      ),
    ).toEqual([
      [[SYNTHETIC_WORKSPACE_ID_LABEL, fixture]],
      [[SYNTHETIC_WORKSPACE_ID_LABEL, synthetic]],
      [[SYNTHETIC_WORKSPACE_ID_LABEL, docExample]],
    ]);
    expect(isRefusedHit({ label: SYNTHETIC_WORKSPACE_ID_LABEL })).toBe(false);
    expect(REFUSABLE_IDENTIFIER_LABELS.has(SYNTHETIC_WORKSPACE_ID_LABEL)).toBe(false);

    const nearFixture = "UFIX" + "TUR01AB";
    const nearSynthetic = "C0SY" + "M12345";
    const nearExample = "C0123" + "4567890";
    expect(workspaceIds({ content: nearFixture })).toEqual([nearFixture]);
    expect(workspaceIds({ content: nearSynthetic })).toEqual([nearSynthetic]);
    expect(workspaceIds({ content: nearExample })).toEqual([nearExample]);
  });

  it("still reports a real id that follows an allowed synthetic one on the same line", () => {
    const real = "D0123" + "ABCDEF";
    expect(workspaceIds({ content: `${"C0123" + "456789"} then ${real}` })).toEqual([real]);
  });

  it("flags an opaque hex id assembled into an id-named query parameter", () => {
    // Assembled from parts so this file carries no literal the gate would flag. This is the exact shape a
    // committed Polly cassette carried four times: the real account id in a query slot, while the same value
    // in the path form had already been collapsed.
    const hex = "0123456789abcdef".repeat(2);
    for (const name of ["id", "account.id", "account_id", "accountId", "labelIds"]) {
      const hits = scanContent({ content: `zones?${name}=${hex}`, denylist: noDenylist, path: "a.har" });
      expect(hits.map((h) => h.label)).toContain("id-query-param");
    }
    const second = scanContent({ content: `zones?page=2&account.id=${hex}`, denylist: noDenylist, path: "a.har" });
    expect(second.map((h) => h.label)).toContain("id-query-param");
  });

  it("leaves a query parameter that is not an id, or an id that is not opaque hex, alone", () => {
    const hex = "0123456789abcdef".repeat(2);
    const notAnIdName = scanContent({ content: `search?q=${hex}`, denylist: noDenylist, path: "a.har" });
    expect(notAnIdName).toHaveLength(0);
    const shortValue = scanContent({ content: "zones?account.id=abc123", denylist: noDenylist, path: "a.har" });
    expect(shortValue).toHaveLength(0);
    const notHex = scanContent({ content: `zones?account.id=${"z".repeat(32)}`, denylist: noDenylist, path: "a.har" });
    expect(notHex).toHaveLength(0);
    const redacted = scanContent({
      content: "zones?account.id=REDACTED_ID&page=2",
      denylist: noDenylist,
      path: "a.har",
    });
    expect(redacted).toHaveLength(0);
  });

  it("applies a user denylist case-insensitively", () => {
    const hits = scanContent({ content: "my ACME Corp secret", denylist: ["acme corp"], path: "a.ts" });
    expect(hits.map((h) => h.label)).toContain("denylist");
  });

  it("returns nothing for clean content", () => {
    expect(scanContent({ content: "export const x = 1\n", denylist: noDenylist, path: "a.ts" })).toHaveLength(0);
  });
});

/** A reader that fails with a given errno, so the unreadable branch is provable without touching the disk. */
function failingReader({ code }: { code: string }): (args: { path: string }) => string {
  return () => {
    const error: Error & { code?: string } = new Error("boom");
    error.code = code;
    throw error;
  };
}

describe("loadLineListResult", () => {
  it("loads lines, dropping blanks and comments", () => {
    const loaded = loadLineListResult({ path: "/x", readText: () => "  alpha \n\n# note\nbeta\n" });
    expect(loaded).toEqual({ kind: "loaded", lines: ["alpha", "beta"] });
  });

  it("reports a MISSING file as absent, which is the legitimate optional case", () => {
    const loaded = loadLineListResult({
      nameExists: () => false,
      path: "/x",
      readText: failingReader({ code: "ENOENT" }),
    });
    expect(loaded).toEqual({ kind: "absent" });
  });

  it("reports a missing TARGET behind a link as unreadable, since a name sits at the path", () => {
    const loaded = loadLineListResult({
      nameExists: () => true,
      path: "/x",
      readText: failingReader({ code: "ENOENT" }),
    });
    expect(loaded).toEqual({ kind: "unreadable", path: "/x", reason: "ENOENT: a dangling link sits at the path" });
  });

  it("reports an UNREADABLE file as unreadable, never as an empty list", () => {
    expect(loadLineListResult({ path: "/x", readText: failingReader({ code: "EACCES" }) })).toEqual({
      kind: "unreadable",
      path: "/x",
      reason: "EACCES",
    });
  });

  it("treats a reader that throws without an errno as unreadable rather than absent", () => {
    const loaded = loadLineListResult({
      path: "/x",
      readText: () => {
        throw new Error("no code");
      },
    });
    expect(loaded).toEqual({ kind: "unreadable", path: "/x", reason: "read failed" });
  });

  it("loads an empty file as zero lines, which is different from absent", () => {
    expect(loadLineListResult({ path: "/x", readText: () => "" })).toEqual({ kind: "loaded", lines: [] });
  });
});

describe("loadTextFileResult", () => {
  it("keeps the whole text, comments, blanks and line endings included", () => {
    expect(loadTextFileResult({ path: "/x", readText: () => "# c\r\n\r\n  a \n" })).toEqual({
      kind: "loaded",
      text: "# c\r\n\r\n  a \n",
    });
  });

  it("tells absent from a dangling link and from an unreadable file", () => {
    expect(
      loadTextFileResult({ nameExists: () => false, path: "/x", readText: failingReader({ code: "ENOENT" }) }),
    ).toEqual({
      kind: "absent",
    });
    expect(
      loadTextFileResult({ nameExists: () => true, path: "/x", readText: failingReader({ code: "ENOENT" }) }),
    ).toEqual({
      kind: "unreadable",
      path: "/x",
      reason: "ENOENT: a dangling link sits at the path",
    });
    expect(loadTextFileResult({ path: "/x", readText: failingReader({ code: "EACCES" }) })).toEqual({
      kind: "unreadable",
      path: "/x",
      reason: "EACCES",
    });
  });
});

describe("loadDenylist", () => {
  it("resolves the home itself rather than reading a raw environment variable", () => {
    // The bug this guards: reading process.env directly yielded undefined when the variable was unset, so
    // the private denylist was silently empty in every `yarn validate` and every pre-push.
    const seen: string[] = [];
    const entries = loadDenylistResult({
      home: "/tmp/some-home",
      readText: ({ path }) => {
        seen.push(path);
        return "acme corp\n";
      },
    });
    expect(entries).toEqual({ kind: "loaded", lines: ["acme corp"] });
    expect(seen).toEqual(["/tmp/some-home/hygiene-denylist.txt"]);
  });

  it("defaults the home to the shared resolver, so an unset environment still finds the list", () => {
    // THE REGRESSION THIS PINS: the runner used to pass `process.env["SLOPWEAVER_HOME"]` straight in. With
    // the variable unset that is `undefined`, the denylist loaded as `[]`, and the gate printed `clean`
    // having checked no org identifiers at all. Asserting the resolved path — with NO `home` argument —
    // is what makes reverting to a raw env read turn this red.
    const seen: string[] = [];
    // home-safety-exempt: deliberately proves the DEFAULT resolves to the real ambient home — the exact
    // regression above — with `readText` injected as a fake, so nothing on disk is ever touched.
    loadDenylistResult({
      readText: ({ path }) => {
        seen.push(path);
        return "";
      },
    });
    expect(seen).toEqual([stateHomePaths({ home: slopweaverHome() }).hygieneDenylist]);
  });

  it("THROWS when the denylist exists but cannot be read", () => {
    expect(() => loadDenylist({ home: "/tmp/some-home", readText: failingReader({ code: "EACCES" }) })).toThrowError(
      /could not be read \(EACCES\)/,
    );
  });

  it("returns an empty list when the denylist simply does not exist", () => {
    expect(loadDenylist({ home: "/tmp/some-home", readText: failingReader({ code: "ENOENT" }) })).toEqual([]);
  });
});

describe("denylistStatusLine", () => {
  it("distinguishes an ABSENT list from an EMPTY one — the two ways CI ran the weaker scan", () => {
    // Both used to print nothing at all, so a `clean` verdict could not be told apart from a scan that had
    // applied no local word. CI produces one of each: `build` sets no home, `dev-gate` runs
    // `slopweaver init`, whose denylist seed is comment lines only.
    const absent = denylistStatusLine({ load: { kind: "absent" } });
    const empty = denylistStatusLine({ load: { kind: "loaded", lines: [] } });

    expect(absent).toContain("NOT PRESENT");
    expect(empty).toContain("PRESENT BUT EMPTY");
    expect(absent).not.toBe(empty);
  });

  it("names how many words a loaded list actually applied", () => {
    expect(denylistStatusLine({ load: { kind: "loaded", lines: ["a", "b", "c"] } })).toBe(
      "hygiene: private denylist LOADED, 3 word(s) applied",
    );
  });

  it("says an unreadable list applied NOTHING, and names the file and the reason", () => {
    const line = denylistStatusLine({
      load: { kind: "unreadable", path: "/h/hygiene-denylist.txt", reason: "EACCES" },
    });

    expect(line).toContain("UNREADABLE at /h/hygiene-denylist.txt");
    expect(line).toContain("EACCES");
    expect(line).toContain("nothing was applied");
  });
});

/** A hit with only the field the verdict reads; the rest is reporting detail. */
const hit = ({ label }: { label: string }): Hit => ({ excerpt: "x", label, line: 1, path: "a.ts" });

describe("isSecretHit", () => {
  it("calls every credential label a secret", () => {
    expect([...CREDENTIAL_LABELS].toSorted()).toEqual([
      "client-secret",
      "github-oauth-token",
      "github-pat",
      "linear-api-key",
      "openai-style-key",
      "slack-app-token",
      "slack-token",
    ]);
    expect([...CREDENTIAL_LABELS].every((label) => isSecretHit({ label }))).toBe(true);
  });

  it("calls a private-denylist word a secret, which is the half with no pattern to derive it from", () => {
    expect(isSecretHit({ label: "denylist" })).toBe(true);
  });

  it("calls each of the three identifier classes NOT a secret — the narrowing", () => {
    expect(isSecretHit({ label: "absolute-home-path" })).toBe(false);
    expect(isSecretHit({ label: "raw-workspace-id" })).toBe(false);
    expect(isSecretHit({ label: "id-query-param" })).toBe(false);
  });
});

describe("isRefusedHit", () => {
  it("refuses every secret and every forbidden identifier, and no report-only identifier class", () => {
    expect(IDENTIFIER_VERDICT).toBe("refuse");
    expect(REFUSABLE_IDENTIFIER_LABELS.size).toBeGreaterThan(0);
    expect([...CREDENTIAL_LABELS, "denylist"].every((label) => isRefusedHit({ label }))).toBe(true);
    expect([...REFUSABLE_IDENTIFIER_LABELS].filter((label) => !isRefusedHit({ label }))).toEqual([]);
    expect(
      ["absolute-home-path", "id-query-param", SYNTHETIC_WORKSPACE_ID_LABEL].map((label) => isRefusedHit({ label })),
    ).toEqual([false, false, false]);
  });

  it("refuses a real-shaped workspace id and passes its synthetic stand-in, read off the scan itself", () => {
    // Assembled at runtime so this source never carries a refusable literal of its own.
    const real = "C0123" + "ABCDEF";
    const synthetic = "C0" + "SYN" + "123ABCDEF";
    const labels = scanContent({ content: `${real}\n${synthetic}`, denylist: noDenylist, path: "a.ts" }).map(
      (h) => h.label,
    );

    expect(labels).toEqual(["raw-workspace-id", SYNTHETIC_WORKSPACE_ID_LABEL]);
    expect(labels.map((label) => isRefusedHit({ label }))).toEqual([true, false]);
  });

  it("governs exactly the scanner's eight kinds and raw workspace ids, no other identifier class", () => {
    expect([...REFUSABLE_IDENTIFIER_LABELS]).toEqual([...IDENTIFIER_KINDS, "raw-workspace-id"]);
  });
});

describe("partitionHits", () => {
  it("splits a mixed scan into secrets, refused identifiers and reported ones, preserving scan order", () => {
    expect(
      partitionHits({
        hits: [
          hit({ label: "raw-workspace-id" }),
          hit({ label: "github-pat" }),
          hit({ label: "absolute-home-path" }),
          hit({ label: "denylist" }),
          hit({ label: "forbidden-word-ci" }),
          hit({ label: SYNTHETIC_WORKSPACE_ID_LABEL }),
        ],
      }),
    ).toEqual({
      refusedIdentifiers: [hit({ label: "raw-workspace-id" }), hit({ label: "forbidden-word-ci" })],
      reportedIdentifiers: [hit({ label: "absolute-home-path" }), hit({ label: SYNTHETIC_WORKSPACE_ID_LABEL })],
      secrets: [hit({ label: "github-pat" }), hit({ label: "denylist" })],
    });
  });

  it("puts a report-only scan entirely in the reported arm, so the gate exits 0 over it", () => {
    expect(partitionHits({ hits: [hit({ label: "id-query-param" })] })).toEqual({
      refusedIdentifiers: [],
      reportedIdentifiers: [hit({ label: "id-query-param" })],
      secrets: [],
    });
  });

  it("returns three empty arms for a clean scan", () => {
    expect(partitionHits({ hits: [] })).toEqual({ refusedIdentifiers: [], reportedIdentifiers: [], secrets: [] });
  });
});

describe("scanReportLines", () => {
  const loaded = { kind: "loaded", lines: [] } as const;

  it("prints a refused identifier under IDENTIFIER and a credential under SECRET, neither twice", () => {
    expect(
      scanReportLines({
        failing: true,
        files: ["a.ts"],
        load: loaded,
        refusedIdentifiers: [hit({ label: "raw-workspace-id" })],
        reportedIdentifiers: [],
        secrets: [hit({ label: "github-pat" })],
        unreadable: [],
      }),
    ).toEqual([
      denylistStatusLine({ load: loaded }),
      "hygiene: 1 SECRET hit(s) — these fail:",
      "  a.ts:1: [github-pat] x",
      "hygiene: 1 IDENTIFIER hit(s) — these fail (replace each with a synthetic stand-in, " +
        'see AGENTS.md § "no organisation names in what you commit"):',
      "  a.ts:1: [raw-workspace-id] x",
    ]);
  });

  it("passes a report-only scan as no refused hits, naming the files it read", () => {
    expect(
      scanReportLines({
        failing: false,
        files: ["a.ts", "b.ts"],
        load: loaded,
        refusedIdentifiers: [],
        reportedIdentifiers: [hit({ label: SYNTHETIC_WORKSPACE_ID_LABEL })],
        secrets: [],
        unreadable: [],
      }),
    ).toEqual([
      denylistStatusLine({ load: loaded }),
      "hygiene: 1 identifier hit(s) — reported, NOT a failure " +
        '(state belongs under $SLOPWEAVER_HOME, see AGENTS.md § "no secrets, ever"):',
      `  a.ts:1: [${SYNTHETIC_WORKSPACE_ID_LABEL}] x`,
      "hygiene: no refused hits (identifier hits above are informational) (2 files scanned)",
    ]);
  });
});
