/**
 * The whole preparation pass, over a dependency bag that cannot post.
 *
 * `planDripChecked.test.ts` covers the last step of this pipeline; what is asserted here is the pipeline —
 * that a caller handing `prepareDrip` a form gets back the same plan the send lane would build, and that
 * each earlier step's refusal still stops it. The bag is built from plain functions, so a step that quietly
 * stopped running drops a recorded read rather than changing an error message.
 */
import { describe, expect, it } from "vitest";

import type { SlackDripOptions } from "../../../../../cli/commands/slack/core.js";
import { sendOnlyDripRefusals } from "../../../../../cli/commands/slack/dripSendPlan.js";
import { type DripPrepareDeps, prepareDrip } from "../../../../../cli/commands/slack/prepareDrip.js";
import type { DripConfig } from "../../../../../cli/commands/slack/wiring.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { OneCardArtifact } from "../../../../../outbound/artifact/types.js";
import type { TaggedAccount } from "../../../../../outbound/slack/departedTags.js";
import type { ConversationMembership } from "../../../../../outbound/slack/dmMembership.js";
import type { MentionResolution } from "../../../../../outbound/slack/mentionIndex.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";

const CONFIG: DripConfig = {
  cardVisibleMax: 1000,
  exactVoiceRules: [],
  intervalMs: 0,
  maxBullets: 10,
  maxLines: 8,
  maxMessages: 8,
  messageVisibleMax: 300,
  paragraphSpacing: false,
  soleMessageVisibleMax: 1000,
};

const RESOLUTION: MentionResolution = {
  groupAddresses: new Map(),
  heldRequested: [],
  memberLookups: new Map(),
  resolved: new Map(),
  roster: { addressableKeys: 3, collisions: [], derivedPeople: 2, freshness: { kind: "fresh" }, heldPeople: 0 },
};

/** A one-card form, which is the shape a parked as-me post takes. */
function oneCard({ lines }: { lines: readonly string[] }): OneCardArtifact {
  return { kind: "one-card", lines: lines.map((text) => ({ runs: [{ text, type: "text" as const }] })) };
}

function options({ json }: { json: string }): SlackDripOptions {
  return {
    actor: "me",
    channel: "C1",
    dryRun: false,
    home: "/home",
    json: false,
    media: [],
    resendUnconfirmed: false,
    shape: "top-level",
    source: { json, kind: "form" },
    verb: "post",
  };
}

/** A group DM of three, the shape of the one the membership check was cut against. */
const GROUP_DM: ConversationMembership = {
  directMessage: true,
  kind: "read",
  members: new Set(["U0OWNER", "U0ROSA", "U0FELIX"]),
};

/** An account the live roster says is still here. */
const LIVE: TaggedAccount = { deleted: false, kind: "read", name: "someone" };

/** A resolution that tagged each key to the id given. */
function resolvedTo({ targets }: { targets: Readonly<Record<string, string>> }): MentionResolution {
  return {
    ...RESOLUTION,
    resolved: new Map(Object.entries(targets).map(([key, slackId]) => [key, { origin: "member" as const, slackId }])),
  };
}

/** A one-card line opening on a mention of each key, the shape a DM post tagging people takes. */
function mentioning({ keys }: { keys: readonly string[] }): string {
  const artifact: OneCardArtifact = {
    kind: "one-card",
    lines: keys.map((person) => ({
      runs: [
        { person, type: "mention" as const },
        { text: " one step for you", type: "text" as const },
      ],
    })),
  };
  return JSON.stringify(artifact);
}

