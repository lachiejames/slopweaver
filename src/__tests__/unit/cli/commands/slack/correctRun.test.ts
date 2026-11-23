/**
 * `slack correct` — the owner's magnitude line refuses before anything is read, the edit lands in place through the door on a
 * message this bot owns, and the read-back is what says it landed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import { type CorrectOptions, parseCorrectArgs } from "../../../../../cli/commands/slack/correctArgs.js";
import type { CorrectDeps } from "../../../../../cli/commands/slack/correctGate.js";
import { runCorrect } from "../../../../../cli/commands/slack/correctRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { PostedMessage, SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { ASSISTANT_ANSWER_EVENT_TYPE_V2 } from "../../../../../outbound/assistant/answerMessage.js";
import { type CorrectedMessage, correctClaim } from "../../../../../outbound/slack/claimCorrection.js";
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  slackDraftEventLine,
} from "../../../../../outbound/slack/draftRegister.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../../../../outbound/slack/lifecycleGuards.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const SELF: SlackSelfIdentity = { botId: "B_SELF", teamId: "T1", userId: "U_SELF" };
const TS = "1790000001.000100";

/** The answer's lead block: the claim sits in one plain run. */
const LEAD = {
  elements: [{ elements: [{ text: "The pool saw 10 failed requests.", type: "text" }], type: "rich_text_section" }],
  type: "rich_text",
};

/** This bot's own V2 answer, as Slack stores it: the blocks inside one attachment wrapper. */
function answer({ owner = SELF }: { owner?: SlackSelfIdentity } = {}): ReadSlackMessage {
  return {
    botId: owner.botId,
    fileIds: ["F1"],
    metadataEventType: ASSISTANT_ANSWER_EVENT_TYPE_V2,
    renderer: "slack-assistant-answer-v2",
    stored: {
      attachments: [{ blocks: [LEAD], color: "#7c3aed", fallback: "The pool saw 10 failed requests." }],
      metadata: {
        event_payload: { renderer: "slack-assistant-answer-v2" },
        event_type: ASSISTANT_ANSWER_EVENT_TYPE_V2,
      },
      text: "The pool saw 10 failed requests.",
    },
    ts: TS,
    userId: owner.userId,
  };
}

/**
 * A transport holding one message, which `correctMessage` rewrites unless told to drop the update — or rewrites to
 * `landAs` instead, the way another edit racing ours would leave it.
 */
function storeTransport({
  message,
  dropUpdate = false,
  landAs,
}: {
  message: ReadSlackMessage;
  dropUpdate?: boolean;
  landAs?: CorrectedMessage;
}): SlackWriteTransport & { readonly writes: CorrectedMessage[]; readonly fileIdsSent: (readonly string[])[] } {
  let current = message;
  const writes: CorrectedMessage[] = [];
  const fileIdsSent: (readonly string[])[] = [];
  const real = {
    correctMessage: async ({ corrected, fileIds }: { corrected: CorrectedMessage; fileIds: readonly string[] }) => {
      writes.push(corrected);
      fileIdsSent.push(fileIds);
      if (!dropUpdate) {
        let stored = corrected;
        if (landAs !== undefined) {
          stored = landAs;
        }
        current = {
          ...current,
          blocks: stored.blocks,
          stored: { attachments: stored.attachments, metadata: stored.metadata, text: stored.text },
        };
      }
    },
    fileIdsSent,
    readMessage: async ({ posted }: { posted: PostedMessage }) => (posted.ts === TS ? current : undefined),
    whoAmI: async () => SELF,
    writes,
  };
  return new Proxy(real, {
    get: (target, property) =>
      property in target
        ? (target as unknown as Record<string, unknown>)[property as string]
        : () => {
            throw new Error(`slack correct touched transport method \`${String(property)}\``);
          },
  }) as unknown as SlackWriteTransport & { writes: CorrectedMessage[]; fileIdsSent: (readonly string[])[] };
}

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-slack-correct-"));
  homes.push(dir);
  return dir;
}

