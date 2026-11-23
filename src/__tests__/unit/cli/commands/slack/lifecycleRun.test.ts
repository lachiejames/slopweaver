/*
 * The `progress` refusal case and the metadata assertion for the progress verb went out with the verb
 * family itself — one progress-card shape is left in outbound comms, on the owner's ruling, so there is no
 * handler left for either of them to hold down. That deletion has LANDED, so the `deleted-with-code:`
 * marker that accounted for it is spent and has been removed: its symbol is already gone at every base a
 * future diff will be measured against, so leaving it here would refuse the next diff that touches this
 * file for a loss this file no longer takes.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { parseDeleteArgs, parseEditArgs } from "../../../../../cli/commands/slack/lifecycleCore.js";
import type { LifecycleDeps } from "../../../../../cli/commands/slack/lifecycleRun.js";
import {
  runLifecycleWithDeps,
  slackDeleteCommand,
  slackEditCommand,
} from "../../../../../cli/commands/slack/lifecycleRun.js";
import type { VerifyOwnDm } from "../../../../../cli/commands/slack/verifiedOwnDm.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type {
  DeleteMessageOutcome,
  PostedMessage,
  SlackWriteTransport,
} from "../../../../../corpus/slack/writeTransport.js";
import { ok } from "../../../../../lib/result.js";
import { BOT_FORM_KINDS } from "../../../../../outbound/artifact/botFormKinds.js";
import { ASSISTANT_ANSWER_EVENT_TYPE_V2 } from "../../../../../outbound/assistant/answerMessage.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../../../../outbound/slack/lifecycleGuards.js";
import type { MentionResolution } from "../../../../../outbound/slack/mentionIndex.js";
import { NO_FOLD_RENDERER } from "../../../../../outbound/slack/noFold.js";
import { DEFAULT_TURN_METADATA_EVENT_TYPE } from "../../../../../profile.js";
import { readExactVoiceRules } from "../../../../../profileStore.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { NOTHING_PROVEN, PROMPT_DM, PROMPT_DM_IS_OWNERS, recordingOwnDm } from "./ownDmFakes.js";

/**
 * A dependency set where every member throws on use — a plain fake, not a mock.
 *
 * `slack edit` and `delete` are both door-routed external writes, and this module had no test
 * importing it at all. The property pinned here is that a REFUSED invocation reaches no dependency: it
 * cannot read a token, call Slack, or touch the ledger. Anything it does touch throws and fails the test.
 */
function landmineDeps(): LifecycleDeps {
  return new Proxy(
    {},
    {
      get: (_target, property) => () => {
        throw new Error(`refusal path touched dependency \`${String(property)}\``);
      },
    },
  ) as LifecycleDeps;
}

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "slack", ...tail];
}

/** Who this token is — the bot itself, matching the fixture message's own botId/userId. */
const SELF: SlackSelfIdentity = { botId: "B_SELF", teamId: "T1", userId: "U_SELF" };

/** A genuine V2 assistant answer, exactly as `renderAssistantAnswer` stamps one — this bot's own message. */
const V2_ANSWER_MESSAGE: ReadSlackMessage = {
  botId: "B_SELF",
  fileIds: [],
  metadataEventType: ASSISTANT_ANSWER_EVENT_TYPE_V2,
  renderer: "slack-assistant-answer-v2",
  ts: "1700000000.000100",
  userId: "U_SELF",
};

/** A genuine static turn checklist, stamped by `renderTurnMessage` from its first frame. */
const TURN_MESSAGE: ReadSlackMessage = {
  botId: "B_SELF",
  fileIds: [],
  metadataEventType: DEFAULT_TURN_METADATA_EVENT_TYPE,
  renderer: "slack-turn-v1",
  ts: "1700000000.000200",
  userId: "U_SELF",
};

/** A card form that is valid in every respect, so the refusal under test is the ONLY thing that can stop it. */
const VALID_CARD_FORM = JSON.stringify({
  detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
  kind: "update",
  tldr: "A short lead.",
});

/**
 * A genuine NO-FOLD message, stamped by `renderNoFoldMessage` — this bot's own, and carrying the CARD's own
 * `metadata.event_type` exactly as the renderer does, so `expectedEventTypes` accepts it and the refusal
 * under test is reached rather than being masked by an earlier one.
 */
const NO_FOLD_MESSAGE: ReadSlackMessage = {
  botId: "B_SELF",
  fileIds: [],
  metadataEventType: "test_card_v1",
  renderer: NO_FOLD_RENDERER,
  ts: "1700000000.000300",
  userId: "U_SELF",
};