/** A recording world with no send edge anywhere in it. `reads` is what a dropped step would shorten. */
function prepareDeps({
  reads,
  stdin,
  membership = { directMessage: false, kind: "read", members: new Set() },
  resolveMentions = () => RESOLUTION,
  accounts = new Map(),
}: {
  reads: string[];
  stdin: string;
  membership?: ConversationMembership;
  resolveMentions?: (args: Parameters<DripPrepareDeps["resolveMentions"]>[0]) => MentionResolution;
  accounts?: ReadonlyMap<string, TaggedAccount>;
}): DripPrepareDeps {
  return {
    taggedAccount: async ({ user }) => {
      reads.push(`taggedAccount:${user}`);
      const known = accounts.get(user);
      if (known !== undefined) {
        return known;
      }
      return LIVE;
    },
    bareRefContext: () => {
      reads.push("bareRefContext");
      return { repos: [] };
    },
    conversationMembership: async () => {
      reads.push("conversationMembership");
      return membership;
    },
    conversationSurface: async () => {
      reads.push("conversationSurface");
      return "private-channel";
    },
    promptChannel: () => {
      reads.push("promptChannel");
      return "D0PROMPT";
    },
    readStdin: async () => {
      reads.push("readStdin");
      return stdin;
    },
    recordVoicePainPoints: () => {
      reads.push("recordVoicePainPoints");
    },
    resolveMentions: async (args) => {
      reads.push("resolveMentions");
      return ok(resolveMentions(args));
    },
    wallRun: async () => {
      reads.push("wallRun");
      return ok({ length: 0 });
    },
    highStakes: () => ok({ channels: [], fleetGap: undefined, fleetUserIds: [], listGap: undefined }),
    threadAnchor: async () => ({ kind: "present" as const }),
    channelClaim: () => ({ kind: "free" as const }),
    releaseChannelClaim: () => undefined,
    fleetHistory: async () => {
      reads.push("fleetHistory");
      return { kind: "read", priors: [] };
    },
  };
}

describe("prepareDrip — everything an as-me send does before it can post", () => {
  it("reads the form from stdin and returns the plan the send lane would send", async () => {
    const reads: string[] = [];
    const deps = prepareDeps({ reads, stdin: JSON.stringify(oneCard({ lines: ["Morning all.", "One question."] })) });
    const result = await prepareDrip({
      config: CONFIG,
      deps,
      env: {},
      options: options({ json: "-" }),
      token: "xoxp-test",
    });
    expect(result.isOk()).toBe(true);
    const prepared = unwrap(result);
    expect(prepared.plan.messages.length).toBe(1);
    expect(prepared.plan.channel).toBe("C1");
    expect(prepared.plan.artifact.kind).toBe("one-card");
    expect(prepared.config.maxMessages).toBe(8);
    expect(prepared.allowVoiceRules).toBe(false);
    // The exact pipeline, in order. A one-message top-level post never pays for the surface read, and the
    // wall read belongs to the send half — so neither appears, and a seam that grew one would show here.
    expect(reads).toEqual(["readStdin", "bareRefContext", "resolveMentions"]);
  });

  it("judges the words against the config its caller read, since it no longer reads one of its own", async () => {
    const reads: string[] = [];
    const rules: DripConfig["exactVoiceRules"] = [{ kind: "literal", value: "§" }];
    const deps = prepareDeps({ reads, stdin: JSON.stringify(oneCard({ lines: ["Morning § all."] })) });
    const result = await prepareDrip({
      config: { ...CONFIG, exactVoiceRules: rules },
      deps,
      env: {},
      options: options({ json: "-" }),
      token: "xoxp-test",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).config.exactVoiceRules).toEqual(rules);
    expect(unwrap(result).plan.messages.length).toBe(1);
    // The rule it was handed fired: the pain point is recorded, which the same words under CONFIG never do.
    expect(reads).toEqual(["readStdin", "recordVoicePainPoints", "bareRefContext", "resolveMentions"]);
  });

  it("refuses a form that is not valid JSON, before anything else is read", async () => {
    const reads: string[] = [];
    const deps = prepareDeps({ reads, stdin: "{not json" });
    const result = await prepareDrip({
      config: CONFIG,
      deps,
      env: {},
      options: options({ json: "-" }),
      token: "xoxp-test",
    });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).join(" ")).toContain("--form is not valid JSON");
    expect(reads).toEqual(["readStdin"]);
  });

  it("refuses a one-card line carrying literal bold markers, which would show a reader the asterisks", async () => {
    const reads: string[] = [];
    const deps = prepareDeps({ reads, stdin: JSON.stringify(oneCard({ lines: ["*not actually bold*"] })) });
    const result = await prepareDrip({
      config: CONFIG,
      deps,
      env: {},
      options: options({ json: "-" }),
      token: "xoxp-test",
    });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result).join(" ")).toContain("shows its *bold* markers to a reader");
    expect(reads).toEqual(["readStdin", "bareRefContext", "resolveMentions"]);
  });
});

