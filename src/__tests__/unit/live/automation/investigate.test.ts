/**
 * `planInvestigate` and its two argvs — the clock joining the ask lane.
 *
 * Everything under test is pure: the plan validates the message it would send with the SAME schema the door
 * applies, and the two argvs are the exact words the tick hands `slack post` and `turn brief`. The one
 * property that is not a shape is asserted here too — the opening message carries no mention run, so a
 * running listener cannot capture the same slot a second time.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import {
  INVESTIGATE_KIND,
  investigateBriefArgv,
  investigateFormArtifact,
  investigateOpenRest,
  investigateOpenTs,
  planInvestigate,
  unaskableInvestigateRows,
} from "../../../../live/automation/investigate.js";
import { InvestigateErrors } from "../../../../live/automation/investigateErrors.js";
import { stateHomePaths } from "../../../../stateHome.js";

/**
 * The install's configured private prompt conversation, which every passing case must ask in.
 *
 * A `D`-prefixed id rather than a `C` one because the surface the ask lane is briefed with is DERIVED from
 * it, so a placeholder shaped like a channel would silently test the wrong branch of that derivation.
 */
const PROMPT_CHANNEL = "D0PROMPT";

/** An `investigate` row; every case that varies one field spreads this and replaces `params`. */
function row(): RecipeDefinition {
  return {
    cadence: "0 9 * * *",
    destination: { kind: "slack" },
    effect: "read",
    enabled: true,
    kind: INVESTIGATE_KIND,
    onMissed: "skip",
    params: { askedBy: "U0OWNER", channel: PROMPT_CHANNEL, question: "what regressed in staging overnight?" },
    recipeId: "overnight-staging",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  };
}