/**
 * A transport implementing only `readMessage`/`whoAmI`/`deleteMessageOnce` for real; every other method
 * throws if touched, same discipline as {@link landmineDeps}. `delete`'s success path needs nothing else.
 *
 * `deleteMessageOnce` rather than `deleteMessage` is the assertion, not an incidental rename: the retrying
 * `deleteMessage` is a landmine here, so this fake reddens if the bot lane ever goes back to it.
 */
function fakeDeleteTransport({
  deleted,
  message,
}: {
  deleted: { calls: number };
  message: ReadSlackMessage;
}): SlackWriteTransport {
  const real = {
    deleteMessageOnce: async (): Promise<DeleteMessageOutcome> => {
      deleted.calls += 1;
      return { kind: "gone" };
    },
    readMessage: async ({ posted }: { posted: PostedMessage }): Promise<ReadSlackMessage | undefined> =>
      posted.ts === message.ts ? message : undefined,
    whoAmI: async (): Promise<SlackSelfIdentity> => SELF,
  };
  return new Proxy(real, {
    get: (target, property) =>
      property in target
        ? (target as unknown as Record<string, unknown>)[property as string]
        : () => {
            throw new Error(`slack delete touched transport method \`${String(property)}\` it should not need`);
          },
  }) as unknown as SlackWriteTransport;
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp home — `runDelete`'s success path writes a real door-ledger line into it. */
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-slack-delete-"));
  fixtureDirs.push(dir);
  return dir;
}

/** Every dependency `runDelete` calls before reaching the transport, plus the transport itself. */
function deleteDeps({
  deleted,
  message,
  voiceRules,
  highStakesChannels = [],
  ownDm = PROMPT_DM_IS_OWNERS,
  door = memoryDoorLedger(),
}: {
  deleted: { calls: number };
  door?: { readonly port: DoorLedgerPort };
  message: ReadSlackMessage;
  voiceRules?: ReturnType<LifecycleDeps["voiceRules"]>;
  highStakesChannels?: readonly { readonly id: string; readonly name: string }[];
  ownDm?: VerifyOwnDm;
}): LifecycleDeps {
  return new Proxy(
    {
      doorLedger: door.port,
      highStakes: () => ok({ channels: highStakesChannels, fleetGap: undefined, fleetUserIds: [], listGap: undefined }),
      // Present only for a test that reaches the voice read, which every edit makes before its first Slack call;
      // every other test keeps it a landmine.
      ...(voiceRules === undefined ? {} : { voiceRules: () => voiceRules }),
      // A confirmed delete journals itself into the draft register, stamped by this clock (`lifecycleDraftDeletion.ts`).
      journalDraftDeletion: () => ok([]),
      nowIso: () => "2026-09-28T00:00:00.000Z",
      botToken: () => "xoxb-fake",
      cardChrome: () => ({
        authorEmoji: ":robot_face:",
        authorLabel: "test-bot",
        bannerColor: "#12B5A6",
        detailLabel: "*Details*",
        metadataEventType: "test_card_v1",
      }),
      // The three `cardFromForm` needs. They are here rather than in a second fake because the no-fold
      // TARGET test runs `edit` through this same bag, and a landmine on them would fail that test for the
      // wrong reason — long before the refusal it is actually about.
      bareRefContext: () => ({ linearTeamKeys: [], repos: [] }),
      doorEnv: () => ({}),
      // The standalone progress event type: `delete` recognises a stranded spinner as this
      // bot's own, which is the only way one left behind by the deleted verb family comes down.
      standaloneProgressEventType: () => "test_progress_v1",
      makeTransport: () => fakeDeleteTransport({ deleted, message }),
      out: () => undefined,
      pollEventType: () => "test_poll_v1",
      resolveMentions: async () =>
        ok({
          groupAddresses: new Map(),
          heldBack: [],
          resolved: new Map(),
          roster: { addressableKeys: 0, collisions: [], derivedPeople: 0, freshness: { kind: "fresh" }, heldPeople: 0 },
        }),
      verifiedOwnDm: ownDm,
    },
    {
      get: (target, property) =>
        property in target
          ? (target as unknown as Record<string, unknown>)[property as string]
          : () => {
              throw new Error(`slack delete touched dependency \`${String(property)}\` it should not need`);
            },
    },
  ) as unknown as LifecycleDeps;
}

/** A resolution with nobody mentioned — every `--as me` test here sends a plain, mention-free message. */
const NO_MENTIONS: MentionResolution = {
  groupAddresses: new Map(),
  heldRequested: [],
  memberLookups: new Map(),
  resolved: new Map(),
  roster: { addressableKeys: 0, collisions: [], derivedPeople: 0, freshness: { kind: "fresh" }, heldPeople: 0 },
};

