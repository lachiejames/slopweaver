/**
 * `slack canvas`'s pure half. No I/O, no clock, no mocks.
 *
 * The property this file exists for is the DISCLOSURE one: `--channel` present means everyone in that
 * channel can read the document the moment it exists, and the dry run has to say so in as many words. The
 * other half is the empty-body refusal, which is what stops an unreadable `--markdown` path from becoming a
 * blank document in a real workspace.
 */
import { describe, expect, it } from "vitest";

import { slackArgumentErrorLines } from "../../../../../cli/commands/slack/argumentErrors.js";
import {
  buildCanvasCreatePlan,
  type CanvasCreateOptions,
  canvasCreateDryRunLines,
  canvasDestination,
  parseCanvasArgs,
  SLACK_CANVAS_TITLE_MAX,
} from "../../../../../cli/commands/slack/canvasCore.js";
import { unwrap } from "../../../../../lib/result.js";

const HOME = "/tmp/does-not-need-to-exist";

function options({ over = {} }: { over?: Partial<CanvasCreateOptions> } = {}): CanvasCreateOptions {
  return {
    actor: "bot",
    channel: undefined,
    dryRun: false,
    home: HOME,
    json: false,
    markdownSource: "./body.md",
    mode: "create",
    title: "Runbook",
    ...over,
  };
}

describe("parseCanvasArgs", () => {
  it("defaults to the BOT lane, so the canvas is one the bot can later rewrite", () => {
    const parsed = unwrap(
      parseCanvasArgs({ defaultHome: HOME, rest: ["create", "--title", "T", "--markdown", "b.md"] }),
    );

    expect(parsed.actor).toBe("bot");
  });

  it("leaves --channel ABSENT rather than defaulting it, because that flag decides who can read the canvas", () => {
    const parsed = unwrap(
      parseCanvasArgs({ defaultHome: HOME, rest: ["create", "--title", "T", "--markdown", "b.md"] }),
    );

    expect(parsed.mode === "create" ? parsed.channel : "set").toBeUndefined();
  });

  it("names all three sub-commands when given one it does not have", () => {
    const parsed = parseCanvasArgs({ defaultHome: HOME, rest: ["publish"] });

    expect(parsed._unsafeUnwrapErr().code).toBe("SUBCOMMAND_UNKNOWN");
    expect(parsed.mapErr((error) => slackArgumentErrorLines({ error }))._unsafeUnwrapErr()[0]).toContain(
      "create, replace, delete",
    );
  });

  it("refuses create with no --title and no --markdown, reporting BOTH in one run", () => {
    expect(parseCanvasArgs({ defaultHome: HOME, rest: ["create"] })._unsafeUnwrapErr().code).toBe("ARGUMENTS_REFUSED");
    const errors = parseCanvasArgs({ defaultHome: HOME, rest: ["create"] })
      .mapErr((error) => slackArgumentErrorLines({ error }))
      ._unsafeUnwrapErr();

    expect(errors).toEqual([
      "slack canvas create needs --markdown <file|->",
      "slack canvas create needs --title <text>",
    ]);
  });

  it("refuses --canvas on create, because that flag names one that already exists", () => {
    const errors = parseCanvasArgs({
      defaultHome: HOME,
      rest: ["create", "--title", "T", "--markdown", "b.md", "--canvas", "F1"],
    })
      .mapErr((error) => slackArgumentErrorLines({ error }))
      ._unsafeUnwrapErr();

    expect(errors[0]).toContain("mints a new one");
  });

  it("refuses replace with no --canvas", () => {
    const errors = parseCanvasArgs({
      defaultHome: HOME,
      rest: ["replace", "--markdown", "b.md"],
    })
      .mapErr((error) => slackArgumentErrorLines({ error }))
      ._unsafeUnwrapErr();

    expect(errors).toEqual(["slack canvas replace needs --canvas <id>"]);
  });

  it("refuses delete with no --canvas, and does NOT ask a delete for a body", () => {
    expect(
      parseCanvasArgs({ defaultHome: HOME, rest: ["delete"] })
        .mapErr((error) => slackArgumentErrorLines({ error }))
        ._unsafeUnwrapErr(),
    ).toEqual(["slack canvas delete needs --canvas <id>"]);
  });
});

