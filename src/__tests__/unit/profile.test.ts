import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../lib/result.js";
import { PROFILE_SCHEMA_VERSION, parseProfile } from "../../profile.js";

const template: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../templates/profile.template.json", import.meta.url)), "utf8"),
);

describe("parseProfile", () => {
  it("accepts the shipped template", () => {
    const result = parseProfile({ value: template });
    expect(result.isOk()).toBe(true);
    const profile = unwrap(result);
    expect(profile.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    expect(profile.id).toBe("me");
    expect(profile.displayName).toBe("");
    expect(profile.gitNamespace).toBe("");
    expect(profile.sources).toEqual([]);
    expect(profile.slackMe.voice.exact).toEqual([]);
    expect(profile.slackMe.voice.paragraphSpacing).toBe(false);
  });

  it("carries an absolute response-shape memory path, and leaves it absent when none is declared", () => {
    const configured = parseProfile({
      value: {
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackMe: { voice: { shapeMemoryFile: "/state/memory/response-shape.md" } },
        sources: [],
      },
    });
    const absent = parseProfile({
      value: { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, slackMe: { voice: {} }, sources: [] },
    });

    expect(unwrap(configured).slackMe.voice.shapeMemoryFile).toBe("/state/memory/response-shape.md");
    expect(unwrap(absent).slackMe.voice.shapeMemoryFile).toBeUndefined();
  });

  it("carries the title shape each repository is held to, and holds none when the block is absent", () => {
    const base = { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [] };
    const configured = parseProfile({ value: { ...base, github: { titleShapes: { "acme/acme-admin": "ticketed" } } } });
    expect(unwrap(configured).github.titleShapes).toStrictEqual({ "acme/acme-admin": "ticketed" });
    expect(unwrap(parseProfile({ value: base })).github.titleShapes).toStrictEqual({});
  });

  it("carries the Linear team keys the install states, and states none when the block is absent", () => {
    const base = { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [] };
    const configured = parseProfile({ value: { ...base, linear: { teamKeys: ["ABC", "DEF"] } } });
    expect(unwrap(configured).linear.teamKeys).toStrictEqual(["ABC", "DEF"]);
    expect(unwrap(parseProfile({ value: base })).linear.teamKeys).toStrictEqual([]);
  });

  it("REFUSES a title shape keyed by anything but a lowercase owner/repo, or naming a shape the code lacks", () => {
    const base = { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [] };
    const upper = parseProfile({ value: { ...base, github: { titleShapes: { "Acme/Admin": "ticketed" } } } });
    const unknown = parseProfile({ value: { ...base, github: { titleShapes: { "acme/admin": "jira" } } } });
    expect(unwrapErr(upper)).toStrictEqual(["profile.json github.titleShapes keys must be lowercase owner/repo"]);
    expect(unwrapErr(unknown)).toStrictEqual(['profile.json github.titleShapes values must be "ticketed"']);
  });

  it("REFUSES a relative response-shape path, because a cwd-resolved path reads differently per caller", () => {
    const result = parseProfile({
      value: {
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackMe: { voice: { shapeMemoryFile: "memory/response-shape.md" } },
        sources: [],
      },
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("must be an absolute path");
  });

  it("REFUSES an empty response-shape path rather than treating it as unset", () => {
    const result = parseProfile({
      value: {
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackMe: { voice: { shapeMemoryFile: "" } },
        sources: [],
      },
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).length).toBeGreaterThan(0);
  });

  it("carries the paragraph-spacing rule when the operator declares it, and defaults it off", () => {
    const on = parseProfile({
      value: {
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackMe: { voice: { paragraphSpacing: true } },
        sources: [],
      },
    });
    const off = parseProfile({
      value: { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, slackMe: { voice: {} }, sources: [] },
    });

    expect(unwrap(on).slackMe.voice.paragraphSpacing).toBe(true);
    expect(unwrap(off).slackMe.voice.paragraphSpacing).toBe(false);
  });

  it("accepts a populated profile", () => {
    const result = parseProfile({
      value: { displayName: "Dev", gitNamespace: "octocat", id: "me", schemaVersion: 1, sources: ["github"] },
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).sources).toEqual(["github"]);
  });

  it("accepts literal, word and phrase voice rules as private profile content", () => {
    const exact = [
      { kind: "literal", value: "§" },
      { kind: "word", value: "blockedword" },
      { kind: "phrase", value: "blocked phrase" },
    ] as const;
    const result = parseProfile({
      value: {
        displayName: "Dev",
        gitNamespace: "octocat",
        id: "me",
        schemaVersion: 1,
        slackMe: { voice: { exact } },
        sources: [],
      },
    });

    expect(unwrap(result).slackMe.voice.exact).toEqual(exact);
  });

  it("rejects a word rule containing whitespace", () => {
    const result = parseProfile({
      value: {
        displayName: "Dev",
        gitNamespace: "octocat",
        id: "me",
        schemaVersion: 1,
        slackMe: { voice: { exact: [{ kind: "word", value: "blocked phrase" }] } },
        sources: [],
      },
    });

    expect(unwrapErr(result)).toEqual(["a word rule cannot contain whitespace"]);
  });

  it("parses the optional owner-bot declaration, defaulting absent id lists to empty (PR4.5)", () => {
    const result = parseProfile({
      value: {
        displayName: "Dev",
        gitNamespace: "octocat",
        id: "me",
        schemaVersion: 1,
        slackBot: { botUserIds: ["U_OWNER_BOT"], ownerUserId: "U_OWNER" },
        sources: [],
      },
    });
    expect(unwrap(result).slackBot).toEqual({
      appIds: [],
      botIds: [],
      botUserIds: ["U_OWNER_BOT"],
      // The capture-reaction emoji defaults to the owner's own suggestion — the signal a listener seeds the
      // instant it captures a tag, before any turn work runs.
      captureReaction: { emoji: "eyes" },
      cardChrome: {
        authorEmoji: ":robot_face:",
        authorLabel: "slopweaver",
        bannerColor: "#8B5CF6",
        detailLabel: "*Details*",
        metadataEventType: "slopweaver_card_v1",
      },
      // The completion-reaction emoji defaults to a checkmark — the signal that REPLACES captureReaction's
      // once the turn's answer has actually posted.
      completionReaction: { emoji: "white_check_mark" },
      ownerUserId: "U_OWNER",
      pollChrome: { metadataEventType: "slopweaver_poll_v1" },
      // PR5.2's progress chrome defaults in the same way cardChrome does. `emojiShortcode` is deliberately
      // ABSENT rather than defaulted: an animated custom emoji is workspace-specific, so guessing a name
      // would render literal colons in a workspace that never uploaded one.
      progressChrome: {
        barWidth: 5,
        emojiFallback: "⏳",
        metadataEventType: "slopweaver_progress_v1",
      },
      // Independent of the id lists above (PR6): the bot's own addressable identity, for an as-me send
      // that wants to mention the bot itself. Absent here, so it defaults empty like the others.
      selfHandles: [],
      selfUserIds: [],
      // The stand-down reaction is Unicode by default, so it works before a custom one is uploaded.
      standDownReaction: { emoji: "zipper_mouth_face" },
      stoppedReaction: { emoji: "warning" },
      // No peer bot is witnessed unless a handle is named — witnessing is inert by default.
      witnessBotHandles: [],
      // The acknowledged-reaction emoji defaults to `ack`, and is the one default that is a CUSTOM
      // workspace emoji rather than a Unicode one — the owner's own call for "read and judged, nothing
      // owed", an outcome the tick and the warning both misreport.
      acknowledgedReaction: { emoji: "ack" },
      // The fourth ending, also a custom emoji: read and judged, a PERSON should answer.
      forAHumanReaction: { emoji: "for-a-human" },
    });
  });

  it("leaves slackBot absent when not declared (me-to-me off)", () => {
    const result = parseProfile({
      value: { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [] },
    });
    expect(unwrap(result).slackBot).toBeUndefined();
  });

  /**
   * `ownerUserId` is required exactly when something could MATCH — a non-empty id list — and not merely
   * because a `slackBot` key exists. It used to be unconditionally required, which meant renaming the card's
   * author row (a purely cosmetic change) forced a real Slack user id into the file for no behavioural reason.
   */
  it("accepts a CHROME-ONLY slackBot with no ownerUserId", () => {
    const result = parseProfile({
      value: {
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { cardChrome: { authorLabel: "acme-bot" } },
        sources: [],
      },
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).slackBot!.cardChrome.authorLabel).toBe("acme-bot");
    expect(unwrap(result).slackBot!.ownerUserId).toBeUndefined();
  });

  it("accepts an EMPTY slackBot, defaulting all chrome", () => {
    const result = parseProfile({
      value: { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, slackBot: {}, sources: [] },
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).slackBot!.cardChrome.metadataEventType).toBe("slopweaver_card_v1");
    expect(unwrap(result).slackBot!.captureReaction.emoji).toBe("eyes");
    expect(unwrap(result).slackBot!.completionReaction.emoji).toBe("white_check_mark");
  });

  it("accepts a configured capture-reaction emoji", () => {
    const result = parseProfile({
      value: {
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { captureReaction: { emoji: "raised_hands" } },
        sources: [],
      },
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).slackBot!.captureReaction.emoji).toBe("raised_hands");
  });

  it("accepts a configured completion-reaction emoji", () => {
    const result = parseProfile({
      value: {
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { completionReaction: { emoji: "tada" } },
        sources: [],
      },
    });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result).slackBot!.completionReaction.emoji).toBe("tada");
  });

  it("rejects bot ids declared with no ownerUserId — there is nothing to resolve TO", () => {
    const result = parseProfile({
      value: {
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { botUserIds: ["U_OWNER_BOT"] },
        sources: [],
      },
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("declares bot ids for me-to-me resolution but no ownerUserId");
  });

  it("rejects one emoji for both judged endings — a tag left for a person would read as nothing owed", () => {
    const result = parseProfile({
      value: {
        displayName: "",
        gitNamespace: "",
        id: "me",
        schemaVersion: 1,
        slackBot: { forAHumanReaction: { emoji: "ack" } },
        sources: [],
      },
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("forAHumanReaction and acknowledgedReaction are both :ack:");
  });

  it("rejects a wrong schemaVersion", () => {
    const result = parseProfile({
      value: { displayName: "", gitNamespace: "", id: "me", schemaVersion: 2, sources: [] },
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("schemaVersion must be 1");
  });

  it("rejects a non-string id", () => {
    const result = parseProfile({ value: { displayName: "", gitNamespace: "", id: 7, schemaVersion: 1, sources: [] } });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("id must be a string");
  });

  it("rejects non-array sources", () => {
    const result = parseProfile({
      value: { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: "github" },
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("sources must be an array of strings");
  });

  it("rejects sources with a non-string element", () => {
    const result = parseProfile({
      value: { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: ["github", 3] },
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).join(" ")).toContain("sources must be an array of strings");
  });

  it("rejects a non-object value", () => {
    const result = parseProfile({ value: "nope" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(["profile.json is not a JSON object"]);
  });
});
