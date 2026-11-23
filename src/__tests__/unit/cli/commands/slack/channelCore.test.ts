/**
 * `slack channel`'s pure half: the argument parser, the plan builder's refusals, the dry-run rendering and
 * the scope hint. No I/O, no clock, no mocks — every one of these is a function over plain values.
 *
 * The assertions worth reading are the REFUSALS. A channel cannot be deleted once created, so every one of
 * these paths exists to stop a create rather than to shape one, and each is asserted on its exact text
 * because the text is what names the fix.
 */
import { describe, expect, it } from "vitest";

import { slackArgumentErrorLines } from "../../../../../cli/commands/slack/argumentErrors.js";
import {
  buildChannelCreatePlan,
  buildChannelInvitePlan,
  type ChannelCreateOptions,
  type ChannelInviteOptions,
  channelCreateDryRunLines,
  channelInviteDryRunLines,
  channelScopeHint,
  commaSeparated,
  parseChannelArgs,
} from "../../../../../cli/commands/slack/channelCore.js";
import {
  channelArchiveDoorRequest,
  channelCreateDoorRequest,
  channelInviteDoorRequest,
} from "../../../../../cli/commands/slack/channelDoor.js";
import { unwrap } from "../../../../../lib/result.js";

const HOME = "/tmp/does-not-need-to-exist";

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return tail;
}

function createOptions({ over = {} }: { over?: Partial<ChannelCreateOptions> } = {}): ChannelCreateOptions {
  return {
    actor: "me",
    dryRun: false,
    home: HOME,
    invite: [],
    isPrivate: false,
    json: false,
    mode: "create",
    name: "design-review",
    purpose: undefined,
    topic: undefined,
    ...over,
  };
}

function inviteOptions({ over = {} }: { over?: Partial<ChannelInviteOptions> } = {}): ChannelInviteOptions {
  return {
    actor: "me",
    channel: "C0EXISTS",
    dryRun: false,
    home: HOME,
    invite: ["seth"],
    json: false,
    mode: "invite",
    ...over,
  };
}

describe("commaSeparated", () => {
  it("splits, trims, and drops the empty entry a trailing comma leaves", () => {
    expect(commaSeparated({ raw: "seth, alex," })).toEqual(["seth", "alex"]);
  });

  it("answers an empty list for an absent flag and for an empty value alike", () => {
    expect(commaSeparated({ raw: undefined })).toEqual([]);
    expect(commaSeparated({ raw: "" })).toEqual([]);
  });
});