describe("planInvestigate", () => {
  it("resolves who is asking, where, and what", () => {
    const plan = unwrap(planInvestigate({ definition: row(), promptChannel: PROMPT_CHANNEL, voiceOverridden: false }));
    expect(plan.recipeId).toBe("overnight-staging");
    expect(plan.channel).toBe(PROMPT_CHANNEL);
    expect(plan.askedBy).toBe("U0OWNER");
    expect(plan.question).toBe("what regressed in staging overnight?");
  });

  it("carries the opening message as the exact form document the door will parse", () => {
    const plan = unwrap(planInvestigate({ definition: row(), promptChannel: PROMPT_CHANNEL, voiceOverridden: false }));
    expect(plan.form).toBe(
      JSON.stringify({
        kind: "automation-prompt",
        prompt: "what regressed in staging overnight?",
        recipeId: "overnight-staging",
      }),
    );
  });

  it("briefs a DM-hosted ask as a DM, because two admission gates branch on that surface", () => {
    const plan = unwrap(planInvestigate({ definition: row(), promptChannel: PROMPT_CHANNEL, voiceOverridden: false }));
    expect(plan.surface).toBe("dm");
  });

  it("refuses params that are not an investigate configuration", () => {
    const error = unwrapErr(
      planInvestigate({
        definition: { ...row(), params: { brief: "have a look" } },
        promptChannel: PROMPT_CHANNEL,
        voiceOverridden: false,
      }),
    );
    expect(error.code).toBe("PARAMS_INVALID");
    expect(error.message).toContain("is not a runnable investigate row");
  });

  it("refuses a row naming no channel to ask in", () => {
    const error = unwrapErr(
      planInvestigate({
        definition: { ...row(), params: { askedBy: "U0OWNER", question: "why?" } },
        promptChannel: PROMPT_CHANNEL,
        voiceOverridden: false,
      }),
    );
    expect(error.code).toBe("PARAMS_INVALID");
    expect(error.message).toContain("channel");
  });

  it("refuses a row naming nobody the ask belongs to, because the whitelist is judged on that id", () => {
    const error = unwrapErr(
      planInvestigate({
        definition: { ...row(), params: { channel: PROMPT_CHANNEL, question: "why?" } },
        promptChannel: PROMPT_CHANNEL,
        voiceOverridden: false,
      }),
    );
    expect(error.code).toBe("PARAMS_INVALID");
    expect(error.message).toContain("askedBy");
  });

  it("refuses a blank question rather than posting an empty message", () => {
    const error = unwrapErr(
      planInvestigate({
        definition: { ...row(), params: { askedBy: "U0OWNER", channel: PROMPT_CHANNEL, question: "" } },
        promptChannel: PROMPT_CHANNEL,
        voiceOverridden: false,
      }),
    );
    expect(error.code).toBe("PARAMS_INVALID");
    expect(error.message).toContain("question");
  });

  it("refuses a question too wide to render entirely above the fold", () => {
    const question = "why did the staging pool exhaust overnight, and what changed? ".repeat(40);
    const error = unwrapErr(
      planInvestigate({
        definition: { ...row(), params: { askedBy: "U0OWNER", channel: PROMPT_CHANNEL, question } },
        promptChannel: PROMPT_CHANNEL,
        voiceOverridden: false,
      }),
    );
    expect(error.code).toBe("FORM_REFUSED");
    expect(error.message).toContain("asked in full or not at all");
  });

  /**
   * The door's prompt cap binds BEFORE the 650-char message it derives. A plan that checked only the derived
   * message admitted a 542-char question the door then refused at every firing
   * (`datadog-regression-hunt-daily`). Each sentence is short so no packing rule fires first.
   */
  it("refuses a question one character past the door's 500-char prompt cap, naming the row's file", () => {
    const question = "Say what changed. ".repeat(28).slice(0, 501);
    expect(question.length).toBe(501);
    const error = unwrapErr(
      planInvestigate({
        definition: { ...row(), params: { askedBy: "U0OWNER", channel: PROMPT_CHANNEL, question } },
        promptChannel: PROMPT_CHANNEL,
        voiceOverridden: false,
      }),
    );
    expect(error.code).toBe("FORM_REFUSED");
    expect(error.message).toContain("automation prompt: prompt: Too big: expected string to have <=500 characters —");
    expect(error.message).toContain("shorten `params.question` in live/recipe/definitions/overnight-staging.json");
  });

  it("admits a question exactly at the door's 500-char prompt cap", () => {
    const question = "Say what changed. ".repeat(28).slice(0, 500);
    expect(question.length).toBe(500);
    const plan = unwrap(
      planInvestigate({
        definition: { ...row(), params: { askedBy: "U0OWNER", channel: PROMPT_CHANNEL, question } },
        promptChannel: PROMPT_CHANNEL,
        voiceOverridden: false,
      }),
    );
    expect(plan.question).toBe(question);
  });
});

/**
 * The packing half of the door, run over the SAME cells the door builds.
 *
 * Every question here is written for this test rather than copied from a live row: the wording that stranded
 * a live row for two days is state in `$SLOPWEAVER_HOME`, and pinning it here would put a copy of
 * that state in the repository and rot the first time the row is edited. What is pinned is the SHAPE — a
 * sentence past the cap, and a colon introducing a list — which is what the door decides on.
 */