describe("prepareDrip — mentions judged against the conversation the message posts into", () => {
  it("hands the conversation's members to the roster lookup, read once and only because the form mentions someone", async () => {
    const reads: string[] = [];
    const seen: (ReadonlySet<string> | undefined)[] = [];
    const deps = prepareDeps({
      membership: GROUP_DM,
      reads,
      resolveMentions: ({ conversationMembers }) => {
        seen.push(conversationMembers);
        return resolvedTo({ targets: { U0FELIX: "U0FELIX" } });
      },
      stdin: mentioning({ keys: ["U0FELIX"] }),
    });
    const result = await prepareDrip({ config: CONFIG, deps, env: {}, options: options({ json: "-" }), token: "xoxp" });
    expect(result.isOk()).toBe(true);
    expect(seen.map((members) => [...members!].toSorted())).toEqual([["U0FELIX", "U0OWNER", "U0ROSA"]]);
    expect(reads).toEqual([
      "readStdin",
      "bareRefContext",
      "conversationMembership",
      "resolveMentions",
      "promptChannel",
      "taggedAccount:U0FELIX",
    ]);
  });

  it("REFUSES a tag of somebody who is not in the DM, naming the key, the id and who is in it", async () => {
    const deps = prepareDeps({
      membership: GROUP_DM,
      reads: [],
      resolveMentions: () => resolvedTo({ targets: { "seth tanner": "U0SETH", rosa: "U0ROSA" } }),
      stdin: mentioning({ keys: ["rosa", "seth tanner"] }),
    });
    const result = await prepareDrip({ config: CONFIG, deps, env: {}, options: options({ json: "-" }), token: "xoxp" });
    expect(unwrapErr(result)).toEqual([
      "REFUSING to tag somebody who is not in direct message C1: a DM's members are fixed, so the person tagged " +
        "cannot read it and Slack notifies nobody.",
      '  "seth tanner" is U0SETH, who is not a member.',
      "  in this DM: U0FELIX, U0OWNER, U0ROSA",
      "There is deliberately NO escape hatch: drop the tag, or post where they are.",
    ]);
  });

  it("does not hold a non-member tag in a channel, where a tag is how somebody is pulled in", async () => {
    const deps = prepareDeps({
      membership: { directMessage: false, kind: "read", members: new Set(["U0OWNER"]) },
      reads: [],
      resolveMentions: () => resolvedTo({ targets: { "seth tanner": "U0SETH" } }),
      stdin: mentioning({ keys: ["seth tanner"] }),
    });
    const result = await prepareDrip({ config: CONFIG, deps, env: {}, options: options({ json: "-" }), token: "xoxp" });
    expect(unwrap(result).resolution.resolved.get("seth tanner")!.slackId).toBe("U0SETH");
  });

  it("does not hold a tag in the owner's bot DM, where it is a reference the bot reads", async () => {
    const deps = prepareDeps({
      membership: { directMessage: true, kind: "read", members: new Set(["U0OWNER", "U0BOT"]) },
      reads: [],
      resolveMentions: () => resolvedTo({ targets: { "seth tanner": "U0SETH" } }),
      stdin: mentioning({ keys: ["seth tanner"] }),
    });
    const result = await prepareDrip({
      config: CONFIG,
      deps,
      env: {},
      options: { ...options({ json: "-" }), channel: "D0PROMPT" },
      token: "xoxp",
    });
    expect(unwrap(result).resolution.resolved.get("seth tanner")!.slackId).toBe("U0SETH");
  });

  it("hands the lookup NO members when the read failed, so a failed read can only leave an outsider refused", async () => {
    const seen: (ReadonlySet<string> | undefined)[] = [];
    const deps = prepareDeps({
      membership: { cause: "missing_scope", kind: "unreadable" },
      reads: [],
      resolveMentions: ({ conversationMembers }) => {
        seen.push(conversationMembers);
        return resolvedTo({ targets: { "seth tanner": "U0SETH" } });
      },
      stdin: mentioning({ keys: ["seth tanner"] }),
    });
    const result = await prepareDrip({ config: CONFIG, deps, env: {}, options: options({ json: "-" }), token: "xoxp" });
    expect(result.isOk()).toBe(true);
    expect(seen).toEqual([undefined]);
  });
});

