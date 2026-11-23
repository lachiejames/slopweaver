/**
 * Every as-me FORM shape is named where a composing session reads, or the composer reaches for an override.
 *
 * More schema shapes for the different Slack postings make a repeat mistake impossible rather than
 * something to catch after the fact or follow a massive skill file. The shape half of that is done: the
 * `one-list` form exists and the `--form` door dispatches it. The half this guards is that a surface a
 * composer reads names the form, because otherwise an approved ten-PR review ask goes out under
 * `SLOPWEAVER_ALLOW_VOICE_RULES=1` by a session that knew only the card form and the raw body. **A form no surface names is, operationally, a form that does not exist.**
 *
 * So this is a gate rather than a convention, and it is structural in the one way that matters: `SURFACES`
 * below is keyed by `AsMeArtifact["kind"]`, so a SIXTH form added to that union fails to COMPILE here until
 * somebody says where a composer will be told about it. Editing five files once would not have held.
 *
 * What it deliberately does not check: the prose. A surface may describe a form however it likes; what it
 * may not do is stay silent about one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { slackManifest } from "../../../cli/manifests/slack.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import { voiceRuleBriefLines } from "../../../outbound/voice/composerBrief.js";

/**
 * The token each form must be findable by, per kind.
 *
 * `plain` is the `--body` escape hatch rather than a `--form` kind a caller ever types, so the token that
 * proves a surface names it is the flag itself — which is what a composer would actually search for.
 */
const TOKEN: Readonly<Record<AsMeArtifact["kind"], string>> = {
  drip: "drip",
  "one-card": "one-card",
  "one-list": "one-list",
  plain: "--body",
};

/**
 * Whether the paragraph-spacing gate judges this form, which decides what the composer brief has to name.
 *
 * A MULTI-message drip is out of scope by construction — the gap between its messages IS its spacing — so
 * the brief naming it would be wrong rather than thorough. Exhaustive over the union for the same reason
 * {@link TOKEN} is: a sixth form has to answer this question before it compiles.
 */
const SPACING_SUBJECT: Readonly<Record<AsMeArtifact["kind"], boolean>> = {
  drip: false,
  "one-card": true,
  "one-list": true,
  plain: true,
};

/** The surfaces a session composing an as-me message reads, in the order it reads them. */
const SURFACES: readonly string[] = ["skills/slack/SKILL.md", "skills/slack/reference/as-me-lane.md"];

/** One canon file's whole text, addressed from this test file rather than from a cwd. */
function canonText({ path }: { path: string }): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), "utf8");
}

describe("every as-me form kind is named where a composer reads", () => {
  it("has a token for every kind, so the registry cannot be vacuously satisfied", () => {
    expect(Object.keys(TOKEN).length).toBeGreaterThan(0);
    expect(Object.values(TOKEN).filter((token) => token.length === 0)).toEqual([]);
  });

  it.each(SURFACES)("%s names every one of them", (path) => {
    const text = canonText({ path });

    expect(Object.entries(TOKEN).filter(([, token]) => !text.includes(token))).toEqual([]);
  });

  it("slack post --help names every one of them, because --help is read before any doc", () => {
    const usage = slackManifest["post"]!.meta.usage;

    expect(Object.entries(TOKEN).filter(([, token]) => !usage.includes(token))).toEqual([]);
  });

  it("the voice-rules brief names every form the SPACING gate can refuse, since that is what it briefs", () => {
    const brief = voiceRuleBriefLines({ paragraphSpacing: true, rules: [], shape: null }).join("\n");
    const judged = Object.entries(TOKEN).filter(([kind]) => SPACING_SUBJECT[kind as AsMeArtifact["kind"]]);

    expect(judged.length).toBeGreaterThan(0);
    expect(judged.filter(([, token]) => !brief.includes(token))).toEqual([]);
  });

  it("that brief check is real: those names ride the spacing block, which is off until configured", () => {
    const unconfigured = voiceRuleBriefLines({ paragraphSpacing: false, rules: [], shape: null }).join("\n");

    expect(unconfigured).not.toContain(TOKEN["one-list"]);
    expect(unconfigured).not.toContain(TOKEN["one-card"]);
  });
});