/** A human's own message — no `bot_id` at all, which is exactly what the bot-lane guard would refuse. */
const HUMAN_MESSAGE: ReadSlackMessage = { fileIds: [], ts: "1700000000.000300", userId: "U_HUMAN" };

/**
 * A transport implementing only `readMessage`/`updateDripMessage` for real — `--as me` edit's success path
 * needs nothing else, and in particular never calls `whoAmI` (there is no ownership check to run it for).
 */
function fakeAsMeEditTransport({
  updated,
  message,
}: {
  updated: { calls: number; fileIds: readonly string[] | undefined };
  message: ReadSlackMessage;
}): SlackWriteTransport {
  const real = {
    readMessage: async ({ posted }: { posted: PostedMessage }): Promise<ReadSlackMessage | undefined> =>
      posted.ts === message.ts ? message : undefined,
    updateDripMessage: async ({ fileIds }: { fileIds: readonly string[] }): Promise<void> => {
      updated.calls += 1;
      updated.fileIds = fileIds;
    },
  };
  return new Proxy(real, {
    get: (target, property) =>
      property in target
        ? (target as unknown as Record<string, unknown>)[property as string]
        : () => {
            throw new Error(`slack edit --as me touched transport method \`${String(property)}\` it should not need`);
          },
  }) as unknown as SlackWriteTransport;
}

/**
 * Every dependency `runEditAsMe` calls, plus the transport. The Proxy's throwing default is the actual
 * assertion: `botToken`/`cardChrome`/`pollEventType` — everything the bot-card ownership
 * guard would need — are absent on purpose, so touching any of them fails the test.
 */
function asMeEditDeps({
  updated,
  message,
  highStakesChannels = [],
  mentions = NO_MENTIONS,
  departed = [],
  ownDm = PROMPT_DM_IS_OWNERS,
  door = memoryDoorLedger(),
}: {
  updated: { calls: number; fileIds: readonly string[] | undefined };
  door?: { readonly port: DoorLedgerPort };
  message: ReadSlackMessage;
  highStakesChannels?: readonly { readonly id: string; readonly name: string }[];
  mentions?: MentionResolution;
  departed?: readonly string[];
  ownDm?: VerifyOwnDm;
}): LifecycleDeps {
  return new Proxy(
    {
      doorLedger: door.port,
      highStakes: () => ok({ channels: highStakesChannels, fleetGap: undefined, fleetUserIds: [], listGap: undefined }),
      bareRefContext: () => ({ repos: [] }),
      doorEnv: () => ({}),
      dripConfig: () => ok({ exactVoiceRules: [], intervalMs: 1500, maxMessages: 8, messageVisibleMax: 300 }),
      makeTransport: () => fakeAsMeEditTransport({ message, updated }),
      out: () => undefined,
      recordVoicePainPoints: () => undefined,
      resolveMentions: async () => ok(mentions),
      // Reached only by a test whose body tags somebody; NO_MENTIONS never asks it.
      taggedAccount: async ({ user }: { user: string }) => ({
        deleted: departed.includes(user),
        kind: "read" as const,
        name: undefined,
      }),
      userToken: () => "xoxp-fake",
      verifiedOwnDm: ownDm,
    },
    {
      get: (target, property) =>
        property in target
          ? (target as unknown as Record<string, unknown>)[property as string]
          : () => {
              throw new Error(`slack edit --as me touched dependency \`${String(property)}\` it should not need`);
            },
    },
  ) as unknown as LifecycleDeps;
}

