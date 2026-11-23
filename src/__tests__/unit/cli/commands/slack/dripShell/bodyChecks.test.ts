import { afterEach, describe, expect, it } from "vitest";
import { runSlackDrip } from "../../../../../../cli/commands/slack/asMeSend.js";
import { parseSlackWriteArgs } from "../../../../../../cli/commands/slack/coreArgs.js";
import type { SlackDripOptions, SlackWriteOptions } from "../../../../../../cli/commands/slack/coreTypes.js";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { ok, unwrap } from "../../../../../../lib/result.js";
import { grantSessionEnv } from "../../../../../hatchGrantFixture.js";
import { argv, freshHome, harness, rawBodyArgv, removeFixtureDirs, resolutionKnowing } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite --as me --body — a raw `<@U…>` is verified, not taken on trust", () => {
  it("refuses an id nothing knows, and sends NOTHING", async () => {
    const h = harness({
      resolveMentions: async () => ok(resolutionKnowing({ id: "U0ADA" })),
      stdin: "Morning <@U0GHOST>, that one is yours.",
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("runs the as-me lane from its own module exactly as runSlackWrite dispatches it", async () => {
    const h = harness({
      resolveMentions: async () => ok(resolutionKnowing({ id: "U0ADA" })),
      stdin: "Morning <@U0ADA>, that one is yours.",
    });
    const options = unwrap(
      parseSlackWriteArgs({ defaultHome: "/h", rest: rawBodyArgv({ home: freshHome() }), verb: "post" }),
    );

    const code = await runSlackDrip({ deps: h.deps, options: dripArmOf({ options }), token: "xoxp-test" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.payload.text)).toEqual(["Morning <@U0ADA>, that one is yours."]);
  });

  it("sends a body whose every raw id resolves, bytes unchanged", async () => {
    const h = harness({
      resolveMentions: async () => ok(resolutionKnowing({ id: "U0ADA" })),
      stdin: "Morning <@U0ADA>, that one is yours.",
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.payload.text)).toEqual(["Morning <@U0ADA>, that one is yours."]);
  });

  it("counts a raw id in the dry run's mention line, which used to read `0 resolved` over a real mention", async () => {
    const h = harness({
      resolveMentions: async () => ok(resolutionKnowing({ id: "U0ADA" })),
      stdin: "Morning <@U0ADA>, that one is yours.",
    });

    await runSlackWrite({
      argv: rawBodyArgv({ extra: ["--dry-run"], home: freshHome() }),
      deps: h.deps,
      verb: "post",
    });

    expect(h.out.filter((line) => line.startsWith("mentions:"))).toEqual([
      "mentions: 1 resolved (0 confirmed by the identity roster, 0 the bot's own declared identity, 1 from the derived roster)",
    ]);
  });

  it("refuses a chase whose only `<@U…>` is fabricated — the hole the bump gate alone cannot see", async () => {
    const h = harness({
      resolveMentions: async () => ok(resolutionKnowing({ id: "U0ADA" })),
      stdin: "Bumping this one, <@U0GHOST> pls review.",
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });
});

describe("runSlackWrite --as me — the paragraph-spacing rule", () => {
  /** The ratchet discussion piece the owner saw rendered dense, as its three one-card lines. */
  const RATCHET_LINES: readonly string[] = [
    "we keep conventions in markdown that nothing enforces.",
    "So: a ratchet, inside the lint target we already run.",
    "A second PR stacked on it converts a few components.",
  ];

  it("refuses a dense `--body` before the API is called", async () => {
    const h = harness({ paragraphSpacing: true, stdin: RATCHET_LINES.join("\n") });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("sends the same words once a blank line separates them", async () => {
    const h = harness({ paragraphSpacing: true, stdin: RATCHET_LINES.join("\n\n") });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.payload.text)).toEqual([RATCHET_LINES.join("\n\n")]);
  });

  it("sends the dense original unchanged under a live voice-rules grant", async () => {
    const home = freshHome();
    const h = harness({
      grants: { hatchIds: ["voice-rules"], home },
      paragraphSpacing: true,
      stdin: RATCHET_LINES.join("\n"),
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.payload.text)).toEqual([RATCHET_LINES.join("\n")]);
  });

  it("still refuses the dense original with only the retired voice-rules variable set", async () => {
    const home = freshHome();
    const h = harness({
      extraEnv: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_VOICE_RULES: "1" },
      paragraphSpacing: true,
      stdin: RATCHET_LINES.join("\n"),
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("sends the SAME three lines as a one-card form, spaced by the renderer, with no override", async () => {
    const h = harness({
      paragraphSpacing: true,
      stdin: JSON.stringify({
        kind: "one-card",
        lines: RATCHET_LINES.map((text) => ({ runs: [{ text, type: "text" }] })),
      }),
    });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.payload.text)).toEqual([RATCHET_LINES.join("\n\n")]);
  });
});

describe("runSlackWrite --as me — a defect a reader can see never reaches the wire", () => {
  it("REFUSES a form whose text run carries a bare handle, which would post as plain text", async () => {
    const h = harness({
      stdin: JSON.stringify({
        kind: "drip",
        // Deliberately NOT chase phrasing: the bump gate would refuse that for its own reason, and this
        // test would pass while proving nothing about the render gate.
        messages: [{ runs: [{ text: "@ada-example is across it", type: "text" }] }],
      }),
    });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("SENDS the same sentence with the handle removed, so the refusal is about the handle", async () => {
    const h = harness({
      stdin: JSON.stringify({
        kind: "drip",
        messages: [{ runs: [{ text: "she is across it", type: "text" }] }],
      }),
    });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(1);
  });

  it("REFUSES a form whose text run carries literal mrkdwn, inert inside a rich_text block", async () => {
    const h = harness({
      stdin: JSON.stringify({
        kind: "drip",
        messages: [{ runs: [{ text: "*setTaskUrgency integration test:*", type: "text" }] }],
      }),
    });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("SENDS the same emphasis as a typed run, which is the fix the refusal names", async () => {
    const h = harness({
      stdin: JSON.stringify({
        kind: "drip",
        messages: [{ runs: [{ bold: true, text: "setTaskUrgency integration test", type: "text" }] }],
      }),
    });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(1);
  });

  it("does NOT gate the --body escape hatch, whose styling Slack has not parsed yet", async () => {
    const h = harness({ stdin: "*bold* and @ada-example" });

    const code = await runSlackWrite({
      argv: ["--as", "me", "--channel", "C1", "--body", "-", "--home", freshHome(), "--shape", "top-level"],
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(1);
  });
});

describe("runSlackWrite --as me — a public raw body proves its render first", () => {
  function bodyArgv({ home }: { home: string }): readonly string[] {
    return ["--as", "me", "--channel", "C1", "--body", "-", "--home", home, "--shape", "top-level"];
  }

  it("REFUSES when the proof comes back dirty, and posts NOTHING to the target channel", async () => {
    const h = harness({
      conversationSurface: async () => "public-channel" as const,
      proveRender: async () => ({ issues: ["@ada-example is plain text"], kind: "checked" as const }),
      renderProofChannel: "D0PROOF",
      stdin: "@ada-example is across it",
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("REFUSES when the round trip could not answer, because an unproven send is an unchecked one", async () => {
    const h = harness({
      conversationSurface: async () => "public-channel" as const,
      proveRender: async () => ({ kind: "unprovable" as const, reason: "not_in_channel" }),
      renderProofChannel: "D0PROOF",
      stdin: "a clean sentence",
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("SENDS once the proof comes back clean", async () => {
    const h = harness({
      conversationSurface: async () => "public-channel" as const,
      proveRender: async () => ({ issues: [], kind: "checked" as const }),
      renderProofChannel: "D0PROOF",
      stdin: "a clean sentence",
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(1);
  });

  it("SENDS a dirty body under a live unproven-render grant, which is the key every block here carries", async () => {
    const home = freshHome();
    const h = harness({
      conversationSurface: async () => "public-channel" as const,
      grants: { hatchIds: ["unproven-render"], home },
      proveRender: async () => ({ issues: ["@ada-example is plain text"], kind: "checked" as const }),
      renderProofChannel: "D0PROOF",
      stdin: "@ada-example is across it",
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(1);
  });

  it("still REFUSES a dirty body with only the retired unproven-render variable set", async () => {
    const home = freshHome();
    const h = harness({
      conversationSurface: async () => "public-channel" as const,
      extraEnv: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_UNPROVEN_RENDER: "1" },
      proveRender: async () => ({ issues: ["@ada-example is plain text"], kind: "checked" as const }),
      renderProofChannel: "D0PROOF",
      stdin: "@ada-example is across it",
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("never PROVES a private-channel body, so the round trip is not paid for where it is not wanted", async () => {
    const asked: string[] = [];
    const h = harness({
      conversationSurface: async () => "private-channel" as const,
      proveRender: async ({ channel }) => {
        asked.push(channel);
        return { issues: [], kind: "checked" as const };
      },
      renderProofChannel: "D0PROOF",
      stdin: "a clean sentence",
    });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([]);
  });

  it("never PROVES a typed FORM, which is already checked before the wire", async () => {
    const asked: string[] = [];
    const h = harness({
      conversationSurface: async () => "public-channel" as const,
      proveRender: async ({ channel }) => {
        asked.push(channel);
        return { issues: [], kind: "checked" as const };
      },
      renderProofChannel: "D0PROOF",
      stdin: JSON.stringify({ kind: "drip", messages: [{ runs: [{ text: "One line.", type: "text" }] }] }),
    });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([]);
  });

  it("REFUSES with nothing configured, naming the profile field and the key, so absence is not a skip", async () => {
    const h = harness({ conversationSurface: async () => "public-channel" as const, stdin: "a clean sentence" });

    const code = await runSlackWrite({ argv: rawBodyArgv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("never PROVES under --dry-run, because a dry run posts nothing and must stay traceless", async () => {
    const asked: string[] = [];
    const h = harness({
      conversationSurface: async () => "public-channel" as const,
      proveRender: async ({ channel }) => {
        asked.push(channel);
        return { issues: ["would have been refused"], kind: "checked" as const };
      },
      renderProofChannel: "D0PROOF",
      stdin: "@ada-example is across it",
    });

    const code = await runSlackWrite({
      argv: [...bodyArgv({ home: freshHome() }), "--dry-run"],
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([]);
  });
});

/** Narrow a parsed invocation to the as-me drip it must be, failing loudly otherwise. */
function dripArmOf({ options }: { options: SlackWriteOptions }): SlackDripOptions {
  if (options.actor !== "me" || !("source" in options)) {
    throw new Error("expected an as-me drip");
  }
  return options;
}