/** A plain-fake world: the named members are real, and any other member throws when touched. */
function depsOf({
  transport,
  door = memoryDoorLedger(),
  draftLog = [],
  lines = [],
  tokens = [],
}: {
  transport?: SlackWriteTransport;
  door?: { readonly port: DoorLedgerPort };
  draftLog?: readonly string[];
  lines?: string[];
  /** Every token a transport was made with, so a test can say whose identity the edit went out under. */
  tokens?: string[];
}): CorrectDeps {
  const real: Partial<CorrectDeps> = {
    botToken: () => "xoxb-fake",
    cardChrome: () => ({
      authorEmoji: ":robot_face:",
      authorLabel: "test-bot",
      bannerColor: "#12B5A6",
      detailLabel: "*Details*",
      metadataEventType: "test_card_v1",
    }),
    doorEnv: () => ({}),
    doorLedger: door.port,
    nowIso: () => "2026-10-04T05:00:00.000Z",
    out: (line) => {
      lines.push(line);
    },
    readDraftLog: () => draftLog,
    userToken: () => "xoxp-fake",
    voiceRules: () => ok([]),
    ...(transport === undefined
      ? {}
      : {
          makeTransport: ({ token }) => {
            tokens.push(token);
            return transport;
          },
        }),
  };
  return new Proxy(real, {
    get: (target, property) =>
      property in target
        ? (target as unknown as Record<string, unknown>)[property as string]
        : () => {
            throw new Error(`slack correct touched dependency \`${String(property)}\``);
          },
  }) as unknown as CorrectDeps;
}

/** A parsed invocation over a fresh home. */
function optionsOf({ home, extra = [] }: { home: string; extra?: readonly string[] }): CorrectOptions {
  return unwrap(
    parseCorrectArgs({
      defaultHome: home,
      rest: ["--channel", "C1", "--ts", TS, "--wrong", "10 failed", "--correction", "It was 30 failed.", ...extra],
    }),
  );
}

describe("runCorrect, the owner's magnitude line", () => {
  it("holds a figure moved by an order of magnitude before any dependency is touched, naming the Queue", async () => {
    const home = freshHome();
    const options = unwrap(
      parseCorrectArgs({
        defaultHome: home,
        rest: ["--channel", "C1", "--ts", TS, "--wrong", "10 failed", "--correction", "It was 300 failed."],
      }),
    );
    const throwing = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("touched");
        },
      },
    ) as CorrectDeps;
    // Every member of `throwing` throws on use, the door ledger included: the refusal reached none of them.
    expect(await runCorrect({ deps: throwing, options })).toBe(EXIT_USAGE);
  });

  it("corrects that same figure once --magnitude-seen names the owner's answer, and says where it was", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: answer() });
    const lines: string[] = [];
    const door = memoryDoorLedger();
    const options = unwrap(
      parseCorrectArgs({
        defaultHome: home,
        rest: [
          "--channel",
          "C1",
          "--ts",
          TS,
          "--wrong",
          "10 failed",
          "--correction",
          "It was 300 failed.",
          "--magnitude-seen",
          "EV8Ywr56",
        ],
      }),
    );
    expect(await runCorrect({ deps: depsOf({ door, lines, transport }), options })).toBe(EXIT_OK);
    expect(lines).toEqual([
      `corrected — channel=C1 ts=${TS} struck in rich-text, read back — order of magnitude seen at EV8Ywr56`,
    ]);
    expect(door.text()).toContain('"action":"verb:slack.correct"');
  });
});