describe("slack edit --as me", () => {
  it("edits a human's own message with no ownership check, via the USER token", async () => {
    const updated = { calls: 0, fileIds: undefined as readonly string[] | undefined };
    const home = freshHome();
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: [
          "edit",
          "--channel",
          "C1",
          "--ts",
          HUMAN_MESSAGE.ts,
          "--as",
          "me",
          "--body",
          "fixed the broken link",
          "--home",
          home,
        ],
      }),
      deps: asMeEditDeps({ message: HUMAN_MESSAGE, updated }),
      parse: parseEditArgs,
    });

    expect(code).toBe(EXIT_OK);
    expect(updated.calls).toBe(1);
  });

  it.each([
    {
      channel: "C1",
      expected: EXIT_USAGE,
      name: "refuses an edit opening on a pull request, updating nothing",
      ownDm: PROMPT_DM_IS_OWNERS,
      writes: 0,
    },
    {
      channel: PROMPT_DM,
      expected: EXIT_OK,
      name: "makes the same edit in the owner's own bot DM",
      ownDm: PROMPT_DM_IS_OWNERS,
      writes: 1,
    },
    {
      channel: PROMPT_DM,
      expected: EXIT_USAGE,
      name: "refuses it in a colleague's DM configured as the owner's prompt channel",
      ownDm: NOTHING_PROVEN,
      writes: 0,
    },
  ])("$name", async ({ channel, expected, ownDm, writes }) => {
    const updated = { calls: 0, fileIds: undefined as readonly string[] | undefined };
    const seam = recordingOwnDm({ answer: ownDm });
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: [
          "edit",
          "--channel",
          channel,
          "--ts",
          HUMAN_MESSAGE.ts,
          "--as",
          "me",
          "--body",
          "Approve the fix PR for the gateway outage, so events recover.",
          "--home",
          freshHome(),
        ],
      }),
      deps: asMeEditDeps({ message: HUMAN_MESSAGE, ownDm: seam.verify, updated }),
      parse: parseEditArgs,
    });

    expect(code).toBe(expected);
    expect(seam.asked).toEqual([channel]);
    expect(updated.calls).toBe(writes);
  });

  it("refuses an edit tagging somebody Slack has deactivated, updating nothing", async () => {
    const updated = { calls: 0, fileIds: undefined as readonly string[] | undefined };
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: [
          "edit",
          "--channel",
          "C1",
          "--ts",
          HUMAN_MESSAGE.ts,
          "--as",
          "me",
          "--body",
          "<@U0NOEL> can you look at this",
          "--home",
          freshHome(),
        ],
      }),
      deps: asMeEditDeps({
        departed: ["U0NOEL"],
        mentions: { ...NO_MENTIONS, resolved: new Map([["U0NOEL", { origin: "member", slackId: "U0NOEL" }]]) },
        message: HUMAN_MESSAGE,
        updated,
      }),
      parse: parseEditArgs,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(updated.calls).toBe(0);
  });

  it("writes nothing and exits with the error code when the door record cannot be written", async () => {
    const updated = { calls: 0, fileIds: undefined as readonly string[] | undefined };
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: [
          "edit",
          "--channel",
          "C1",
          "--ts",
          HUMAN_MESSAGE.ts,
          "--as",
          "me",
          "--body",
          "hi",
          "--home",
          freshHome(),
        ],
      }),
      deps: asMeEditDeps({ door: { port: unreachableDoorLedger() }, message: HUMAN_MESSAGE, updated }),
      parse: parseEditArgs,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(updated.calls).toBe(0);
  });

  it("refuses without a Slack USER token, touching no transport", async () => {
    const deps = new Proxy(
      // The voice-briefing gate reads `doorEnv` first; naming no session, it admits without its clock or a receipt.
      { doorEnv: () => ({}), userToken: () => undefined },
      {
        get: (target, property) =>
          property in target
            ? (target as unknown as Record<string, unknown>)[property as string]
            : () => {
                throw new Error(`refusal path touched dependency \`${String(property)}\``);
              },
      },
    ) as unknown as LifecycleDeps;
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: ["edit", "--channel", "C1", "--ts", "1.1", "--as", "me", "--body", "hi"],
      }),
      deps,
      parse: parseEditArgs,
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it.each([
    { expected: EXIT_USAGE, message: HUMAN_MESSAGE, name: "refuses a top-level message", writes: 0 },
    {
      expected: EXIT_OK,
      message: { ...HUMAN_MESSAGE, threadTs: "1700000000.000100" },
      name: "lets a reply through",
      writes: 1,
    },
  ])("in a high-stakes channel, $name", async ({ expected, message, writes }) => {
    const updated = { calls: 0, fileIds: undefined as readonly string[] | undefined };
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: ["edit", "--channel", "C1", "--ts", message.ts, "--as", "me", "--body", "hi", "--home", freshHome()],
      }),
      deps: asMeEditDeps({ highStakesChannels: [{ id: "C1", name: "#defects" }], message, updated }),
      parse: parseEditArgs,
    });
    expect(code).toBe(expected);
    expect(updated.calls).toBe(writes);
  });

  it("refuses a target message that is not there, touching no transport write", async () => {
    const updated = { calls: 0, fileIds: undefined as readonly string[] | undefined };
    const deps = asMeEditDeps({ message: HUMAN_MESSAGE, updated });
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: ["edit", "--channel", "C1", "--ts", "9999999999.000000", "--as", "me", "--body", "hi"],
      }),
      deps,
      parse: parseEditArgs,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(updated.calls).toBe(0);
  });

  it("stops over a CORRUPT profile before stdin or Slack, rather than editing under the default bounds", async () => {
    const corrupt = freshHome();
    writeFileSync(join(corrupt, "profile.json"), "{", "utf8");
    const touched: string[] = [];
    // The voice-briefing gate reads the same profile before the token or the config, so it is the one that stops
    // here: stdin, mentions and the transport throw if reached, and its clock is never called with no session.
    const deps = new Proxy(
      { doorEnv: () => ({}) },
      {
        get: (target, property) => {
          touched.push(String(property));
          return property in target
            ? (target as unknown as Record<string, unknown>)[property as string]
            : () => {
                throw new Error(`corrupt-profile path touched dependency \`${String(property)}\``);
              };
        },
      },
    ) as unknown as LifecycleDeps;
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: ["edit", "--channel", "C1", "--ts", "1.1", "--as", "me", "--body", "-", "--home", corrupt],
      }),
      deps,
      parse: parseEditArgs,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(touched).toEqual(["doorEnv", "nowIso"]);
  });
});

