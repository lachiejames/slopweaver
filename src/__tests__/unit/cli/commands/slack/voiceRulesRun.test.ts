import { describe, expect, it } from "vitest";

import type { SlackVoiceRulesDeps } from "../../../../../cli/commands/slack/voiceRulesRun.js";
import { runSlackVoiceRules } from "../../../../../cli/commands/slack/voiceRulesRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { VoiceRuleBrief } from "../../../../../outbound/voice/briefStore.js";
import type { ExactVoiceRule } from "../../../../../outbound/voice/exactRules.js";
import { ARI_OFFERED } from "../../../outbound/voice/draftsOwnerCut7Oct.js";

/** Fake deps recording every home the loaders were asked for, and every line written. */
function harness({
  brief,
  exactRules = ok([]),
  recorded = ok("recorded"),
  stdin = "",
}: {
  brief: Result<VoiceRuleBrief>;
  exactRules?: Result<readonly ExactVoiceRule[]>;
  recorded?: Result<"recorded" | "no-session">;
  stdin?: string;
}): {
  deps: SlackVoiceRulesDeps;
  homesAsked: string[];
  lines: string[];
  recordings: { brief: VoiceRuleBrief; home: string }[];
} {
  const homesAsked: string[] = [];
  const lines: string[] = [];
  const recordings: { brief: VoiceRuleBrief; home: string }[] = [];
  return {
    recordings,
    deps: {
      recordBriefing: ({ brief: shown, home }) => {
        recordings.push({ brief: shown, home });
        return recorded;
      },
      loadBrief: ({ home }) => {
        homesAsked.push(home);
        return brief;
      },
      loadExactRules: ({ home }) => {
        homesAsked.push(home);
        return exactRules;
      },
      readStdin: async () => stdin,
      writeOut: (line) => {
        lines.push(line);
      },
    },
    homesAsked,
    lines,
  };
}

/** One loaded brief, defaulted so each test states only the field it is about. */
function briefOf({
  rules = [],
  paragraphSpacing = false,
  shape = null,
}: {
  rules?: readonly ExactVoiceRule[];
  paragraphSpacing?: boolean;
  shape?: string | null;
}): Result<VoiceRuleBrief> {
  return ok({ paragraphSpacing, rules, shape });
}

/** The labels the JSON document carries, so a machine consumer can tell a gate from advice. */
const ENFORCEMENT = { paragraphSpacing: "enforced", rules: "enforced", shape: "advisory" } as const;

describe("runSlackVoiceRules — the briefing receipt", () => {
  it("records the receipt for the exact brief it printed, under the --home it was given", async () => {
    const brief: VoiceRuleBrief = { paragraphSpacing: true, rules: [{ kind: "word", value: "delve" }], shape: "One." };
    const { deps, recordings } = harness({ brief: ok(brief) });

    const exit = await runSlackVoiceRules({ deps, rest: ["--home", "/state"] });

    expect(exit).toBe(EXIT_OK);
    expect(recordings).toEqual([{ brief, home: "/state" }]);
  });

  it("writes no receipt for --json, whose document is not the rendered brief the digest covers", async () => {
    const { deps, recordings } = harness({ brief: briefOf({ shape: "One." }) });

    const exit = await runSlackVoiceRules({ deps, rest: ["--home", "/state", "--json"] });

    expect(exit).toBe(EXIT_OK);
    expect(recordings).toEqual([]);
  });

  it("writes no receipt for --check-stdin, which prints no brief", async () => {
    const { deps, recordings } = harness({ brief: briefOf({}), stdin: "plain" });

    await runSlackVoiceRules({ deps, rest: ["--home", "/state", "--check-stdin"] });

    expect(recordings).toEqual([]);
  });

  it("exits with an error when the receipt cannot be written", async () => {
    const { deps } = harness({ brief: briefOf({ shape: "One." }), recorded: err(["disk full"]) });

    const exit = await runSlackVoiceRules({ deps, rest: ["--home", "/state"] });

    expect(exit).toBe(EXIT_ERROR);
  });
});