describe("prepareDrip — every tag read off Slack's live roster (a draft tagged Noel weeks after they left)", () => {
  it("REFUSES a tag of a deactivated account, naming who, even though the roster resolved the id", async () => {
    const reads: string[] = [];
    const deps = prepareDeps({
      accounts: new Map([["U0NOEL", { deleted: true, kind: "read", name: "nicholas.hairs" }]]),
      reads,
      resolveMentions: () => resolvedTo({ targets: { U0NOEL: "U0NOEL", U0SETH: "U0SETH" } }),
      stdin: mentioning({ keys: ["U0NOEL", "U0SETH"] }),
    });
    const result = await prepareDrip({ config: CONFIG, deps, env: {}, options: options({ json: "-" }), token: "xoxp" });
    expect(unwrapErr(result)).toEqual([
      "nicholas.hairs (<@U0NOEL>) is deactivated in Slack: they have left, so a message tagging them reads as if " +
        "nobody noticed. Drop the tag, and tag whoever holds their work now.",
    ]);
    expect(reads.filter((read) => read.startsWith("taggedAccount:"))).toEqual([
      "taggedAccount:U0NOEL",
      "taggedAccount:U0SETH",
    ]);
  });

  it("REFUSES a tag Slack would not describe, since a check that could not run checked nothing", async () => {
    const deps = prepareDeps({
      accounts: new Map([["U0SETH", { cause: "ratelimited", kind: "unreadable" }]]),
      reads: [],
      resolveMentions: () => resolvedTo({ targets: { "seth tanner": "U0SETH" } }),
      stdin: mentioning({ keys: ["seth tanner"] }),
    });
    const result = await prepareDrip({ config: CONFIG, deps, env: {}, options: options({ json: "-" }), token: "xoxp" });
    expect(unwrapErr(result)).toEqual([
      "could not read <@U0SETH> off Slack's live roster (ratelimited), so whether they still work here is unknown " +
        "and nothing goes out tagging them. Re-run once Slack answers, or drop the tag.",
    ]);
  });

  it("reads one account per distinct id, a self-resolved one included", async () => {
    const reads: string[] = [];
    const deps = prepareDeps({
      reads,
      resolveMentions: () => ({
        ...RESOLUTION,
        resolved: new Map([
          ["seth tanner", { origin: "member" as const, slackId: "U0SETH" }],
          ["@seth", { origin: "member" as const, slackId: "U0SETH" }],
          ["me", { origin: "self" as const, slackId: "U0OWNER" }],
        ]),
      }),
      stdin: mentioning({ keys: ["seth tanner", "@seth", "me"] }),
    });
    const result = await prepareDrip({ config: CONFIG, deps, env: {}, options: options({ json: "-" }), token: "xoxp" });
    expect(result.isOk()).toBe(true);
    expect(reads.filter((read) => read.startsWith("taggedAccount:"))).toEqual([
      "taggedAccount:U0SETH",
      "taggedAccount:U0OWNER",
    ]);
  });

  it("REFUSES with the roster's own message when the store cannot say who anyone is, tagging nobody", async () => {
    const outage = IdentityRosterErrors.storeUnavailable({ doing: "be opened", reason: "no database is selected" });
    const reads: string[] = [];
    const deps: DripPrepareDeps = {
      ...prepareDeps({ reads, stdin: mentioning({ keys: ["seth tanner"] }) }),
      resolveMentions: async () => err(outage),
    };
    const result = await prepareDrip({ config: CONFIG, deps, env: {}, options: options({ json: "-" }), token: "xoxp" });
    expect(unwrapErr(result)).toEqual([outage.message]);
    expect(reads.filter((read) => read.startsWith("taggedAccount:"))).toEqual([]);
  });

  it("reads nothing off the roster for a message that tags nobody", async () => {
    const reads: string[] = [];
    const deps = prepareDeps({ reads, stdin: JSON.stringify(oneCard({ lines: ["Morning all."] })) });
    const result = await prepareDrip({ config: CONFIG, deps, env: {}, options: options({ json: "-" }), token: "xoxp" });
    expect(result.isOk()).toBe(true);
    expect(reads.filter((read) => read.startsWith("taggedAccount:"))).toEqual([]);
  });
});