/**
 * A transport implementing only `deleteMessage` — `--as me` delete needs nothing else, and in particular
 * never calls `readMessage` or `whoAmI`: there is no ownership check to read a message back for.
 */
function fakeAsMeDeleteTransport({ deleted }: { deleted: { calls: number } }): SlackWriteTransport {
  const real = {
    deleteMessage: async (): Promise<boolean> => {
      deleted.calls += 1;
      return true;
    },
  };
  return new Proxy(real, {
    get: (target, property) =>
      property in target
        ? (target as unknown as Record<string, unknown>)[property as string]
        : () => {
            throw new Error(`slack delete --as me touched transport method \`${String(property)}\` it should not need`);
          },
  }) as unknown as SlackWriteTransport;
}

describe("slack delete --as me", () => {
  it("deletes a human's own message with no ownership check, via the USER token", async () => {
    const deleted = { calls: 0 };
    const home = freshHome();
    const deps = new Proxy(
      {
        doorLedger: memoryDoorLedger().port,
        journalDraftDeletion: () => ok([]),
        makeTransport: () => fakeAsMeDeleteTransport({ deleted }),
        nowIso: () => "2026-09-28T00:00:00.000Z",
        out: () => undefined,
        userToken: () => "xoxp-fake",
      },
      {
        get: (target, property) =>
          property in target
            ? (target as unknown as Record<string, unknown>)[property as string]
            : () => {
                throw new Error(`slack delete --as me touched dependency \`${String(property)}\` it should not need`);
              },
      },
    ) as unknown as LifecycleDeps;

    const code = await runLifecycleWithDeps({
      argv: argv({ tail: ["delete", "--channel", "C1", "--ts", HUMAN_MESSAGE.ts, "--as", "me", "--home", home] }),
      deps,
      parse: parseDeleteArgs,
    });

    expect(code).toBe(EXIT_OK);
    expect(deleted.calls).toBe(1);
  });
});

/**
 * The real F4 regression guard: `slack delete` must be able to delete a GENUINE V2 assistant answer, not
 * merely recognise its renderer in isolation. The existing `messageOwnership` unit test proved the renderer
 * is in `KNOWN_RENDERERS`, but that alone "passed for the wrong reason" — `runDelete`'s own
 * `expectedEventTypes` had to widen too, or the event-type check refuses before the renderer is ever
 * inspected. This exercises the whole command, not the guard in isolation.
 */
describe("slack delete — a real V2 assistant answer", () => {
  it("deletes it, proving the verb's own expectedEventTypes carry the V2 event type end to end", async () => {
    const deleted = { calls: 0 };
    const home = freshHome();
    const code = await runLifecycleWithDeps({
      argv: argv({ tail: ["delete", "--channel", "C1", "--ts", V2_ANSWER_MESSAGE.ts, "--home", home] }),
      deps: deleteDeps({ deleted, message: V2_ANSWER_MESSAGE }),
      parse: parseDeleteArgs,
    });

    expect(code).toBe(EXIT_OK);
    expect(deleted.calls).toBe(1);
  });
});

describe("slack delete — a metadata-bearing turn checklist", () => {
  it("deletes it through the same ownership guard as every other Slopweaver message", async () => {
    const deleted = { calls: 0 };
    const home = freshHome();
    const code = await runLifecycleWithDeps({
      argv: argv({ tail: ["delete", "--channel", "C1", "--ts", TURN_MESSAGE.ts, "--home", home] }),
      deps: deleteDeps({ deleted, message: TURN_MESSAGE }),
      parse: parseDeleteArgs,
    });

    expect(code).toBe(EXIT_OK);
    expect(deleted.calls).toBe(1);
  });
});