describe("canvasDestination", () => {
  it("names the channel a channel canvas lands in", () => {
    const plan = unwrap(buildCanvasCreatePlan({ markdown: "# Hi", options: options({ over: { channel: "C1" } }) }));

    expect(canvasDestination({ plan })).toBe("C1");
  });

  it("names a standalone canvas when the create named no channel", () => {
    const plan = unwrap(buildCanvasCreatePlan({ markdown: "# Hi", options: options() }));

    expect(canvasDestination({ plan })).toBe("a standalone canvas");
  });
});

describe("buildCanvasCreatePlan", () => {
  it("calls a standalone canvas author-only and a channel canvas channel-reach", () => {
    const standalone = unwrap(buildCanvasCreatePlan({ markdown: "# Hi", options: options() }));
    const channelCanvas = unwrap(
      buildCanvasCreatePlan({ markdown: "# Hi", options: options({ over: { channel: "C1" } }) }),
    );

    expect(standalone.reach).toBe("author-only");
    expect(channelCanvas.reach).toBe("channel");
  });

  it("keys the reservation on the destination and the title, so two channels' canvases never collide", () => {
    const plan = unwrap(buildCanvasCreatePlan({ markdown: "# Hi", options: options({ over: { channel: "C1" } }) }));

    expect(plan.duplicateKey).toBe("slack-canvas-create:C1:Runbook");
  });

  it("keys a create with no --channel to the standalone destination", () => {
    const plan = unwrap(buildCanvasCreatePlan({ markdown: "# Hi", options: options() }));

    expect(plan.duplicateKey).toBe("slack-canvas-create:standalone:Runbook");
  });

  it("refuses an EMPTY body — Slack would accept one and mint a blank document", () => {
    const plan = buildCanvasCreatePlan({ markdown: "   \n  ", options: options() });

    expect(plan.isErr()).toBe(true);
    expect(plan._unsafeUnwrapErr()[0]).toContain("EMPTY canvas");
  });

  it("refuses a blank title, because Slack's own search cannot find one", () => {
    const plan = buildCanvasCreatePlan({ markdown: "# Hi", options: options({ over: { title: "  " } }) });

    expect(plan._unsafeUnwrapErr()[0]).toContain("unfindable");
  });

  it(`allows a title of exactly ${String(SLACK_CANVAS_TITLE_MAX)} characters and refuses one past it`, () => {
    const atCap = unwrap(
      buildCanvasCreatePlan({
        markdown: "# Hi",
        options: options({ over: { title: "t".repeat(SLACK_CANVAS_TITLE_MAX) } }),
      }),
    );
    const overCap = buildCanvasCreatePlan({
      markdown: "# Hi",
      options: options({ over: { title: "t".repeat(SLACK_CANVAS_TITLE_MAX + 1) } }),
    });

    expect(atCap.title.length).toBe(SLACK_CANVAS_TITLE_MAX);
    expect(overCap._unsafeUnwrapErr()[0]).toContain("256");
  });
});

describe("canvasCreateDryRunLines", () => {
  it("names the STANDALONE endpoint and says nobody else could read it", () => {
    const plan = unwrap(buildCanvasCreatePlan({ markdown: "# Hi\nthere", options: options() }));

    expect(canvasCreateDryRunLines({ plan })).toEqual([
      "DRY RUN — nothing was created. As the bot, slopweaver would:",
      '  1. canvases.create title="Runbook"',
      "  body: 10 characters, 2 line(s)",
      "  nobody but you could read it until access is granted.",
    ]);
  });

  it("names the CHANNEL endpoint and states the disclosure in as many words", () => {
    const plan = unwrap(buildCanvasCreatePlan({ markdown: "# Hi", options: options({ over: { channel: "C1" } }) }));
    const lines = canvasCreateDryRunLines({ plan });

    expect(lines[1]).toBe('  1. conversations.canvases.create channel_id=C1 title="Runbook"');
    expect(lines[3]).toBe("  EVERYONE IN C1 could read it the moment it exists.");
  });
});