describe("sendOnlyDripRefusals — the half a recorder cannot reach", () => {
  it("passes a typed one-card top-level post without ever calling the proof or the wall read", async () => {
    const reads: string[] = [];
    const prepareWorld = prepareDeps({
      reads,
      stdin: JSON.stringify(oneCard({ lines: ["Morning all.", "One question."] })),
    });
    const prepared = await prepareDrip({
      config: CONFIG,
      deps: prepareWorld,
      env: {},
      options: options({ json: "-" }),
      token: "xoxp-test",
    });
    const sendReads: string[] = [];
    const refusals = await sendOnlyDripRefusals({
      config: CONFIG,
      deps: {
        conversationSurface: async () => {
          sendReads.push("conversationSurface");
          return "public-channel";
        },
        proveRender: async () => {
          sendReads.push("proveRender");
          return { issues: [], kind: "checked" as const };
        },
        wallRun: async () => {
          sendReads.push("wallRun");
          return ok({ length: 0 });
        },
      },
      env: {},
      options: options({ json: "-" }),
      plan: unwrap(prepared).plan,
      token: "xoxp-test",
    });
    expect(refusals).toEqual([]);
    // A typed form needs no render proof (its blocks are built here, not parsed by Slack), and a
    // top-level post has no thread to measure a wall in. Both absences are the reason this case exists.
    expect(sendReads).toEqual([]);
  });

  it("REFUSES a raw body whose proof round trip could not be completed", async () => {
    const plan = unwrap(
      await prepareDrip({
        config: CONFIG,
        deps: prepareDeps({ reads: [], stdin: "" }),
        env: {},
        options: { ...options({ json: "-" }), source: { kind: "body", text: "Morning all." } },
        token: "xoxp-test",
      }),
    ).plan;
    const refusals = await sendOnlyDripRefusals({
      config: { ...CONFIG, renderProofChannel: "D0PROOF" },
      deps: {
        conversationSurface: async () => "public-channel",
        proveRender: async () => ({ kind: "unprovable" as const, reason: "not_in_channel" }),
        wallRun: async () => ok({ length: 0 }),
      },
      env: {},
      options: { ...options({ json: "-" }), source: { kind: "body", text: "Morning all." } },
      plan,
      token: "xoxp-test",
    });
    expect(refusals.join(" ")).toContain("could not be completed");
    expect(refusals.join(" ")).toContain("not_in_channel");
  });
});