/**
 * The hole a form-level check leaves open, and why this test exists rather than the one above it.
 *
 * `cardFromForm` refuses an incoming `{"kind":"no-fold"}` FORM, and that is NOT enough: a perfectly valid
 * `{"kind":"update"}` form aimed at a NO-FOLD message's own timestamp passes it, ownership legitimately
 * resolves (that renderer is ours, which is what lets `slack delete` remove one), and `chat.update` then
 * sends `attachments` to a message whose entire contract is that it carries no wrapper. Found by a Codex
 * review pass over the diff that added the form-level check.
 */
describe("slack edit — a no-fold TARGET, with a perfectly valid card form", () => {
  it("REFUSES on the target's own renderer and calls updateCard zero times", async () => {
    const deleted = { calls: 0 };
    const home = freshHome();

    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: ["edit", "--channel", "C1", "--ts", NO_FOLD_MESSAGE.ts, "--form", VALID_CARD_FORM, "--home", home],
      }),
      // `fakeDeleteTransport` throws on any method beyond readMessage/whoAmI/deleteMessage, so a single
      // `updateCard` call fails this test by name rather than by a count nobody reads.
      deps: deleteDeps({ deleted, message: NO_FOLD_MESSAGE, voiceRules: ok([]) }),
      parse: parseEditArgs,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(deleted.calls).toBe(0);
  });

  it("still lets `slack delete` remove one — the refusal is scoped to the edit path", async () => {
    const deleted = { calls: 0 };
    const home = freshHome();

    const code = await runLifecycleWithDeps({
      argv: argv({ tail: ["delete", "--channel", "C1", "--ts", NO_FOLD_MESSAGE.ts, "--home", home] }),
      deps: deleteDeps({ deleted, message: NO_FOLD_MESSAGE }),
      parse: parseDeleteArgs,
    });

    expect(code).toBe(EXIT_OK);
    expect(deleted.calls).toBe(1);
  });
});

/**
 * A `finding` is re-posted, never edited in: `slack edit` cannot add the three screenshots the post checked.
 * `voiceRules` is left a landmine, so the refusal is proven to fire BEFORE the voice read rather than after it.
 */
describe("slack edit — a finding form", () => {
  it("REFUSES before reading anything else and calls no Slack method", async () => {
    const deleted = { calls: 0 };
    const finding = JSON.stringify(BOT_FORM_KINDS.find((entry) => entry.kind === "finding")!.fixtures[0]);

    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: ["edit", "--channel", "C1", "--ts", NO_FOLD_MESSAGE.ts, "--form", finding, "--home", freshHome()],
      }),
      deps: deleteDeps({ deleted, message: NO_FOLD_MESSAGE }),
      parse: parseEditArgs,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(deleted.calls).toBe(0);
  });
});