describe("runCorrect, the edit in place", () => {
  it("strikes the claim in the stored answer, keeps its file, and reports the read-back", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: answer() });
    const lines: string[] = [];
    const tokens: string[] = [];
    expect(await runCorrect({ deps: depsOf({ lines, tokens, transport }), options: optionsOf({ home }) })).toBe(
      EXIT_OK,
    );
    expect(tokens).toEqual(["xoxb-fake"]);
    expect(transport.writes.length).toBe(1);
    expect(transport.writes[0]!.text).toBe("The pool saw ~10 failed~ requests.\n*Correction:* It was 30 failed.");
    expect(transport.fileIdsSent).toEqual([["F1"]]);
    expect(lines).toEqual([`corrected — channel=C1 ts=${TS} struck in rich-text, read back`]);
  });

  it("writes nothing and exits with the error code when the door record cannot be written", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: answer() });
    const lines: string[] = [];
    const deps = depsOf({ door: { port: unreachableDoorLedger() }, lines, transport });
    expect(await runCorrect({ deps, options: optionsOf({ home }) })).toBe(EXIT_ERROR);
    expect(transport.writes.length).toBe(0);
    expect(lines).toEqual([]);
  });

  it("changes nothing on a claim already struck, so a second run is a no-op", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: answer() });
    await runCorrect({ deps: depsOf({ transport }), options: optionsOf({ home }) });
    expect(await runCorrect({ deps: depsOf({ transport }), options: optionsOf({ home }) })).toBe(EXIT_EXPECTED_EMPTY);
    expect(transport.writes.length).toBe(1);
  });

  it("fails when Slack accepts the update but the read-back does not show the strike", async () => {
    const home = freshHome();
    const transport = storeTransport({ dropUpdate: true, message: answer() });
    expect(await runCorrect({ deps: depsOf({ transport }), options: optionsOf({ home }) })).toBe(EXIT_ERROR);
    expect(transport.writes.length).toBe(1);
  });

  it("fails when the read-back shows the claim struck under a different Correction line than ours", async () => {
    const home = freshHome();
    const raced = unwrap(
      correctClaim({ correction: "It was 40 failed.", stored: answer().stored!, wrong: "10 failed" }),
    );
    const transport = storeTransport({ landAs: raced, message: answer() });
    const lines: string[] = [];
    expect(await runCorrect({ deps: depsOf({ lines, transport }), options: optionsOf({ home }) })).toBe(EXIT_ERROR);
    expect(lines[0]).toContain("does not show the claim struck with this Correction line under it");
  });

  it("refuses a message another bot posted, and writes nothing", async () => {
    const home = freshHome();
    const other = { botId: "B_OTHER", teamId: "T1", userId: "U_OTHER" };
    const transport = storeTransport({ message: answer({ owner: other }) });
    expect(await runCorrect({ deps: depsOf({ transport }), options: optionsOf({ home }) })).toBe(EXIT_ERROR);
    expect(transport.writes.length).toBe(0);
  });

  it("lets a journalled re-run through when the message already shows this exact correction, under its own action", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: answer() });
    const context = {
      action: { kind: "verb", noun: "witness", verb: "revise" },
      alreadyCorrected: "landed-if-same",
    } as const;
    const door = memoryDoorLedger();
    await runCorrect({ context, deps: depsOf({ door, transport }), options: optionsOf({ home }) });
    const lines: string[] = [];
    const again = await runCorrect({ context, deps: depsOf({ door, lines, transport }), options: optionsOf({ home }) });
    const differently = await runCorrect({
      context,
      deps: depsOf({ door, transport }),
      options: unwrap(
        parseCorrectArgs({
          defaultHome: home,
          rest: ["--channel", "C1", "--ts", TS, "--wrong", "10 failed", "--correction", "It was 40 failed."],
        }),
      ),
    });
    expect([again, differently, transport.writes.length]).toEqual([EXIT_OK, EXIT_EXPECTED_EMPTY, 1]);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("already shows this exact correction");
    expect(door.text()).toContain('"action":"verb:witness.revise"');
  });

  it("writes nothing on a dry run", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: answer() });
    const door = memoryDoorLedger();
    const options = optionsOf({ extra: ["--dry-run"], home });
    expect(await runCorrect({ deps: depsOf({ door, transport }), options })).toBe(EXIT_OK);
    expect(transport.writes.length).toBe(0);
    expect(door.records()).toEqual([]);
  });
});

/** One held row parked for `channel`, as `slack draft record` writes it. */
function parkedLog({ channel }: { channel: string }): readonly string[] {
  const content = {
    authorId: "U0ME",
    channel,
    mentions: [],
    payload: { form: "plain" as const, text: "a heads-up", unfurl_links: false, unfurl_media: false },
  };
  const row: ParkedSlackDraft = {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: "{}",
    id: "sd-1a2b3c4d",
    shape: "top-level",
    tsIso: "2026-10-04T04:59:00.000Z",
    why: "the urgent correction's notice",
  };
  return [slackDraftEventLine({ event: { draft: row, id: row.id, kind: "parked", tsIso: row.tsIso } })];
}

