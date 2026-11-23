/**
 * The forbidden-identifier scanner over SYNTHETIC rules: every token below is invented, hashed here and
 * injected, so each mode is proven with a planted hit beside a near miss that must pass — and no real name
 * ever has to appear in a test.
 */
import { describe, expect, it } from "vitest";

import { compileLocation } from "../../../hygiene/identifierPatternSpans.js";
import { identifierFindingLines, identifierReport, identifierSummaryLines } from "../../../hygiene/identifierReport.js";
import {
  type ForbiddenIdentifierRules,
  type IdentifierHit,
  identifierDigest,
  identifierScanner,
  scanForbiddenIdentifiers,
} from "../../../hygiene/identifierScan.js";
import { identifierOutputMode } from "../../../hygiene/identifierScanRun.js";

const d = ({ text }: { text: string }): string => identifierDigest({ text });

const RULES: ForbiddenIdentifierRules = {
  hashed: {
    embeddedUpper: [d({ text: "QZV" })],
    exactIds: [d({ text: "XK42PLM" })],
    exemptTicketReferences: [d({ text: "ZZT-7" })],
    substringCi: [{ hash: d({ text: "quuxcorp" }), length: 8 }],
    spanHeads: [d({ text: "fizz" })],
    substringCs: [{ hash: d({ text: "Blorpo" }), length: 6 }],
    teamKeys: [d({ text: "ZZT" })],
    wordCi: [d({ text: "zorblatt" })],
    wordCs: [d({ text: "Fizz Wobble" })],
  },
  providerLocations: [
    {
      allowed: ["acme"],
      marker: "slack.com",
      provider: "slack",
      re: /(?<![a-z0-9%\\-])([a-z0-9][a-z0-9-]*)\.slack\.com/gi,
    },
  ],
};

/** The kinds one text produces, in the order found. */
const kinds = ({ content }: { content: string }): readonly string[] =>
  scanForbiddenIdentifiers({ content, path: "f.md", rules: RULES }).map((hit) => hit.kind);

