import { describe, expect, it } from "vitest";

import type { ReviewPacketImage } from "../../../../live/turn/reviewImages.js";
import { packetVerdictSection } from "../../../../live/turn/reviewVerdictSection.js";

const DIGEST = "sha256:aaaa";
const IMAGE_DIGEST = "sha256:bbbb";

/** The section for one set of inputs, with fixed sessions, path and digest. */
const section = ({
  images,
  round,
  supersedes,
  voiceRuleCount,
}: {
  images: readonly ReviewPacketImage[];
  round: number;
  supersedes: string | undefined;
  voiceRuleCount: number;
}): readonly string[] =>
  packetVerdictSection({
    answerDigest: DIGEST,
    authorSession: "author-1",
    images,
    reviewerSession: "reviewer-1",
    round,
    supersedes,
    verdictPath: "/tmp/verdict.json",
    voiceRuleCount,
  });

/** The fenced JSON example, parsed back out of the rendered lines. */
const exampleOf = ({ lines }: { lines: readonly string[] }): unknown => {
  const open = lines.indexOf("```json");
  return JSON.parse(lines[open + 1]!);
};

/** The two example claims every verdict example carries, whatever the inputs. */
const EXAMPLE_CLAIMS = [
  {
    evidence: "where you looked",
    impact: "high",
    restsOn: "answer",
    support: "supported",
    text: "one material claim settled by the answer's own bytes",
  },
  {
    evidence: "what the read showed",
    impact: "high",
    readAtIso: "the instant you ran it, ISO 8601",
    readCommand: "the exact verb, query or URL you ran, as you ran it",
    restsOn: "live",
    support: "supported",
    text: "one material claim that rests on live state",
  },
];

const SUPERSESSION_HEAD =
  "THIS ANSWER DECLARES A SUPERSESSION. Its form names `1757000000.000100` — an earlier answer of this bot's,";
const NARROWING_HEAD = "### This ask is on round 4 — what a claim at this depth may escalate is narrowed";

describe("packetVerdictSection", () => {
  it("renders a clean example with no images, no supersession and no voice violation when no rule was named", () => {
    const lines = section({ images: [], round: 1, supersedes: undefined, voiceRuleCount: 0 });
    expect(exampleOf({ lines })).toEqual({
      answerDigest: DIGEST,
      authorSession: "author-1",
      claims: EXAMPLE_CLAIMS,
      imageObservations: [],
      outcome: "clean",
      reviewerSession: "reviewer-1",
      schemaVersion: 1,
      voice: { pathsChecked: ["lead", "body", "grounding.read[0].label"], rulesChecked: 0, violations: [] },
    });
    expect(lines.some((line) => line.startsWith("THIS ANSWER DECLARES A SUPERSESSION"))).toBe(false);
    expect(lines.some((line) => line.startsWith("### This ask is on round"))).toBe(false);
    expect(lines.slice(-6)).toEqual([
      "```json",
      JSON.stringify(exampleOf({ lines }), null, 2),
      "```",
      "",
      "`authorSession` must read exactly `author-1` and `reviewerSession` exactly `reviewer-1`.",
      "",
    ]);
    expect(lines).toContain("Write EXACTLY this shape to `/tmp/verdict.json`, then stop — you post nothing to Slack:");
  });

  it("makes the example incomplete when an image is unavailable, observes only the ready one, and carries one voice violation when rules were named", () => {
    const images: readonly ReviewPacketImage[] = [
      { artifact: { digest: IMAGE_DIGEST, heightPx: 10, widthPx: 20 }, kind: "ready", path: "/img/a.png" },
      { issues: ["could not be read: ENOENT"], kind: "unavailable", path: "/img/b.png" },
    ];
    const lines = section({ images, round: 1, supersedes: undefined, voiceRuleCount: 3 });
    expect(exampleOf({ lines })).toEqual({
      answerDigest: DIGEST,
      authorSession: "author-1",
      claims: EXAMPLE_CLAIMS,
      imageObservations: [
        {
          artifactDigest: IMAGE_DIGEST,
          contextRetained: true,
          legible: true,
          observedContent: "REPLACE THIS with what you actually saw after opening the file",
          path: "/img/a.png",
          targetState: "data",
        },
      ],
      outcome: "incomplete",
      reviewerSession: "reviewer-1",
      schemaVersion: 1,
      voice: {
        pathsChecked: ["lead", "body", "grounding.read[0].label"],
        rulesChecked: 3,
        violations: [
          { path: "which rendered string broke it, or delete this entry", rule: "the rule, copied from section 9" },
        ],
      },
    });
  });

  it("carries a declared supersession in the example with the exact target ts, and renders its duty before the JSON", () => {
    const lines = section({ images: [], round: 1, supersedes: "1757000000.000100", voiceRuleCount: 0 });
    expect(exampleOf({ lines })).toEqual({
      answerDigest: DIGEST,
      authorSession: "author-1",
      claims: EXAMPLE_CLAIMS,
      imageObservations: [],
      outcome: "clean",
      reviewerSession: "reviewer-1",
      schemaVersion: 1,
      supersession: {
        reason: "why this answer REPLACES a central claim of that one — or, with `warranted` false, why it only adds",
        targetTs: "1757000000.000100",
        warranted: true,
      },
      voice: { pathsChecked: ["lead", "body", "grounding.read[0].label"], rulesChecked: 0, violations: [] },
    });
    const dutyAt = lines.indexOf(SUPERSESSION_HEAD);
    expect(dutyAt).toBeGreaterThan(0);
    expect(dutyAt).toBeLessThan(lines.indexOf("```json"));
    expect(lines).toContain(
      "`targetTs` exactly `1757000000.000100`, `warranted` true or false, and `reason` in your own words.",
    );
  });

  it("adds the narrowing rider on round 4 and omits it on round 3, the cap", () => {
    const atCap = section({ images: [], round: 3, supersedes: undefined, voiceRuleCount: 0 });
    const pastCap = section({ images: [], round: 4, supersedes: undefined, voiceRuleCount: 0 });
    expect(atCap.some((line) => line.startsWith("### This ask is on round"))).toBe(false);
    const riderAt = pastCap.indexOf(NARROWING_HEAD);
    expect(riderAt).toBeGreaterThan(0);
    expect(riderAt).toBeLessThan(pastCap.indexOf("```json"));
    expect(pastCap.length - atCap.length).toBe(23);
  });
});
