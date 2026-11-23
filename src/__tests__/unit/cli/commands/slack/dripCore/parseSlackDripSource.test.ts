/*
 * `parseSlackDripSource` and `assessSlackDripSource`: a form validated against the operator's bounds, a raw body
 * kept unmodified, and the exact voice rules reported as advisory rather than refused — scoped to the ME lane,
 * matched at lexical boundaries, and blind to quoted material, code and URLs.
 */
import { describe, expect, it } from "vitest";

import {
  assessSlackDripSource,
  parseSlackDripSource,
} from "../../../../../../cli/commands/slack/dripSourceAssessment.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { slackDeliveryErrorLines } from "../../../../../../outbound/slack/deliveryErrors.js";
import { dripArtifact } from "./harness.js";

const CONFIG = {
  cardVisibleMax: 1000,
  exactVoiceRules: [],
  maxBullets: 10,
  maxLines: 8,
  maxMessages: 8,
  messageVisibleMax: 300,
};

describe("parseSlackDripSource", () => {
  it("validates a form against the operator's bounds", () => {
    const artifact = unwrap(
      parseSlackDripSource({
        allowVoiceRules: false,
        config: CONFIG,
        source: { json: JSON.stringify(dripArtifact({ texts: ["one", "two"] })), kind: "form" },
      }),
    );

    expect(artifact.kind).toBe("drip");
  });

  it("reports malformed JSON as a usage error rather than throwing", () => {
    const errors = slackDeliveryErrorLines({
      error: unwrapErr(
        parseSlackDripSource({ allowVoiceRules: false, config: CONFIG, source: { json: "{oops", kind: "form" } }),
      ),
    });

    expect(errors[0]).toContain("--form is not valid JSON");
  });

  it("turns a raw body into the plain artifact, unmodified", () => {
    const artifact = unwrap(
      parseSlackDripSource({
        allowVoiceRules: false,
        config: CONFIG,
        source: { kind: "body", text: "exactly — this\nand this" },
      }),
    );

    expect(artifact).toEqual({ kind: "plain", text: "exactly — this\nand this" });
  });

  it("does not apply the drip's per-message cap to a plain body", () => {
    const artifact = unwrap(
      parseSlackDripSource({
        allowVoiceRules: false,
        config: {
          cardVisibleMax: 1000,
          exactVoiceRules: [],
          maxBullets: 10,
          maxLines: 8,
          maxMessages: 1,
          messageVisibleMax: 10,
        },
        source: { kind: "body", text: "x".repeat(500) },
      }),
    );

    expect(artifact.kind).toBe("plain");
  });

  it("PARSES prose that breaks an exact literal, reporting it as advisory rather than refusing", () => {
    // The send decision moved to the admit door, where a voice finding is a `warn` carrying an override
    // token (the rule: no hard blocks for voice). So the parse must SUCCEED and the
    // violation must still be named — a parse that refused here would keep the decision out of the ledger.
    const assessed = assessSlackDripSource({
      allowVoiceRules: false,
      config: { ...CONFIG, exactVoiceRules: [{ kind: "literal", value: "§" }] },
      source: { kind: "body", text: "Setup passed § one blocker remains." },
    });

    expect(unwrap(assessed.parsed)).toEqual({ kind: "plain", text: "Setup passed § one blocker remains." });
    expect(assessed.voiceRuleFindings).toEqual([{ path: "body", rule: { kind: "literal", value: "§" } }]);
    expect(assessed.advisory).toEqual([
      'body matches the configured literal voice rule "§". Rewrite the authored prose, or for one deliberate exception run slopweaver hatch open voice-rules --reason "<why this one is a legitimate exception>", then re-run; the grant sends the original content unchanged.',
    ]);
  });

  it("says nothing advisory under the named override, while the finding still reaches the ledger", () => {
    const assessed = assessSlackDripSource({
      allowVoiceRules: true,
      config: { ...CONFIG, exactVoiceRules: [{ kind: "literal", value: "§" }] },
      source: { kind: "body", text: "Setup passed § one blocker remains." },
    });

    expect(assessed.advisory).toEqual([]);
    expect(assessed.voiceRuleFindings).toEqual([{ path: "body", rule: { kind: "literal", value: "§" } }]);
  });

  it("applies only the rules scoped to the ME lane, because every caller here is an as-me send", () => {
    const assessed = assessSlackDripSource({
      allowVoiceRules: false,
      config: {
        ...CONFIG,
        exactVoiceRules: [
          { actors: ["bot"], kind: "literal", value: "§" },
          { actors: ["me"], kind: "literal", value: "¶" },
        ],
      },
      source: { kind: "body", text: "Setup passed § and ¶ remain." },
    });

    expect(assessed.voiceRuleFindings).toEqual([
      { path: "body", rule: { actors: ["me"], kind: "literal", value: "¶" } },
    ]);
  });

  it("matches words case-insensitively at lexical boundaries and phrases exactly", () => {
    const assessed = assessSlackDripSource({
      allowVoiceRules: false,
      config: {
        ...CONFIG,
        exactVoiceRules: [
          { kind: "word", value: "blockedword" },
          { kind: "phrase", value: "blocked phrase" },
        ],
      },
      source: { kind: "body", text: "BLOCKEDWORD, then a Blocked Phrase." },
    });

    expect(assessed.advisory).toEqual([
      'body matches the configured word voice rule "blockedword". Rewrite the authored prose, or for one deliberate exception run slopweaver hatch open voice-rules --reason "<why this one is a legitimate exception>", then re-run; the grant sends the original content unchanged.',
      'body matches the configured phrase voice rule "blocked phrase". Rewrite the authored prose, or for one deliberate exception run slopweaver hatch open voice-rules --reason "<why this one is a legitimate exception>", then re-run; the grant sends the original content unchanged.',
    ]);
    expect(
      unwrap(
        parseSlackDripSource({
          allowVoiceRules: false,
          config: { ...CONFIG, exactVoiceRules: [{ kind: "word", value: "ban" }] },
          source: { kind: "body", text: "The urban path is stable." },
        }),
      ),
    ).toEqual({ kind: "plain", text: "The urban path is stable." });
    expect(
      unwrap(
        parseSlackDripSource({
          allowVoiceRules: false,
          config: { ...CONFIG, exactVoiceRules: [{ kind: "phrase", value: "blocked phrase" }] },
          source: { kind: "body", text: "The unblocked phrasebook is stable." },
        }),
      ),
    ).toEqual({ kind: "plain", text: "The unblocked phrasebook is stable." });
  });

  it("skips quoted material, code, URLs and dash-bearing technical identifiers", () => {
    const text = [
      "> Setup passed § one blocker remains.",
      "`event§code_v2`",
      "https://example.com/a§b",
      "event§code_v2 is stable.",
      "```",
      "Setup passed § one blocker remains.",
      "```",
    ].join("\n");

    const artifact = unwrap(
      parseSlackDripSource({
        allowVoiceRules: false,
        config: { ...CONFIG, exactVoiceRules: [{ kind: "literal", value: "§" }] },
        source: { kind: "body", text },
      }),
    );

    expect(artifact).toEqual({ kind: "plain", text });
  });

  // A link's LABEL is authored prose and its URL is not — the split that was missing when a
  // harvest found `the bot — live board` in the owner's own history. A code run stays exempt.
  it("skips typed code and a link's URL, while reporting its LABEL and authored text runs", () => {
    const artifact = JSON.stringify({
      kind: "drip",
      messages: [
        {
          runs: [
            { code: true, text: "event§code_v2", type: "text" },
            { label: "Setup § details", type: "link", url: "https://example.com/a§b" },
            { text: "Setup passed § one blocker remains.", type: "text" },
          ],
        },
      ],
    });

    const assessed = assessSlackDripSource({
      allowVoiceRules: false,
      config: { ...CONFIG, exactVoiceRules: [{ kind: "literal", value: "§" }] },
      source: { json: artifact, kind: "form" },
    });

    expect(assessed.advisory).toEqual([
      'messages[0].runs[1].label matches the configured literal voice rule "§". Rewrite the authored prose, or for one deliberate exception run slopweaver hatch open voice-rules --reason "<why this one is a legitimate exception>", then re-run; the grant sends the original content unchanged.',
      'messages[0].runs[2] matches the configured literal voice rule "§". Rewrite the authored prose, or for one deliberate exception run slopweaver hatch open voice-rules --reason "<why this one is a legitimate exception>", then re-run; the grant sends the original content unchanged.',
    ]);
    expect(assessed.parsed.isOk()).toBe(true);
  });

  it("returns the original artifact unchanged when the named override is active", () => {
    const text = "Setup passed § one blocker remains.";
    const artifact = unwrap(
      parseSlackDripSource({
        allowVoiceRules: true,
        config: { ...CONFIG, exactVoiceRules: [{ kind: "literal", value: "§" }] },
        source: { kind: "body", text },
      }),
    );

    expect(artifact).toEqual({ kind: "plain", text });
  });
});