describe("runCorrect, an urgent correction's parked DM", () => {
  const urgent = ["--urgent", "--notify-draft", "sd-1a2b3c4d"];

  it("corrects when the named row is a held direct message, and never sends it", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: answer() });
    const lines: string[] = [];
    const deps = depsOf({ draftLog: parkedLog({ channel: "D0ASKER" }), lines, transport });
    expect(await runCorrect({ deps, options: optionsOf({ extra: urgent, home }) })).toBe(EXIT_OK);
    expect(lines).toEqual([
      `corrected — channel=C1 ts=${TS} struck in rich-text, read back — DM sd-1a2b3c4d is parked on the Queue for the owner's yes`,
    ]);
  });

  it.each([
    ["a row parked for a channel", parkedLog({ channel: "C0PUBLIC" })],
    ["no such row", []],
  ])("refuses %s before touching Slack", async (_name, draftLog) => {
    const home = freshHome();
    // No transport and no token in this world: reaching either would throw, which is the assertion's other half.
    const door = memoryDoorLedger();
    const deps = depsOf({ door, draftLog });
    expect(await runCorrect({ deps, options: optionsOf({ extra: urgent, home }) })).toBe(EXIT_USAGE);
    expect(door.records()).toEqual([]);
  });
});

/**
 * A message posted under the owner's name, what `slack post --as me` leaves: their user beside the app's bot id (their token posts
 * through Slopweaver's app, as the V23 message read back), and no card metadata.
 */
function ownerMessage({ userId = SELF.userId }: { userId?: string } = {}): ReadSlackMessage {
  return { botId: "B_APP", fileIds: [], stored: { text: "The pool saw 10 failed requests." }, ts: TS, userId };
}

/** One as-me row parked for C1 and released to `ts`, as `slack post --as me --draft` journals it. */
function releasedLog({ ts }: { ts: string }): readonly string[] {
  const content = {
    authorId: SELF.userId,
    channel: "C1",
    mentions: [],
    payload: {
      form: "plain" as const,
      text: "The pool saw 10 failed requests.",
      unfurl_links: false,
      unfurl_media: false,
    },
  };
  const row: ParkedSlackDraft = {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: "{}",
    id: "sd-5e5e5e5e",
    shape: "top-level",
    tsIso: "2026-10-04T04:59:00.000Z",
    why: "the pool card",
  };
  return [
    slackDraftEventLine({ event: { draft: row, id: row.id, kind: "parked", tsIso: row.tsIso } }),
    slackDraftEventLine({
      event: { channel: "C1", id: row.id, kind: "released", ts, tsIso: "2026-10-04T05:00:00.000Z" },
    }),
  ];
}