describe("runLifecycleWithDeps — every refusal performs nothing at all", () => {
  it("refuses `edit` with no arguments, touching no dependency", async () => {
    const code = await runLifecycleWithDeps({
      argv: argv({ tail: ["edit"] }),
      deps: landmineDeps(),
      parse: parseEditArgs,
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses `delete` with no arguments, touching no dependency", async () => {
    const code = await runLifecycleWithDeps({
      argv: argv({ tail: ["delete"] }),
      deps: landmineDeps(),
      parse: parseDeleteArgs,
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses `delete` with a channel but no --ts, rather than deleting something else", async () => {
    // A partially-specified destructive verb is the dangerous case: guessing the missing half would delete
    // a message nobody named.
    const code = await runLifecycleWithDeps({
      argv: argv({ tail: ["delete", "--channel", "C1"] }),
      deps: landmineDeps(),
      parse: parseDeleteArgs,
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag on `edit`, touching no dependency", async () => {
    const code = await runLifecycleWithDeps({
      argv: argv({ tail: ["edit", "--definitely-not-a-real-flag"] }),
      deps: landmineDeps(),
      parse: parseEditArgs,
    });
    expect(code).toBe(EXIT_USAGE);
  });
});

describe("the manifest-selected handlers", () => {
  it("carry no metadata of their own — the manifest owns that contract", () => {
    expect(Object.hasOwn(slackEditCommand, "meta")).toBe(false);
    expect(Object.hasOwn(slackDeleteCommand, "meta")).toBe(false);
  });
});

/**
 * The graph-finding floor on the EDIT door: a finding of this kind needs at least three photos. An edit re-sends the message's existing files and can add none, so the floor counts those — and a
 * re-render of a measured Datadog finding onto a message carrying one screenshot is refused before any write.
 */
describe("slack edit --as bot — a voice-rule seam that reads a CORRUPT profile", () => {
  const CARD_MESSAGE: ReadSlackMessage = { ...NO_FOLD_MESSAGE, renderer: "slack-card-v1", ts: "1700000000.000400" };

  // Every transport method touched is recorded, so the ownership read-back (`readMessage`, `whoAmI`) shows up
  // here if the profile were read after it, rather than passing for a refusal made before Slack was asked.
  it.each([
    { dryRun: false, name: "the edit" },
    { dryRun: true, name: "a dry run" },
  ])("stops $name before Slack is asked anything, rather than reading the profile as no rules", async ({ dryRun }) => {
    const deleted = { calls: 0 };
    const home = freshHome();
    const corrupt = freshHome();
    writeFileSync(join(corrupt, "profile.json"), "{", "utf8");
    const voiceRules = readExactVoiceRules({ home: corrupt });
    const touched: string[] = [];
    const door = memoryDoorLedger();
    const base = deleteDeps({ deleted, door, message: CARD_MESSAGE, voiceRules });
    const transport = fakeDeleteTransport({ deleted, message: CARD_MESSAGE });

    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: [
          "edit",
          "--channel",
          "C1",
          "--ts",
          CARD_MESSAGE.ts,
          "--form",
          VALID_CARD_FORM,
          "--home",
          home,
          ...(dryRun ? ["--dry-run"] : []),
        ],
      }),
      deps: {
        ...base,
        makeTransport: () =>
          new Proxy(transport, {
            get: (target, property) => {
              touched.push(String(property));
              return Reflect.get(target, property);
            },
          }),
      },
      parse: parseEditArgs,
    });

    expect(voiceRules.isErr()).toBe(true);
    expect(code).toBe(EXIT_ERROR);
    expect(touched).toEqual([]);
    expect(deleted.calls).toBe(0);
    expect(door.records()).toEqual([]);
  });
});

/**
 * A bot card at the top level of a high-stakes channel cannot be re-rendered as an `update` card: that is an
 * undefended card there, arrived at in place instead of by a new post. A dry run reaches
 * the same check, so the two rows differ ONLY in whether the channel is named.
 */
describe("slack edit --as bot — a top-level card in a high-stakes channel", () => {
  const CARD_MESSAGE: ReadSlackMessage = { ...NO_FOLD_MESSAGE, renderer: "slack-card-v1", ts: "1700000000.000400" };

  it.each([
    { channels: [{ id: "C1", name: "#defects" }], expected: EXIT_USAGE, name: "refuses where the channel is named" },
    { channels: [], expected: EXIT_OK, name: "dry-runs cleanly where it is not" },
  ])("$name", async ({ channels, expected }) => {
    const deleted = { calls: 0 };
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: [
          "edit",
          "--channel",
          "C1",
          "--ts",
          CARD_MESSAGE.ts,
          "--form",
          VALID_CARD_FORM,
          "--home",
          freshHome(),
          "--dry-run",
        ],
      }),
      deps: deleteDeps({ deleted, highStakesChannels: channels, message: CARD_MESSAGE, voiceRules: ok([]) }),
      parse: parseEditArgs,
    });
    expect(code).toBe(expected);
    expect(deleted.calls).toBe(0);
  });
});

/**
 * A bot card edit replaces the opening a teammate reads, so it is held to the rule its post was. The
 * two rows differ ONLY in the channel; `fakeDeleteTransport` throws on `updateCard`, so neither may write.
 */
describe("slack edit --as bot — a card whose new lead opens on a pull request", () => {
  const CARD_MESSAGE: ReadSlackMessage = { ...NO_FOLD_MESSAGE, renderer: "slack-card-v1", ts: "1700000000.000400" };
  const PR_LED_FORM = JSON.stringify({
    detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
    kind: "update",
    tldr: "Approve the fix PR for the gateway outage.",
  });

  it.each([
    { channel: "C1", expected: EXIT_USAGE, name: "refuses it in front of a teammate", ownDm: PROMPT_DM_IS_OWNERS },
    {
      channel: PROMPT_DM,
      expected: EXIT_OK,
      name: "dry-runs it cleanly in the owner's own bot DM",
      ownDm: PROMPT_DM_IS_OWNERS,
    },
    {
      channel: PROMPT_DM,
      expected: EXIT_USAGE,
      name: "refuses it in a colleague's DM configured as the owner's prompt channel",
      ownDm: NOTHING_PROVEN,
    },
  ])("$name", async ({ channel, expected, ownDm }) => {
    const deleted = { calls: 0 };
    const seam = recordingOwnDm({ answer: ownDm });
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: [
          "edit",
          "--channel",
          channel,
          "--ts",
          CARD_MESSAGE.ts,
          "--form",
          PR_LED_FORM,
          "--home",
          freshHome(),
          "--dry-run",
        ],
      }),
      deps: deleteDeps({ deleted, message: CARD_MESSAGE, ownDm: seam.verify, voiceRules: ok([]) }),
      parse: parseEditArgs,
    });
    expect(code).toBe(expected);
    expect(seam.asked).toEqual([channel]);
    expect(deleted.calls).toBe(0);
  });
});