describe("parseChannelArgs", () => {
  it("defaults to the --as me lane, which is the one measured as able to create on this install", () => {
    const parsed = unwrap(parseChannelArgs({ defaultHome: HOME, rest: argv({ tail: ["create", "--name", "eng"] }) }));

    expect(parsed.actor).toBe("me");
    expect(parsed.mode).toBe("create");
  });

  it("reads --private, --purpose, --topic and --invite into the create invocation", () => {
    const parsed = unwrap(
      parseChannelArgs({
        defaultHome: HOME,
        rest: argv({
          tail: [
            "create",
            "--name",
            "eng",
            "--private",
            "--purpose",
            "why",
            "--topic",
            "what",
            "--invite",
            "seth,alex",
          ],
        }),
      }),
    );

    expect(parsed.mode === "create" ? parsed.isPrivate : false).toBe(true);
    expect(parsed.mode === "create" ? parsed.purpose : "").toBe("why");
    expect(parsed.mode === "create" ? parsed.topic : "").toBe("what");
    expect(parsed.mode === "create" ? parsed.invite : []).toEqual(["seth", "alex"]);
  });

  it("refuses a missing sub-command by NAMING all three of them", () => {
    const parsed = parseChannelArgs({ defaultHome: HOME, rest: argv({ tail: ["--name", "eng"] }) });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("SUBCOMMAND_UNKNOWN");
    expect(parsed.mapErr((error) => slackArgumentErrorLines({ error }))._unsafeUnwrapErr()[0]).toContain(
      "create, invite or archive",
    );
  });

  it("reads `invite` into a channel-plus-keys invocation on the default lane", () => {
    const parsed = parseChannelArgs({
      defaultHome: HOME,
      rest: argv({ tail: ["invite", "--channel", "C0EXISTS", "--invite", "seth,alex", "--dry-run"] }),
    });

    expect(unwrap(parsed)).toEqual({
      actor: "me",
      channel: "C0EXISTS",
      dryRun: true,
      home: HOME,
      invite: ["seth", "alex"],
      json: false,
      mode: "invite",
    });
  });

  it("refuses `invite` with no --channel and no --invite TOGETHER, so one run teaches both", () => {
    const parsed = parseChannelArgs({ defaultHome: HOME, rest: argv({ tail: ["invite"] }) });

    expect(parsed.mapErr((error) => slackArgumentErrorLines({ error }))._unsafeUnwrapErr()).toEqual([
      "slack channel invite needs --channel <id>",
      "slack channel invite needs --invite <key,...> naming at least one person",
    ]);
  });

  it("refuses an --invite that names nobody once the commas are dropped — never a call for nobody", () => {
    const parsed = parseChannelArgs({
      defaultHome: HOME,
      rest: argv({ tail: ["invite", "--channel", "C0EXISTS", "--invite", ","] }),
    });

    expect(parsed.mapErr((error) => slackArgumentErrorLines({ error }))._unsafeUnwrapErr()).toEqual([
      "slack channel invite needs --invite <key,...> naming at least one person",
    ]);
  });

  it("refuses --name on invite, because that flag names a channel to CREATE", () => {
    const parsed = parseChannelArgs({
      defaultHome: HOME,
      rest: argv({ tail: ["invite", "--channel", "C0EXISTS", "--invite", "seth", "--name", "eng"] }),
    });

    expect(parsed.mapErr((error) => slackArgumentErrorLines({ error }))._unsafeUnwrapErr()[0]).toContain(
      "takes --channel <id>",
    );
  });

  it("refuses `create` with no --name", () => {
    const parsed = parseChannelArgs({ defaultHome: HOME, rest: argv({ tail: ["create"] }) });

    expect(parsed.mapErr((error) => slackArgumentErrorLines({ error }))._unsafeUnwrapErr()).toEqual([
      "slack channel create needs --name <name>",
    ]);
  });

  it("refuses --channel on create, because that flag names a channel that already exists", () => {
    const parsed = parseChannelArgs({
      defaultHome: HOME,
      rest: argv({ tail: ["create", "--name", "eng", "--channel", "C1"] }),
    });

    expect(parsed.mapErr((error) => slackArgumentErrorLines({ error }))._unsafeUnwrapErr()[0]).toContain(
      "takes --name",
    );
  });

  it("refuses `archive` with no --channel", () => {
    const parsed = parseChannelArgs({ defaultHome: HOME, rest: argv({ tail: ["archive"] }) });

    expect(parsed.mapErr((error) => slackArgumentErrorLines({ error }))._unsafeUnwrapErr()).toEqual([
      "slack channel archive needs --channel <id>",
    ]);
  });

  it("refuses an --as value that names neither lane, quoting what was given", () => {
    const parsed = parseChannelArgs({
      defaultHome: HOME,
      rest: argv({ tail: ["create", "--name", "eng", "--as", "owner"] }),
    });

    expect(parsed.mapErr((error) => slackArgumentErrorLines({ error }))._unsafeUnwrapErr()).toEqual([
      '--as must be bot or me, not "owner"',
    ]);
  });
});

describe("buildChannelCreatePlan", () => {
  it("carries the resolved invitee IDS forward, never the keys the author wrote", () => {
    const plan = unwrap(
      buildChannelCreatePlan({
        options: createOptions({ over: { invite: ["seth", "alex"] } }),
        resolved: new Map([
          ["seth", "U01"],
          ["alex", "U02"],
        ]),
      }),
    );

    expect(plan.inviteUserIds).toEqual(["U01", "U02"]);
  });

  it("keys the reservation on the channel NAME, which is what Slack itself makes unique", () => {
    const plan = unwrap(buildChannelCreatePlan({ options: createOptions(), resolved: new Map() }));

    expect(plan.duplicateKey).toBe("slack-channel-create:design-review");
  });

  it("refuses the whole create when ONE invitee does not resolve, naming them", () => {
    const plan = buildChannelCreatePlan({
      options: createOptions({ over: { invite: ["seth", "ghost"] } }),
      resolved: new Map([["seth", "U01"]]),
    });

    expect(plan.isErr()).toBe(true);
    expect(plan._unsafeUnwrapErr()[0]).toContain('"ghost"');
    expect(plan._unsafeUnwrapErr()[0]).toContain("cannot be un-minted");
  });

  it("reports the name refusal and the invitee refusal TOGETHER, so one run teaches both", () => {
    const plan = buildChannelCreatePlan({
      options: createOptions({ over: { invite: ["ghost"], name: "Design Review" } }),
      resolved: new Map(),
    });

    const errors = plan._unsafeUnwrapErr();

    expect(errors.some((line) => line.includes("re-run with --name design-review"))).toBe(true);
    expect(errors.some((line) => line.includes('"ghost"'))).toBe(true);
  });
});