describe("runCorrect --as me, a message sent under the owner's name", () => {
  const asMe = ["--as", "me"];

  it("strikes the claim in place with the owner's token when the register shows Slopweaver released it", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: ownerMessage() });
    const lines: string[] = [];
    const tokens: string[] = [];
    const door = memoryDoorLedger();
    const deps = depsOf({ door, draftLog: releasedLog({ ts: TS }), lines, tokens, transport });
    expect(await runCorrect({ deps, options: optionsOf({ extra: asMe, home }) })).toBe(EXIT_OK);
    expect(tokens).toEqual(["xoxp-fake"]);
    expect(transport.writes[0]!.text).toBe("The pool saw ~10 failed~ requests.\n*Correction:* It was 30 failed.");
    expect(lines).toEqual([`corrected — channel=C1 ts=${TS} struck in text, read back (as me)`]);
    expect(door.text()).toContain('"action":"verb:slack.correct"');
  });

  it("says the dry run would edit as the owner, and writes nothing", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: ownerMessage() });
    const lines: string[] = [];
    const deps = depsOf({ draftLog: releasedLog({ ts: TS }), lines, transport });
    expect(await runCorrect({ deps, options: optionsOf({ extra: [...asMe, "--dry-run"], home }) })).toBe(EXIT_OK);
    expect(lines).toEqual([
      `dry run — nothing was changed. would chat.update (as me) C1/${TS}, striking the claim in text and keeping 0 file(s)`,
    ]);
    expect(transport.writes.length).toBe(0);
  });

  it("refuses with no user token, though a bot token is there, before Slack is touched", async () => {
    const home = freshHome();
    // No transport in this world: reaching Slack would throw, so the usage exit is the refusal itself.
    const door = memoryDoorLedger();
    const deps = new Proxy(depsOf({ door }), {
      get: (target, property) => (property === "userToken" ? () => undefined : Reflect.get(target, property)),
    });
    expect(await runCorrect({ deps, options: optionsOf({ extra: asMe, home }) })).toBe(EXIT_USAGE);
    expect(door.records()).toEqual([]);
  });

  it("refuses a bot token stored in the user slot, whose auth.test would name the bot's user", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: ownerMessage() });
    const tokens: string[] = [];
    const lines: string[] = [];
    const door = memoryDoorLedger();
    const inner = depsOf({ door, draftLog: releasedLog({ ts: TS }), lines, tokens, transport });
    const deps = new Proxy(inner, {
      get: (target, property) =>
        property === "userToken" ? () => "xoxb-in-the-user-slot" : Reflect.get(target, property),
    });
    expect(await runCorrect({ deps, options: optionsOf({ extra: asMe, home }) })).toBe(EXIT_USAGE);
    expect(tokens).toEqual([]);
    expect(transport.writes.length).toBe(0);
    expect(door.records()).toEqual([]);
  });

  it("refuses a message the owner typed themselves, which no released row names, and writes nothing", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: ownerMessage() });
    const door = memoryDoorLedger();
    const deps = depsOf({ door, draftLog: releasedLog({ ts: "1790000009.000100" }), transport });
    expect(await runCorrect({ deps, options: optionsOf({ extra: asMe, home }) })).toBe(EXIT_ERROR);
    expect(transport.writes.length).toBe(0);
    expect(door.records()).toEqual([]);
  });

  it("refuses a message another person posted, even with a released row at that ts", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: ownerMessage({ userId: "U_OTHER" }) });
    const deps = depsOf({ draftLog: releasedLog({ ts: TS }), transport });
    expect(await runCorrect({ deps, options: optionsOf({ extra: asMe, home }) })).toBe(EXIT_ERROR);
    expect(transport.writes.length).toBe(0);
  });

  it("refuses the bot's own answer, posted by the bot's user, even with a released row at that ts", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: answer({ owner: { ...SELF, userId: "U_BOT" } }) });
    const deps = depsOf({ draftLog: releasedLog({ ts: TS }), transport });
    expect(await runCorrect({ deps, options: optionsOf({ extra: asMe, home }) })).toBe(EXIT_ERROR);
    expect(transport.writes.length).toBe(0);
  });

  it("refuses the owner's message on the default bot lane, the defect this lane exists for", async () => {
    const home = freshHome();
    const transport = storeTransport({ message: ownerMessage() });
    const deps = depsOf({ draftLog: releasedLog({ ts: TS }), transport });
    expect(await runCorrect({ deps, options: optionsOf({ home }) })).toBe(EXIT_ERROR);
    expect(transport.writes.length).toBe(0);
  });
});

describe("parseCorrectArgs", () => {
  it("defaults to the bot and takes --as me", () => {
    const base = ["--channel", "C1", "--ts", TS, "--wrong", "a", "--correction", "b."];
    expect(unwrap(parseCorrectArgs({ defaultHome: "/h", rest: base })).actor).toBe("bot");
    expect(unwrap(parseCorrectArgs({ defaultHome: "/h", rest: [...base, "--as", "me"] })).actor).toBe("me");
  });

  it.each([
    [["--ts", TS, "--as", "someone"], '--as must be `bot` or `me` (got "someone")'],
    [["--ts", TS, "--urgent"], "--urgent needs --notify-draft"],
    [["--ts", TS, "--notify-draft", "sd-1"], "--notify-draft is only for an --urgent correction"],
    [["--ts", "yesterday"], "--ts must be a Slack message ts"],
  ])("refuses %j", (extra, fragment) => {
    const refused = unwrapErr(
      parseCorrectArgs({
        defaultHome: "/h",
        rest: ["--channel", "C1", "--wrong", "a", "--correction", "b.", ...extra],
      }),
    );
    expect(refused.message).toContain(fragment);
  });

  it("names every missing required flag in one pass", () => {
    expect(unwrapErr(parseCorrectArgs({ defaultHome: "/h", rest: [] })).message).toBe(
      "--channel is required; --ts is required; --wrong is required; --correction is required",
    );
  });
});