describe("planInvestigate and the above-the-fold packing rules", () => {
  /** The plan for a row asking exactly the text under test, with the hatch shut unless a case opens it. */
  function planFor({
    question,
    recipeId = "overnight-staging",
    voiceOverridden = false,
  }: {
    question: string;
    recipeId?: string;
    voiceOverridden?: boolean;
  }) {
    return planInvestigate({
      definition: { ...row(), params: { askedBy: "U0OWNER", channel: PROMPT_CHANNEL, question }, recipeId },
      promptChannel: PROMPT_CHANNEL,
      voiceOverridden,
    });
  }

  /** A question carrying one sentence past the 30-word authored-prose cap and nothing else. */
  const OVER_LONG =
    "the staging connection pool exhausted again overnight and nobody has yet said whether the cause was " +
    "the new reporting job or the migration that landed just before it, so please go and find out which.";

  /** A question carrying a colon-introduced list and nothing else. */
  const COLON_LIST = "post one card: the ranked list, the table with owners, and a tag for nobody else.";

  it("refuses a question whose sentence runs past the authored-prose cap", () => {
    const error = unwrapErr(planFor({ question: OVER_LONG }));
    expect(error.code).toBe("VOICE_REFUSED");
    expect(error.message).toContain("lead: one sentence is 35 authored-prose words (max 30)");
  });

  it("refuses a question that packs several facts behind a colon", () => {
    const error = unwrapErr(planFor({ question: COLON_LIST }));
    expect(error.code).toBe("VOICE_REFUSED");
    expect(error.message).toContain("lead: a colon introducing a list");
  });

  it("names every packing violation at once, so one rewrite can clear the row", () => {
    const question =
      "read vanta live and rank what closes the most controls per hour of somebody's time, then say which " +
      "three acts you would take first and who would have to take each of them. post one card: the ranked " +
      "list, the table, and a tag for nobody else.";
    const error = unwrapErr(planFor({ question }));
    expect(error.code).toBe("VOICE_REFUSED");
    expect(error.message).toContain("authored-prose words");
    expect(error.message).toContain("a colon introducing a list");
  });

  it("names the file to edit, the field in it and the override, so a cold reader can act", () => {
    const error = unwrapErr(planFor({ question: COLON_LIST }));
    expect(error.message).toContain("recipe 'overnight-staging' asks a question the above-the-fold gate refuses");
    expect(error.message).toContain(
      "rewrite `params.question` in live/recipe/definitions/overnight-staging.json under your state home",
    );
    expect(error.message).toContain(
      'slopweaver hatch open voice-rules --reason "<why this one is a legitimate exception>", then re-run',
    );
  });

  it("names the refused row's OWN file, not the one whose question happens to be under test", () => {
    const error = unwrapErr(planFor({ question: COLON_LIST, recipeId: "synthetic-reminder" }));
    expect(error.message).toContain("live/recipe/definitions/synthetic-reminder.json");
  });

  /**
   * The path in the refusal is a STRING built in a pure module, so nothing in the compiler stops it drifting
   * from the store it claims to name. This is the witness: it reads the real `stateHomePaths` and asserts the
   * refusal quotes a real suffix of the real directory. A refusal carrying a path that has drifted is worse
   * than one carrying none, because a reader would edit a file nothing reads.
   */
  it("quotes a path the real state home actually resolves, so the refusal cannot drift from the store", () => {
    const definitionsDir = stateHomePaths({ home: "/state-home" }).live.recipe.definitionsDir;
    expect(definitionsDir).toBe("/state-home/live/recipe/definitions");
    const error = unwrapErr(planFor({ question: COLON_LIST, recipeId: "synthetic-reminder" }));
    expect(error.message).toContain(`${definitionsDir.slice("/state-home/".length)}/synthetic-reminder.json`);
  });

  it("checks the trailing run too, because the door checks every cell of a no-fold message", () => {
    const error = unwrapErr(
      planFor({ question: "what regressed overnight?", recipeId: "nightly: pools, queues and caches" }),
    );
    expect(error.code).toBe("VOICE_REFUSED");
    expect(error.message).toContain("trailing[0]: a colon introducing a list");
  });

  it("asks the refused question unchanged when the caller found the voice hatch open", () => {
    const plan = unwrap(planFor({ question: COLON_LIST, voiceOverridden: true }));
    expect(plan.question).toBe(COLON_LIST);
    expect(plan.form).toContain(COLON_LIST);
  });

  it("lifts the over-long sentence under the same hatch, so the whole family is one override", () => {
    const plan = unwrap(planFor({ question: OVER_LONG, voiceOverridden: true }));
    expect(plan.question).toBe(OVER_LONG);
  });

  it("still refuses a width violation under the hatch, because that is not a voice rule", () => {
    const question = "why did the staging pool exhaust overnight, and what changed? ".repeat(40);
    const error = unwrapErr(planFor({ question, voiceOverridden: true }));
    expect(error.code).toBe("FORM_REFUSED");
    expect(error.message).toContain("asked in full or not at all");
  });

  it("admits a question written as plain short sentences, byte for byte", () => {
    const question =
      "Post the daily summary card in this channel. Rank what closes the most open items per hour of somebody's " +
      "time. Put the owners and the Linear tickets in the table. Tag only ada.";
    const plan = unwrap(planFor({ question }));
    expect(plan.question).toBe(question);
    expect(plan.form).toContain(question);
  });
});