describe("identifierDigest", () => {
  it("is SHA-256 hex over the UTF-8 bytes — the canonical form the generator writes", () => {
    expect(d({ text: "abc" })).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("scanForbiddenIdentifiers — one planted hit and one near miss per mode", () => {
  it("substring, case-insensitive: inside a longer run, any case; not split across two runs", () => {
    expect(kinds({ content: "the MyQuuxCorpTeam board" })).toEqual(["forbidden-substring-ci"]);
    expect(kinds({ content: "quux corp" })).toEqual([]);
  });

  it("substring, case-sensitive: inside a run in its own case; not in another case", () => {
    expect(kinds({ content: "theBlorpoApp" })).toEqual(["forbidden-substring-cs"]);
    expect(kinds({ content: "theblorpoapp" })).toEqual([]);
  });

  it("word, case-insensitive: the whole word in any case; not a longer word", () => {
    expect(kinds({ content: "ZORBLATT said" })).toEqual(["forbidden-word-ci"]);
    expect(kinds({ content: "the zorblatts" })).toEqual([]);
  });

  it("word, case-sensitive: a two-run phrase joined by one space; not two spaces, a newline or another case", () => {
    expect(kinds({ content: "met Fizz Wobble today" })).toEqual(["forbidden-word-cs"]);
    expect(kinds({ content: "Fizz  Wobble" })).toEqual([]);
    expect(kinds({ content: "Fizz\nWobble" })).toEqual([]);
    expect(kinds({ content: "fizz wobble" })).toEqual([]);
  });

  it("word span: extended only behind a listed head, so the same phrase with no head rule is never hashed", () => {
    const headless: ForbiddenIdentifierRules = { ...RULES, hashed: { ...RULES.hashed, spanHeads: [] } };
    expect(scanForbiddenIdentifiers({ content: "met Fizz Wobble today", path: "f.md", rules: RULES })).toEqual([
      { kind: "forbidden-word-cs", line: 1, path: "f.md" },
    ]);
    expect(scanForbiddenIdentifiers({ content: "met Fizz Wobble today", path: "f.md", rules: headless })).toEqual([]);
  });

  it("embedded upper: a token spelled inside an id after a 0; not a longer capital run", () => {
    expect(kinds({ content: "U0QZV12" })).toEqual(["forbidden-embedded-upper"]);
    expect(kinds({ content: "U0QZVX12" })).toEqual([]);
  });

  it("exact id: the whole uppercase run; not a different case or a longer run", () => {
    expect(kinds({ content: "in XK42PLM here" })).toEqual(["forbidden-exact-id"]);
    expect(kinds({ content: "in xK42PLM and XK42PLM9" })).toEqual([]);
  });

  it("team key: KEY-123; not a six-digit suffix, another case, or the exempt complete reference", () => {
    expect(kinds({ content: "see ZZT-12" })).toEqual(["forbidden-team-key"]);
    expect(kinds({ content: "ZZT-123456 zzt-12 ZZT-7" })).toEqual([]);
  });

  it("provider location: a label the rule does not allow; not an allowed, encoded or hyphen-led one", () => {
    // Assembled at runtime, so this file never carries the hit it plants into the repository's own scan.
    expect(kinds({ content: `https://${"Wobble"}.slack.com/archives` })).toEqual(["forbidden-provider-location"]);
    expect(kinds({ content: "https://acme.slack.com %2Fwobble.slack.com https://-wobble.slack.com" })).toEqual([]);
  });

  it("provider location: an unproven marker is ignored, so a branch matching without it is still a hit", () => {
    const alternating: ForbiddenIdentifierRules = {
      ...RULES,
      providerLocations: [{ allowed: [], marker: "slack.com", provider: "x", re: /([a-z]+)(?:slack.com|other.com)/gi }],
    };
    expect(scanForbiddenIdentifiers({ content: "foootherXcom", path: "f.md", rules: alternating })).toEqual([
      { kind: "forbidden-provider-location", line: 1, path: "f.md" },
    ]);
  });

  it("provider location: a Unicode-mode pattern always runs, so a case-folded match is still a hit", () => {
    const folding: ForbiddenIdentifierRules = {
      ...RULES,
      providerLocations: [{ allowed: [], marker: "s", provider: "x", re: /([a-z]+)s/giu }],
    };
    expect(scanForbiddenIdentifiers({ content: "fooſ", path: "f.md", rules: folding })).toEqual([
      { kind: "forbidden-provider-location", line: 1, path: "f.md" },
    ]);
  });

  it("provider location: a non-ASCII marker is ignored, so a final-sigma match is still a hit", () => {
    const sigma: ForbiddenIdentifierRules = {
      ...RULES,
      providerLocations: [{ allowed: [], marker: "σ", provider: "x", re: /([a-z]+)Σ/gi }],
    };
    expect(scanForbiddenIdentifiers({ content: "fooς", path: "f.md", rules: sigma })).toEqual([
      { kind: "forbidden-provider-location", line: 1, path: "f.md" },
    ]);
  });

  it("provider location: the marker is read once, so the value proved is the value the skip uses", () => {
    let reads = 0;
    const shifting = {
      allowed: [],
      get marker(): string {
        reads += 1;
        return reads === 1 ? "slack.com" : "other.com";
      },
      provider: "x",
      re: /([a-z]+)slack\.com/gi,
    };
    const rules: ForbiddenIdentifierRules = { ...RULES, providerLocations: [shifting] };
    expect(scanForbiddenIdentifiers({ content: "fooslack.com", path: "f.md", rules })).toEqual([
      { kind: "forbidden-provider-location", line: 1, path: "f.md" },
    ]);
  });

  it("provider location: the marker test is case-blind, so an upper-case host still runs the pattern", () => {
    expect(kinds({ content: `https://${"wobble"}.SLACK.COM/archives` })).toEqual(["forbidden-provider-location"]);
  });

  it("provider location: a hit survives a caller's own exec having advanced the shared rule's lastIndex", () => {
    const content = `https://${"wobble"}.slack.com`;
    const shared = RULES.providerLocations[0]!.re;
    shared.exec(content);
    expect(shared.lastIndex).toBeGreaterThan(0);
    expect(kinds({ content })).toEqual(["forbidden-provider-location"]);
    shared.lastIndex = 0;
  });

  it("names the 1-based line of every hit and returns nothing for clean text", () => {
    expect(scanForbiddenIdentifiers({ content: "a\nb\nzorblatt\nZZT-3", path: "f.md", rules: RULES })).toEqual([
      { kind: "forbidden-word-ci", line: 3, path: "f.md" },
      { kind: "forbidden-team-key", line: 4, path: "f.md" },
    ]);
    expect(kinds({ content: "nothing to see\n" })).toEqual([]);
  });

  it("gives the same answer from a scanner reused across files, whose caches are warm", () => {
    const scanner = identifierScanner({ rules: RULES });
    scanner.scan({ content: "MyQuuxCorpTeam zorblatt", path: "a.md" });
    expect(scanner.scan({ content: "MyQuuxCorpTeam zorblatt", path: "b.md" })).toEqual([
      { kind: "forbidden-substring-ci", line: 1, path: "b.md" },
      { kind: "forbidden-word-ci", line: 1, path: "b.md" },
    ]);
  });
});

/** Every span one text produces, each with the text it covers, sorted by offset so the order is fixed. */
const spansOf = ({ content }: { content: string }): readonly { kind: string; text: string }[] =>
  identifierScanner({ rules: RULES })
    .spans({ content })
    .toSorted((a, b) => a.offset - b.offset)
    .map((span) => ({ kind: span.kind, text: content.slice(span.offset, span.offset + span.length) }));

describe("identifierScanner.spans — the exact place of every hit, which a redactor masks", () => {
  it("substring: the matching window inside its run, not the whole run, and every window in it", () => {
    expect(spansOf({ content: "the MyQuuxCorpTeam board" })).toEqual([
      { kind: "forbidden-substring-ci", text: "QuuxCorp" },
    ]);
    expect(spansOf({ content: "quuxcorpQUUXCORP" })).toEqual([
      { kind: "forbidden-substring-ci", text: "quuxcorp" },
      { kind: "forbidden-substring-ci", text: "QUUXCORP" },
    ]);
  });

  it("word: a multi-run phrase spans both runs and the joiner", () => {
    expect(spansOf({ content: "met Fizz Wobble today" })).toEqual([{ kind: "forbidden-word-cs", text: "Fizz Wobble" }]);
  });

  it("embedded upper, exact id and team key: the token, the whole id and the whole reference", () => {
    expect(spansOf({ content: "U0QZV12 XK42PLM ZZT-12" })).toEqual([
      { kind: "forbidden-embedded-upper", text: "QZV" },
      { kind: "forbidden-exact-id", text: "XK42PLM" },
      { kind: "forbidden-team-key", text: "ZZT-12" },
    ]);
  });

  it("provider location: the workspace label alone, so the provider's host survives a mask", () => {
    const content = `see https://${"Wobble"}.slack.com/archives`;
    expect(spansOf({ content })).toEqual([{ kind: "forbidden-provider-location", text: "Wobble" }]);
  });

  it("provider location: scan reports the match's line while spans covers the label a later line holds", () => {
    const spanning: ForbiddenIdentifierRules = {
      ...RULES,
      providerLocations: [{ allowed: [], marker: "label", provider: "x", re: /prefix\n(label)/gi }],
    };
    expect(scanForbiddenIdentifiers({ content: "prefix\nlabel", path: "p", rules: spanning })).toEqual([
      { kind: "forbidden-provider-location", line: 1, path: "p" },
    ]);
    expect(identifierScanner({ rules: spanning }).spans({ content: "prefix\nlabel" })).toEqual([
      { kind: "forbidden-provider-location", length: 5, offset: 7 },
    ]);
  });

  it("reports nothing for clean text, and the same lines through scan as before", () => {
    expect(spansOf({ content: "quux corp, the zorblatts" })).toEqual([]);
    expect(
      scanForbiddenIdentifiers({ content: `x\nU0QZV12 https://${"wobble"}.slack.com`, path: "f.md", rules: RULES }),
    ).toEqual([
      { kind: "forbidden-embedded-upper", line: 2, path: "f.md" },
      { kind: "forbidden-provider-location", line: 2, path: "f.md" },
    ]);
  });
});

describe("compileLocation", () => {
  it("adds the d flag so a match reports its label group, and runs the pattern always when the marker is unproven", () => {
    const compiled = compileLocation({
      allowed: ["Acme"],
      marker: "nowhere",
      provider: "slack",
      re: /(\w+)\.x\.com/gi,
    });
    expect([compiled.re.flags, compiled.marker, [...compiled.allowed]]).toEqual(["dgi", "", ["Acme"]]);
  });

  it("keeps a marker the pattern provably requires", () => {
    const compiled = compileLocation({ allowed: [], marker: ".x.com", provider: "slack", re: /(\w+)\.x\.com/gi });
    expect(compiled.marker).toBe(".x.com");
  });
});

const HITS: readonly IdentifierHit[] = [
  { kind: "forbidden-word-ci", line: 9, path: "b.md" },
  { kind: "forbidden-word-ci", line: 4, path: "b.md" },
  { kind: "forbidden-team-key", line: 2, path: "b.md" },
  { kind: "forbidden-word-cs", line: 1, path: "a.md" },
  { kind: "forbidden-word-ci", line: 5, path: "scratch.md" },
];
const REPORT = identifierReport({ hits: HITS, trackedPaths: new Set(["a.md", "b.md", "c.md"]) });

describe("identifierReport", () => {
  it("folds hits to one finding per (file, kind) with its first line, sorted by path then kind", () => {
    expect(REPORT.findings).toEqual([
      { count: 1, firstLine: 1, kind: "forbidden-word-cs", path: "a.md" },
      { count: 2, firstLine: 4, kind: "forbidden-word-ci", path: "b.md" },
      { count: 1, firstLine: 2, kind: "forbidden-team-key", path: "b.md" },
      { count: 1, firstLine: 5, kind: "forbidden-word-ci", path: "scratch.md" },
    ]);
  });

  it("counts the headline over tracked files only, and the untracked hit apart", () => {
    expect([REPORT.trackedFiles, REPORT.trackedHitFiles, REPORT.untrackedHitFiles]).toEqual([3, 2, 1]);
  });
});

describe("identifierSummaryLines / identifierFindingLines", () => {
  it("prints per-kind totals, the tracked headline and the untracked line — no matched text", () => {
    expect(identifierSummaryLines({ report: REPORT, verdict: "report" })).toEqual([
      "hygiene: forbidden-word-ci: 3 hit(s) in 2 file(s)",
      "hygiene: forbidden-word-cs: 1 hit(s) in 1 file(s)",
      "hygiene: forbidden-team-key: 1 hit(s) in 1 file(s)",
      "hygiene: 2 of 3 tracked files carry a forbidden identifier (report mode — not a failure)",
      "hygiene: 1 untracked file(s) also carry a forbidden identifier",
    ]);
  });

  it("says refused under the refuse verdict, and omits the untracked line when there is none", () => {
    const clean = identifierReport({ hits: [], trackedPaths: new Set(["a.md"]) });
    expect(identifierSummaryLines({ report: clean, verdict: "refuse" })).toEqual([
      "hygiene: 0 of 1 tracked files carry a forbidden identifier (refused)",
    ]);
  });

  it("lists one indented location-and-count line per finding", () => {
    expect(identifierFindingLines({ report: REPORT })).toEqual([
      "  a.md:1: [forbidden-word-cs] 1 hit(s)",
      "  b.md:4: [forbidden-word-ci] 2 hit(s)",
      "  b.md:2: [forbidden-team-key] 1 hit(s)",
      "  scratch.md:5: [forbidden-word-ci] 1 hit(s)",
    ]);
  });
});

describe("identifierOutputMode", () => {
  it("maps no argument to the summary, --list to the listing, and refuses anything else", () => {
    expect(identifierOutputMode({ argv: [] })).toBe("summary");
    expect(identifierOutputMode({ argv: ["--list"] })).toBe("list");
    expect(identifierOutputMode({ argv: ["--lst"] })).toBe(undefined);
    expect(identifierOutputMode({ argv: ["--list", "x"] })).toBe(undefined);
  });
});