describe("slack edit --as bot — a CORRUPT profile in the invocation's OWN home", () => {
  const CARD_MESSAGE: ReadSlackMessage = { ...NO_FOLD_MESSAGE, renderer: "slack-card-v1", ts: "1700000000.000400" };

  // The production shape: one home, read by both the form's admission and the door-side seam. The verb reads it
  // before admission and exits 1, since a corrupt install is a fact failure rather than a refused form.
  it.each([
    { dryRun: false, name: "the edit" },
    { dryRun: true, name: "a dry run" },
  ])("refuses $name with exit 1, before Slack is asked anything", async ({ dryRun }) => {
    const deleted = { calls: 0 };
    const home = freshHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const touched: string[] = [];
    const door = memoryDoorLedger();
    const transport = fakeDeleteTransport({ deleted, message: CARD_MESSAGE });

    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: [
          "edit",
          "--channel",
          "C1",
          "--ts",
          CARD_MESSAGE.ts,
          "--form",
          VALID_CARD_FORM,
          "--home",
          home,
          ...(dryRun ? ["--dry-run"] : []),
        ],
      }),
      deps: {
        ...deleteDeps({ deleted, door, message: CARD_MESSAGE, voiceRules: readExactVoiceRules({ home }) }),
        makeTransport: () =>
          new Proxy(transport, {
            get: (target, property) => {
              touched.push(String(property));
              return Reflect.get(target, property);
            },
          }),
      },
      parse: parseEditArgs,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(touched).toEqual([]);
    expect(deleted.calls).toBe(0);
    expect(door.records()).toEqual([]);
  });
});

describe("slack edit — an answer card re-rendered as a graph finding short of three screenshots", () => {
  const LEAD = "https://ap1.datadoghq.com/logs?query=env%3Aproduction%20status%3Aerror&live=false&viz=timeseries";
  const HUNT_FORM = JSON.stringify({
    body: [
      {
        runs: [
          { text: "nz cal api key fetch denied, 1 to 123 errors ", type: "text" },
          { label: "[1]", type: "link", url: LEAD },
        ],
        type: "paragraph",
      },
    ],
    grounding: {
      evidence: { consultedEmpty: [], couldNotSee: { blindSpots: [], reason: "none" }, premiseChecks: [], read: [] },
      kind: "conversation",
      provenance: { model: "claude-opus-5-5", skillsLoaded: [], verbsLoaded: [] },
      reason: "context and judgement alone were sufficient",
    },
    kind: "answer",
    lead: "one real regression nobody flagged",
    measurements: [
      { figures: ["123"], repro: "slopweaver datadog logs count", takenAtIso: "2026-09-26T14:30:00.000Z" },
    ],
  });
  const ONE_SHOT_ANSWER: ReadSlackMessage = {
    ...V2_ANSWER_MESSAGE,
    askIdentity: { channel: "C1", messageTs: "1700000000.000001", quality: "exact", threadTs: "1700000000.000001" },
    fileIds: ["F_ONE"],
    imageFileIds: ["F_ONE"],
  };

  it("REFUSES with the floor's own line and never calls updateCard", async () => {
    const deleted = { calls: 0 };
    const code = await runLifecycleWithDeps({
      argv: argv({
        tail: ["edit", "--channel", "C1", "--ts", ONE_SHOT_ANSWER.ts, "--form", HUNT_FORM, "--home", freshHome()],
      }),
      // `fakeDeleteTransport` throws on `updateCard`, so an edit that got past the floor fails by name.
      deps: deleteDeps({ deleted, message: ONE_SHOT_ANSWER, voiceRules: ok([]) }),
      parse: parseEditArgs,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(deleted.calls).toBe(0);
  });

  it("REFUSES one screenshot beside two documents: three files are not three pictures", async () => {
    const deleted = { calls: 0 };
    const mixed: ReadSlackMessage = { ...ONE_SHOT_ANSWER, fileIds: ["F_ONE", "F_DOC_A", "F_DOC_B"] };
    const code = await runLifecycleWithDeps({
      argv: argv({ tail: ["edit", "--channel", "C1", "--ts", mixed.ts, "--form", HUNT_FORM, "--home", freshHome()] }),
      deps: deleteDeps({ deleted, message: mixed, voiceRules: ok([]) }),
      parse: parseEditArgs,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(deleted.calls).toBe(0);
  });
});