/**
 * The check `automation due` runs over every registered row, because the rows are state no test can read.
 *
 * Each case varies ONE field of {@link row}, and the two refusing cases carry the exact defect a live row had:
 * the 769-char question, then its first rewrite, which fit the cap and packed a colon list.
 */
describe("unaskableInvestigateRows", () => {
  const OVER_CAP = "Say what changed. ".repeat(28).slice(0, 501);

  it("reports an enabled row one character past the prompt cap, naming the row and the cap", () => {
    const errors = unaskableInvestigateRows({
      definitions: [{ ...row(), params: { ...row().params, question: OVER_CAP } }],
    });
    expect(errors.map((error) => error.code)).toEqual(["FORM_REFUSED"]);
    expect(errors[0]!.recipeId).toBe("overnight-staging");
    expect(errors[0]!.message).toContain("prompt: Too big: expected string to have <=500 characters");
  });

  it("reports a row under the cap whose question packs a list behind a colon", () => {
    const question = "post one card: the ranked list, the table with owners, and a tag for nobody else.";
    const errors = unaskableInvestigateRows({ definitions: [{ ...row(), params: { ...row().params, question } }] });
    expect(errors.map((error) => error.code)).toEqual(["VOICE_REFUSED"]);
  });

  it("reports a row whose params are not an investigate configuration", () => {
    const errors = unaskableInvestigateRows({ definitions: [{ ...row(), params: { brief: "have a look" } }] });
    expect(errors.map((error) => error.code)).toEqual(["PARAMS_INVALID"]);
  });

  it("admits a question exactly at the cap, since the firing admits it too", () => {
    const question = "Say what changed. ".repeat(28).slice(0, 500);
    const definition = { ...row(), params: { ...row().params, question } };
    expect(unaskableInvestigateRows({ definitions: [definition] })).toEqual([]);
    expect(planInvestigate({ definition, promptChannel: PROMPT_CHANNEL, voiceOverridden: false }).isOk()).toBe(true);
  });

  it("reports exactly the refusal the factory builds, naming the row's own file", () => {
    const params = { channel: PROMPT_CHANNEL, question: "what regressed in staging overnight?" };
    expect(unaskableInvestigateRows({ definitions: [{ ...row(), params }] })).toEqual([
      InvestigateErrors.paramsInvalid({
        issues: ["askedBy: Invalid input: expected string, received undefined"],
        recipeId: "overnight-staging",
      }),
    ]);
  });

  it("skips a disabled row, which has no firing to lose", () => {
    const definition = { ...row(), enabled: false, params: { ...row().params, question: OVER_CAP } };
    expect(unaskableInvestigateRows({ definitions: [definition] })).toEqual([]);
  });

  it("skips a row of another kind, whose params are not a question at all", () => {
    const definition = { ...row(), kind: "verb-run", params: { argv: ["worktree", "prune"] } };
    expect(unaskableInvestigateRows({ definitions: [definition] })).toEqual([]);
  });
});

describe("investigateFormArtifact", () => {
  it("declares itself an automation prompt, which is what lets the door refuse it in a team channel", () => {
    const artifact = investigateFormArtifact({
      postTo: undefined,
      question: "what broke?",
      recipeId: "overnight-staging",
    });
    expect(artifact["kind"]).toBe("automation-prompt");
    expect(artifact["prompt"]).toBe("what broke?");
    expect(artifact["recipeId"]).toBe("overnight-staging");
  });

  it("carries no mention run at all, so the opening message cannot tag the bot", () => {
    const artifact = investigateFormArtifact({
      postTo: undefined,
      question: "what broke?",
      recipeId: "overnight-staging",
    });
    expect(JSON.stringify(artifact)).not.toContain("mention");
    expect(JSON.stringify(artifact)).not.toContain("<@");
  });

  it('carries the card\'s destination as a field, never as the word "here" inside the prompt', () => {
    const artifact = investigateFormArtifact({
      postTo: "Cteamroom",
      question: "what broke?",
      recipeId: "overnight-staging",
    });
    expect(artifact["postTo"]).toBe("Cteamroom");
  });

  it("omits the destination key entirely when the answer stays where the question was asked", () => {
    const artifact = investigateFormArtifact({
      postTo: undefined,
      question: "what broke?",
      recipeId: "overnight-staging",
    });
    expect(Object.keys(artifact).toSorted()).toEqual(["kind", "prompt", "recipeId"]);
  });
});

