import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PR_VOICE_BRIEF_DOC,
  PR_VOICE_BRIEF_HEADER,
  prVoiceBriefLines,
} from "../../../../outbound/github/voiceBrief.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");

const ECHO_PREFIX = "The explainer a reviewer meets first on this body today: ";

describe("prVoiceBriefLines", () => {
  it("opens on the header that names the C3 shape and says what is advisory", () => {
    expect(prVoiceBriefLines({})[0]).toBe(PR_VOICE_BRIEF_HEADER);
    expect(PR_VOICE_BRIEF_HEADER).toContain("advisory past the attribution rule");
  });

  it("states the C3 shape first, then the explainer's word cap", () => {
    const lines = prVoiceBriefLines({});
    expect(lines[1]!.startsWith("SHAPE: three derived badges (risk, problem, proof)")).toBe(true);
    expect(lines.some((line) => line.startsWith("EXPLAINER, at most 70 words"))).toBe(true);
  });

  it("states the attribution rule, sends the composer to the voice rules, and points at the long form", () => {
    const lines = prVoiceBriefLines({});
    expect(lines.some((line) => line.startsWith("ATTRIBUTION"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Run `slopweaver slack voice-rules`"))).toBe(true);
    expect(lines.at(-1)).toBe(`Worked examples: ${PR_VOICE_BRIEF_DOC}`);
  });

  it("echoes the current explainer last when recutting", () => {
    const lines = prVoiceBriefLines({ currentExplainer: "Export dropped the last row." });
    expect(lines.at(-1)).toBe(`${ECHO_PREFIX}"Export dropped the last row."`);
    expect(lines.length).toBe(prVoiceBriefLines({}).length + 1);
  });

  it("prints no echo when drafting from an example", () => {
    expect(prVoiceBriefLines({}).filter((line) => line.startsWith(ECHO_PREFIX))).toStrictEqual([]);
  });

  it("points at a doc that exists", () => {
    expect(existsSync(join(REPO_ROOT, PR_VOICE_BRIEF_DOC))).toBe(true);
  });
});