describe("buildChannelInvitePlan", () => {
  it("carries the resolved IDS forward, and keys the reservation on the channel plus the SORTED id set", () => {
    const plan = unwrap(
      buildChannelInvitePlan({
        options: inviteOptions({ over: { invite: ["seth", "alex"] } }),
        resolved: new Map([
          ["seth", "U02"],
          ["alex", "U01"],
        ]),
      }),
    );

    expect(plan).toEqual({
      actor: "me",
      channel: "C0EXISTS",
      duplicateKey: "slack-channel-invite:C0EXISTS:U01,U02",
      inviteUserIds: ["U02", "U01"],
    });
  });

  it("refuses the whole invite when ONE key does not resolve, naming it and saying nobody was invited", () => {
    const plan = buildChannelInvitePlan({
      options: inviteOptions({ over: { invite: ["seth", "ghost"] } }),
      resolved: new Map([["seth", "U01"]]),
    });

    expect(plan.isErr()).toBe(true);
    expect(plan._unsafeUnwrapErr()[0]).toContain('"ghost"');
    expect(plan._unsafeUnwrapErr()[0]).toContain("Nobody was invited");
  });
});

describe("channelInviteDryRunLines", () => {
  it("prints the one call it would make and says what it could not undo", () => {
    const plan = unwrap(
      buildChannelInvitePlan({
        options: inviteOptions({ over: { actor: "bot" } }),
        resolved: new Map([["seth", "U01"]]),
      }),
    );

    expect(channelInviteDryRunLines({ plan })).toEqual([
      "DRY RUN — nobody was invited. As the bot, slopweaver would:",
      "  1. conversations.invite U01 into C0EXISTS",
      "  an invite is not retracted by this verb — a person invited by mistake is removed by hand in Slack.",
    ]);
  });
});

describe("channelCreateDryRunLines", () => {
  it("numbers only the steps it would actually take, skipping an absent purpose and topic", () => {
    const plan = unwrap(buildChannelCreatePlan({ options: createOptions(), resolved: new Map() }));

    expect(channelCreateDryRunLines({ plan })).toEqual([
      "DRY RUN — nothing was created. As you, slopweaver would:",
      "  1. conversations.create name=design-review is_private=false",
      "  a created channel cannot be deleted — `slopweaver slack channel archive` is the only retraction, " +
        "and the name stays taken.",
    ]);
  });

  it("numbers invite, purpose and topic in the order they would happen", () => {
    const plan = unwrap(
      buildChannelCreatePlan({
        options: createOptions({ over: { invite: ["seth"], purpose: "why", topic: "what" } }),
        resolved: new Map([["seth", "U01"]]),
      }),
    );

    expect(channelCreateDryRunLines({ plan }).slice(1, 5)).toEqual([
      "  1. conversations.create name=design-review is_private=false",
      "  2. conversations.invite U01",
      '  3. conversations.setPurpose "why"',
      '  4. conversations.setTopic "what"',
    ]);
  });
});

describe("channelScopeHint", () => {
  it("names channels:manage for a PUBLIC create on the bot lane, and points at the lane that works", () => {
    const hint = channelScopeHint({ actor: "bot", isPrivate: false });

    expect(hint).toContain("channels:manage");
    expect(hint).toContain("--as me");
  });

  it("names groups:write for a PRIVATE create, on either lane", () => {
    expect(channelScopeHint({ actor: "bot", isPrivate: true })).toContain("groups:write");
    expect(channelScopeHint({ actor: "me", isPrivate: true })).toContain("groups:write");
  });

  it("names channels:write for a public create on the USER lane — a different scope from the bot's", () => {
    expect(channelScopeHint({ actor: "me", isPrivate: false })).toContain("channels:write");
  });
});

describe("the channel door requests", () => {
  const META = { createsWorkItem: false, effect: "external-write", home: HOME, requiresApproval: false };

  it("records a create's NAME and shape, never its purpose or topic prose", () => {
    const request = channelCreateDoorRequest({
      home: HOME,
      plan: {
        actor: "me",
        duplicateKey: "design-review",
        inviteUserIds: ["U01", "U02"],
        isPrivate: true,
        name: "design-review",
        purpose: "a place to review designs",
        topic: "this week: the console",
      },
    });
    expect(request).toEqual({
      action: { kind: "verb", noun: "slack", verb: "channel" },
      artifact: {
        actor: "me",
        duplicateKey: "design-review",
        inviteCount: 2,
        isPrivate: true,
        name: "design-review",
        operation: "create",
      },
      meta: META,
    });
  });

  it("records an invite's channel and count, never the people", () => {
    const request = channelInviteDoorRequest({
      home: HOME,
      plan: { actor: "bot", channel: "C1", duplicateKey: "C1:U01,U02", inviteUserIds: ["U01", "U02"] },
    });
    expect(request.artifact).toEqual({
      actor: "bot",
      channel: "C1",
      duplicateKey: "C1:U01,U02",
      inviteCount: 2,
      operation: "invite",
    });
  });

  it("records an archive as the channel and the lane alone", () => {
    expect(channelArchiveDoorRequest({ actor: "bot", channel: "C1", home: HOME }).artifact).toEqual({
      actor: "bot",
      channel: "C1",
      operation: "archive",
    });
  });
});