describe("investigateOpenRest", () => {
  it("asks as the bot, in the row's channel, and asks for the document the next leg reads", () => {
    const plan = unwrap(planInvestigate({ definition: row(), promptChannel: PROMPT_CHANNEL, voiceOverridden: false }));
    expect(investigateOpenRest({ dryRun: false, idempotencyKey: "recipe-slot:deadbeef", home: "/h", plan })).toEqual([
      "--as",
      "bot",
      "--channel",
      PROMPT_CHANNEL,
      "--form",
      plan.form,
      "--home",
      "/h",
      "--idempotency-key",
      "recipe-slot:deadbeef",
      "--dm-purpose",
      "asked-for",
      "--json",
    ]);
  });

  it("stops a dry run at the wire and changes nothing else about the send", () => {
    const plan = unwrap(planInvestigate({ definition: row(), promptChannel: PROMPT_CHANNEL, voiceOverridden: false }));
    expect(investigateOpenRest({ dryRun: true, idempotencyKey: "recipe-slot:deadbeef", home: "/h", plan }).at(-1)).toBe(
      "--dry-run",
    );
  });
});

describe("investigateOpenTs", () => {
  it("reads the posted message's own ts back off the door's document", () => {
    const report = unwrap(
      investigateOpenTs({
        document: JSON.stringify({ preview: ["q"], sent: { ts: "1789.0001" } }),
        recipeId: "overnight-staging",
      }),
    );
    expect(report.ts).toBe("1789.0001");
    expect(report.preview).toEqual(["q"]);
  });

  it("answers no address for a document that sent nothing, rather than inventing one", () => {
    const report = unwrap(
      investigateOpenTs({ document: JSON.stringify({ preview: ["q"], sent: null }), recipeId: "overnight-staging" }),
    );
    expect(report.ts).toBe(null);
  });

  it("refuses a document that is not JSON at all, naming the row whose question was asked", () => {
    const error = unwrapErr(investigateOpenTs({ document: "not json", recipeId: "overnight-staging" }));
    expect(error.code).toBe("REPORT_UNREADABLE");
    expect(error.message).toContain("recipe 'overnight-staging' asked its question and could not read where it landed");
  });

  it("refuses a document whose sent message carries no ts", () => {
    const error = unwrapErr(
      investigateOpenTs({
        document: JSON.stringify({ sent: { channel: PROMPT_CHANNEL } }),
        recipeId: "overnight-staging",
      }),
    );
    expect(error.code).toBe("REPORT_UNREADABLE");
    expect(error.message).toContain("no readable");
  });
});

describe("investigateBriefArgv", () => {
  it("briefs the posted message as the ask, addressing message and thread alike", () => {
    const plan = unwrap(planInvestigate({ definition: row(), promptChannel: PROMPT_CHANNEL, voiceOverridden: false }));
    expect(investigateBriefArgv({ home: "/h", messageTs: "1789.0001", plan })).toEqual([
      "node",
      "slopweaver",
      "turn",
      "brief",
      "--channel",
      PROMPT_CHANNEL,
      "--message-ts",
      "1789.0001",
      "--thread-ts",
      "1789.0001",
      "--user",
      "U0OWNER",
      "--text",
      "what regressed in staging overnight?",
      "--surface",
      "dm",
      "--home",
      "/h",
    ]);
  });
});