describe("runSlackVoiceRules", () => {
  it("prints the brief lines for the loaded rules and exits OK", async () => {
    const rules: readonly ExactVoiceRule[] = [{ kind: "literal", value: "—" }];
    const { deps, lines } = harness({ brief: briefOf({ rules }) });

    const exit = await runSlackVoiceRules({ deps, rest: ["--home", "/state"] });

    expect(exit).toBe(EXIT_OK);
    expect(lines).toContain('  - literal (case-sensitive): "—"');
  });

  it("asks the loader for the --home it was given", async () => {
    const { deps, homesAsked } = harness({ brief: briefOf({}) });

    await runSlackVoiceRules({ deps, rest: ["--home", "/custom/home"] });

    expect(homesAsked).toEqual(["/custom/home"]);
  });

  it("prints the loaded response shape above the enforced rules", async () => {
    const rules: readonly ExactVoiceRule[] = [{ kind: "word", value: "delve" }];
    const { deps, lines } = harness({ brief: briefOf({ rules, shape: "Keep it to one line.\n\nLead with what." }) });

    const exit = await runSlackVoiceRules({ deps, rest: ["--home", "/state"] });

    expect(exit).toBe(EXIT_OK);
    expect(lines.indexOf("Keep it to one line.")).toBeLessThan(
      lines.findIndex((line) => line.startsWith("VOICE RULES (ENFORCED)")),
    );
    expect(lines).toContain("Lead with what.");
  });

  it("says plainly that no shape is configured rather than printing an empty block", async () => {
    const { deps, lines } = harness({ brief: briefOf({ rules: [{ kind: "word", value: "delve" }] }) });

    await runSlackVoiceRules({ deps, rest: ["--home", "/state"] });

    expect(lines[0]).toBe(
      "RESPONSE SHAPE — none configured for this installation (`slackMe.voice.shapeMemoryFile` is unset), so" +
        " the rules below are the whole of what is configured. They are a vocabulary, not a shape.",
    );
  });

  it("emits a single JSON document carrying shape, rules and spacing under --json", async () => {
    const rules: readonly ExactVoiceRule[] = [{ kind: "word", value: "delve" }];
    const { deps, lines } = harness({ brief: briefOf({ rules, shape: "One line." }) });

    const exit = await runSlackVoiceRules({ deps, rest: ["--home", "/state", "--json"] });

    expect(exit).toBe(EXIT_OK);
    expect(lines).toEqual([
      JSON.stringify({ enforcement: ENFORCEMENT, paragraphSpacing: false, rules, shape: "One line." }, null, 2),
    ]);
  });

  it("carries the configured spacing rule into both the brief and the JSON document", async () => {
    const { deps: briefDeps, lines: briefLines } = harness({ brief: briefOf({ paragraphSpacing: true }) });
    const { deps: jsonDeps, lines: jsonLines } = harness({ brief: briefOf({ paragraphSpacing: true }) });

    await runSlackVoiceRules({ deps: briefDeps, rest: ["--home", "/state"] });
    await runSlackVoiceRules({ deps: jsonDeps, rest: ["--home", "/state", "--json"] });

    expect(briefLines).toContain(
      "PARAGRAPH SPACING (ENFORCED) — a SINGLE `--as me` message (a `one-card` post, a `one-list` roster, or any",
    );
    expect(jsonLines).toEqual([
      JSON.stringify({ enforcement: ENFORCEMENT, paragraphSpacing: true, rules: [], shape: null }, null, 2),
    ]);
  });

  it("exits ERROR and writes NOTHING to stdout when the configured state cannot be read", async () => {
    const { deps, lines } = harness({ brief: err(["/state/profile.json: invalid JSON"]) });

    const exit = await runSlackVoiceRules({ deps, rest: ["--home", "/state"] });

    expect(exit).toBe(EXIT_ERROR);
    expect(lines).toEqual([]);
  });

  it("labels each JSON value as enforced or advisory, so a machine cannot mistake advice for a gate", async () => {
    // Codex's fifth round: the three values alone do not say which the send door refuses on.
    const { deps, lines } = harness({ brief: briefOf({ shape: "One line." }) });

    await runSlackVoiceRules({ deps, rest: ["--home", "/state", "--json"] });

    const parsed: unknown = JSON.parse(lines[0]!);
    expect((parsed as { enforcement: unknown }).enforcement).toEqual({
      paragraphSpacing: "enforced",
      rules: "enforced",
      shape: "advisory",
    });
  });

  it("refuses an unknown flag before loading anything", async () => {
    const { deps, homesAsked } = harness({ brief: briefOf({}) });

    const exit = await runSlackVoiceRules({ deps, rest: ["--as", "me"] });

    expect(exit).toBe(EXIT_USAGE);
    expect(homesAsked).toEqual([]);
  });
});

describe("runSlackVoiceRules --check-stdin", () => {
  const EM_DASH: ExactVoiceRule = { kind: "literal", value: "—" };

  // An offered message carried an em dash the owner had to cut by hand.
  it("prints a refusal naming the rule, and never the message it judged", async () => {
    const message = "could we use plain text — i can't read the regex";
    const { deps, homesAsked, lines } = harness({ brief: err(["unread"]), exactRules: ok([EM_DASH]), stdin: message });

    const exit = await runSlackVoiceRules({ deps, rest: ["--home", "/state", "--check-stdin", "--json"] });

    expect(exit).toBe(EXIT_OK);
    expect(homesAsked).toEqual(["/state"]);
    expect(lines).toEqual([
      JSON.stringify({
        kind: "refused",
        reasons: [
          'text matches the configured literal voice rule "—". Rewrite the message in the configured voice and call offer_copy again.',
        ],
      }),
    ]);
    expect(message).toContain("plain text");
    expect(lines.join("\n")).not.toContain("plain text");
  });

  it("accepts a message that keeps every rule", async () => {
    const { deps, lines } = harness({ brief: err(["unread"]), exactRules: ok([EM_DASH]), stdin: "plain text, please" });

    const exit = await runSlackVoiceRules({ deps, rest: ["--home", "/state", "--check-stdin"] });

    expect(exit).toBe(EXIT_OK);
    expect(lines).toEqual([JSON.stringify({ kind: "accepted" })]);
  });

  // A message that was right as drafted was then padded with extra sentences past its ask.
  it("holds a Slack message as the owner to the shape under --slack-draft, and only the exact rules without it", async () => {
    const { deps: slackDeps, lines: slackLines } = harness({
      brief: err(["unread"]),
      exactRules: ok([EM_DASH]),
      stdin: ARI_OFFERED,
    });
    const { deps: otherDeps, lines: otherLines } = harness({
      brief: err(["unread"]),
      exactRules: ok([EM_DASH]),
      stdin: ARI_OFFERED,
    });

    const slackExit = await runSlackVoiceRules({
      deps: slackDeps,
      rest: ["--home", "/state", "--check-stdin", "--slack-draft", "--json"],
    });
    await runSlackVoiceRules({ deps: otherDeps, rest: ["--home", "/state", "--check-stdin", "--json"] });

    expect(slackExit).toBe(EXIT_OK);
    expect(slackLines).toEqual([
      JSON.stringify({
        kind: "refused",
        reasons: [
          "shape trailing: paragraph 1 runs 1 sentence past its ask: end that paragraph on the ask and cut what " +
            "follows it there, since the reader stops reading at the ask; context a reader needs goes in its own paragraph. " +
            "Cut it to that shape and call offer_copy again.",
        ],
      }),
    ]);
    expect(otherLines).toEqual([JSON.stringify({ kind: "accepted" })]);
  });

  // A dense message needs more vertical white space.
  it("refuses one dense paragraph under --slack-draft, and lands it without", async () => {
    const dense = Array.from({ length: 71 }, () => "word").join(" ");
    const { deps: slackDeps, lines: slackLines } = harness({
      brief: err(["unread"]),
      exactRules: ok([]),
      stdin: dense,
    });
    const { deps: otherDeps, lines: otherLines } = harness({
      brief: err(["unread"]),
      exactRules: ok([]),
      stdin: dense,
    });

    await runSlackVoiceRules({ deps: slackDeps, rest: ["--home", "/state", "--check-stdin", "--slack-draft"] });
    await runSlackVoiceRules({ deps: otherDeps, rest: ["--home", "/state", "--check-stdin"] });

    expect(slackLines).toEqual([
      JSON.stringify({
        kind: "refused",
        reasons: [
          "shape paragraph-words: paragraph 1 has 71 words, past 70: break it into short paragraphs, one idea each, " +
            "a blank line between them. Cut it to that shape and call offer_copy again.",
        ],
      }),
    ]);
    expect(otherLines).toEqual([JSON.stringify({ kind: "accepted" })]);
  });

  it("exits ERROR and prints no verdict when the rules cannot be read, so no caller reads it as no rules", async () => {
    const { deps, lines } = harness({
      brief: briefOf({}),
      exactRules: err(["/state/profile.json: invalid JSON"]),
      stdin: "a — b",
    });

    const exit = await runSlackVoiceRules({ deps, rest: ["--home", "/state", "--check-stdin", "--json"] });

    expect(exit).toBe(EXIT_ERROR);
    expect(lines).toEqual([]);
  });
});
