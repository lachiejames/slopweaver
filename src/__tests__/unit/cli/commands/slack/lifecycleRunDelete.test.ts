/**
 * `slack delete`'s bot lane, driven through `runDelete` directly: the token requirement, the complete set of
 * metadata kinds the verb accepts as its own, the at-most-once delete, and the exit code each outcome earns.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import {
  appendSlackDraftEvent,
  journalSlackDraftDeletion,
  readSlackDraftLines,
} from "../../../../../admit/slackDraftStore.js";
import type { DeleteOptions } from "../../../../../cli/commands/slack/lifecycleCore.js";
import { runDelete } from "../../../../../cli/commands/slack/lifecycleRunDelete.js";
import type { JournalDraftDeletion, LifecycleDeps } from "../../../../../cli/commands/slack/lifecycleRunTypes.js";
import type { DeleteMessageOutcome, SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../outbound/slack/draftErrors.js";
import { parseSlackDraftLog } from "../../../../../outbound/slack/draftLog.js";
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../../../outbound/slack/draftRegister.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../../../../outbound/slack/lifecycleGuards.js";
import { sharedFindingsOf } from "../../../../../outbound/slack/sharedFindings.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const SELF: SlackSelfIdentity = { botId: "B_SELF", teamId: "T1", userId: "U_SELF" };

/** This bot's own turn checklist, carrying whichever event type a case probes. */
function ownMessage({ eventType }: { eventType: string }): ReadSlackMessage {
  return {
    botId: "B_SELF",
    fileIds: [],
    metadataEventType: eventType,
    renderer: "slack-turn-v1",
    ts: "1700000000.000100",
    userId: "U_SELF",
  };
}

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh explicit home; a performed delete writes its door-ledger line here. */
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-lifecycle-delete-"));
  fixtureDirs.push(dir);
  return dir;
}

/** The parsed bot-lane invocation. */
function options({ home, dryRun = false }: { home: string; dryRun?: boolean }): DeleteOptions {
  return { actor: "bot", channel: "C1", dryRun, home, json: false, kind: "delete", ts: "1700000000.000100" };
}

/** What one run touched: transport construction, delete calls, and every printed line. */
interface Touched {
  transports: number;
  deletes: number;
  out: string[];
}

/** One call the delete made to the draft-register journal. */
interface JournalCall {
  channel: string;
  home: string;
  nowIso: string;
  ts: string;
}

const NOW = "2026-10-25T08:00:00.000Z";

/** A journal fake that records each call and journals nothing. */
function recordingJournal({ journals }: { journals: JournalCall[] }): JournalDraftDeletion {
  return (call) => {
    journals.push(call);
    return ok([]);
  };
}

/**
 * A dependency set where only the bot lane's members are real; any other member throws by name. The journal is a plain
 * fake recording into `journals` unless a case hands it the real one.
 */
function deps({
  message,
  outcome = { kind: "gone" },
  tokenPresent = true,
  touched,
  journals = [],
  journal = recordingJournal({ journals }),
  door = memoryDoorLedger(),
}: {
  door?: { readonly port: DoorLedgerPort };
  message: ReadSlackMessage | undefined;
  outcome?: DeleteMessageOutcome;
  tokenPresent?: boolean;
  touched: Touched;
  journals?: JournalCall[];
  journal?: JournalDraftDeletion;
}): LifecycleDeps {
  const token = tokenPresent ? "xoxb-fake" : undefined;
  const transport: Pick<SlackWriteTransport, "deleteMessageOnce" | "readMessage" | "whoAmI"> = {
    deleteMessageOnce: async () => {
      touched.deletes += 1;
      return outcome;
    },
    readMessage: async () => message,
    whoAmI: async () => SELF,
  };
  const real: Partial<LifecycleDeps> = {
    botToken: () => token,
    cardChrome: () => ({
      authorEmoji: ":robot_face:",
      authorLabel: "test-bot",
      bannerColor: "#12B5A6",
      detailLabel: "*Details*",
      metadataEventType: "test_card_v1",
    }),
    doorLedger: door.port,
    journalDraftDeletion: journal,
    standaloneProgressEventType: () => "test_progress_v1",
    makeTransport: () => {
      touched.transports += 1;
      return transport as SlackWriteTransport;
    },
    nowIso: () => NOW,
    out: (line) => {
      touched.out.push(line);
    },
    pollEventType: () => "test_poll_v1",
  };
  return new Proxy(real, {
    get: (target, property) =>
      property in target
        ? (target as Record<string, unknown>)[property as string]
        : () => {
            throw new Error(`slack delete touched dependency \`${String(property)}\` it should not need`);
          },
  }) as LifecycleDeps;
}

/** A fresh, empty record of what a run touched. */
function untouched(): Touched {
  return { deletes: 0, out: [], transports: 0 };
}

describe("runDelete — bot lane", () => {
  it("refuses with usage exit 2 and builds no transport when there is no bot token", async () => {
    const home = freshHome();
    const touched = untouched();
    const code = await runDelete({
      deps: deps({ message: ownMessage({ eventType: "test_card_v1" }), tokenPresent: false, touched }),
      options: options({ home }),
    });
    expect(code).toBe(2);
    expect(touched).toEqual({ deletes: 0, out: [], transports: 0 });
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });

  it("dry run reads ownership, prints the would-delete line, deletes nothing and writes nothing", async () => {
    const home = freshHome();
    const touched = untouched();
    const code = await runDelete({
      deps: deps({ message: ownMessage({ eventType: "test_card_v1" }), touched }),
      options: options({ dryRun: true, home }),
    });
    expect(code).toBe(0);
    expect(touched).toEqual({
      deletes: 0,
      out: ["dry run — nothing was changed. would chat.delete C1/1700000000.000100"],
      transports: 1,
    });
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });

  it("deletes an owned message exactly once through the door and prints the deleted line", async () => {
    const home = freshHome();
    const touched = untouched();
    const door = memoryDoorLedger();
    const code = await runDelete({
      deps: deps({ door, message: ownMessage({ eventType: "slopweaver_assistant_answer_v2" }), touched }),
      options: options({ home }),
    });
    expect(code).toBe(0);
    expect(touched).toEqual({ deletes: 1, out: ["deleted — channel=C1 ts=1700000000.000100"], transports: 1 });
    const rows = door.records();
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect({ action: row["action"], effect: row["effect"], findings: row["findings"], status: row["status"] }).toEqual({
      action: "verb:slack.delete",
      effect: "external-write",
      findings: [],
      status: "pass",
    });
  });

  it("deletes nothing and exits with the error code when the door record cannot be written", async () => {
    const home = freshHome();
    const touched = untouched();
    const code = await runDelete({
      deps: deps({
        door: { port: unreachableDoorLedger() },
        message: ownMessage({ eventType: "slopweaver_assistant_answer_v2" }),
        touched,
      }),
      options: options({ home }),
    });
    expect(code).toBe(1);
    expect(touched.deletes).toBe(0);
  });

  it("accepts exactly the ten metadata kinds the verb owns and refuses their neighbours", async () => {
    const candidates = [
      "test_card_v1",
      "slopweaver_card_v1",
      "test_progress_v1",
      "slopweaver_progress_v1",
      "slopweaver_turn_v1",
      "test_poll_v1",
      "slopweaver_poll_v1",
      "slopweaver_assistant_answer_v1",
      "slopweaver_assistant_answer_v2",
      "slopweaver_notice_v1",
      "slopweaver_card_v2",
      "slopweaver_assistant_answer_v3",
      "slopweaver_turn_v2",
      "slopweaver_notice_v2",
      "other_app_card_v1",
    ];
    const exits: { eventType: string; code: number }[] = [];
    for (const eventType of candidates) {
      const code = await runDelete({
        deps: deps({ message: ownMessage({ eventType }), touched: untouched() }),
        options: options({ dryRun: true, home: freshHome() }),
      });
      exits.push({ code, eventType });
    }
    expect(exits).toEqual([
      { code: 0, eventType: "test_card_v1" },
      { code: 0, eventType: "slopweaver_card_v1" },
      { code: 0, eventType: "test_progress_v1" },
      { code: 0, eventType: "slopweaver_progress_v1" },
      { code: 0, eventType: "slopweaver_turn_v1" },
      { code: 0, eventType: "test_poll_v1" },
      { code: 0, eventType: "slopweaver_poll_v1" },
      { code: 0, eventType: "slopweaver_assistant_answer_v1" },
      { code: 0, eventType: "slopweaver_assistant_answer_v2" },
      { code: 0, eventType: "slopweaver_notice_v1" },
      { code: 1, eventType: "slopweaver_card_v2" },
      { code: 1, eventType: "slopweaver_assistant_answer_v3" },
      { code: 1, eventType: "slopweaver_turn_v2" },
      { code: 1, eventType: "slopweaver_notice_v2" },
      { code: 1, eventType: "other_app_card_v1" },
    ]);
  });

  it("deletes a bare line this bot posted with no metadata, and still refuses another bot's bare line", async () => {
    // The stranded lane's re-dispatch notice went out bare, and `slack delete` refused it until this lane took
    // a bot-authored line with no metadata as its own (`C0SYN000018`/`1791889582.262339`).
    const bare: ReadSlackMessage = { botId: "B_SELF", fileIds: [], ts: "1700000000.000100", userId: "U_SELF" };
    const ours = untouched();
    const ourCode = await runDelete({
      deps: deps({ message: bare, touched: ours }),
      options: options({ home: freshHome() }),
    });
    const foreign = untouched();
    const foreignCode = await runDelete({
      deps: deps({ message: { ...bare, botId: "B_OTHER" }, touched: foreign }),
      options: options({ home: freshHome() }),
    });

    expect({ code: ourCode, deletes: ours.deletes, out: ours.out }).toEqual({
      code: 0,
      deletes: 1,
      out: ["deleted — channel=C1 ts=1700000000.000100"],
    });
    expect({ code: foreignCode, deletes: foreign.deletes, out: foreign.out }).toEqual({ code: 1, deletes: 0, out: [] });
  });

  it("exits 1 with no delete and no output when the target message is absent", async () => {
    const home = freshHome();
    const touched = untouched();
    const code = await runDelete({ deps: deps({ message: undefined, touched }), options: options({ home }) });
    expect(code).toBe(1);
    expect(touched).toEqual({ deletes: 0, out: [], transports: 1 });
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });

  it("exits 1 with no delete when another bot posted the message", async () => {
    const home = freshHome();
    const touched = untouched();
    const foreign: ReadSlackMessage = { ...ownMessage({ eventType: "test_card_v1" }), botId: "B_OTHER" };
    const code = await runDelete({ deps: deps({ message: foreign, touched }), options: options({ home }) });
    expect(code).toBe(1);
    expect(touched).toEqual({ deletes: 0, out: [], transports: 1 });
  });

  it("exits 1 with no success line when the at-most-once delete reports failure", async () => {
    const home = freshHome();
    const touched = untouched();
    const code = await runDelete({
      deps: deps({
        message: ownMessage({ eventType: "test_card_v1" }),
        outcome: { kind: "failed", reason: "ratelimited" },
        touched,
      }),
      options: options({ home }),
    });
    expect(code).toBe(1);
    expect(touched).toEqual({ deletes: 1, out: [], transports: 1 });
  });

  it("prints the same deleted line and exits 0 when the provider reports the message already gone", async () => {
    const home = freshHome();
    const touched = untouched();
    const code = await runDelete({
      deps: deps({ message: ownMessage({ eventType: "test_card_v1" }), outcome: { kind: "already-gone" }, touched }),
      options: options({ home }),
    });
    expect(code).toBe(0);
    expect(touched).toEqual({ deletes: 1, out: ["deleted — channel=C1 ts=1700000000.000100"], transports: 1 });
  });
});

/** A parked finding row released at C1/1700000000.000100 — the shape `slack finding-followups` reads as shared. */
function seedReleasedFinding({ home, id }: { home: string; id: string }): void {
  const content = {
    authorId: "U_SELF",
    channel: "C1",
    mentions: [],
    payload: { form: "plain" as const, text: "the finding", unfurl_links: false, unfurl_media: false },
  };
  const draft: ParkedSlackDraft = {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: "{}",
    id,
    kind: "finding",
    shape: "top-level",
    tsIso: "2026-10-12T00:20:00.000Z",
    why: "the finding row",
  };
  unwrap(appendSlackDraftEvent({ event: { draft, id, kind: "parked", tsIso: draft.tsIso }, home }));
  unwrap(
    appendSlackDraftEvent({
      event: { channel: "C1", id, kind: "released", ts: "1700000000.000100", tsIso: "2026-10-12T00:28:08.000Z" },
      home,
    }),
  );
}

describe("runDelete — the draft register learns the deletion", () => {
  const call = ({ home }: { home: string }): JournalCall => ({
    channel: "C1",
    home,
    nowIso: NOW,
    ts: "1700000000.000100",
  });

  it("journals a performed delete and a provider-reported already-gone once each, with the exact coordinate", async () => {
    const gone = { home: freshHome(), journals: [] as JournalCall[] };
    const already = { home: freshHome(), journals: [] as JournalCall[] };
    const goneCode = await runDelete({
      deps: deps({ journals: gone.journals, message: ownMessage({ eventType: "test_card_v1" }), touched: untouched() }),
      options: options({ home: gone.home }),
    });
    const alreadyCode = await runDelete({
      deps: deps({
        journals: already.journals,
        message: ownMessage({ eventType: "test_card_v1" }),
        outcome: { kind: "already-gone" },
        touched: untouched(),
      }),
      options: options({ home: already.home }),
    });

    expect({ alreadyCode, goneCode }).toEqual({ alreadyCode: 0, goneCode: 0 });
    expect(gone.journals).toEqual([call({ home: gone.home })]);
    expect(already.journals).toEqual([call({ home: already.home })]);
  });

  it("journals a target already absent before the read-back, and still exits 1 with no delete", async () => {
    const home = freshHome();
    const journals: JournalCall[] = [];
    const touched = untouched();
    const code = await runDelete({ deps: deps({ journals, message: undefined, touched }), options: options({ home }) });

    expect(code).toBe(1);
    expect(touched).toEqual({ deletes: 0, out: [], transports: 1 });
    expect(journals).toEqual([call({ home })]);
  });

  it("journals nothing on a dry run, a failed delete, another bot's message, or a dry run of an absent target", async () => {
    const journals: JournalCall[] = [];
    const own = ownMessage({ eventType: "test_card_v1" });
    const codes = [
      await runDelete({
        deps: deps({ journals, message: own, touched: untouched() }),
        options: options({ dryRun: true, home: freshHome() }),
      }),
      await runDelete({
        deps: deps({
          journals,
          message: own,
          outcome: { kind: "failed", reason: "ratelimited" },
          touched: untouched(),
        }),
        options: options({ home: freshHome() }),
      }),
      await runDelete({
        deps: deps({ journals, message: { ...own, botId: "B_OTHER" }, touched: untouched() }),
        options: options({ home: freshHome() }),
      }),
      await runDelete({
        deps: deps({ journals, message: undefined, touched: untouched() }),
        options: options({ dryRun: true, home: freshHome() }),
      }),
    ];

    expect(codes).toEqual([0, 1, 1, 1]);
    expect(journals).toEqual([]);
  });

  it("keeps the delete's own exit when the journal fails, printing no register line", async () => {
    const touched = untouched();
    const failing: JournalDraftDeletion = ({ home }) =>
      err(SlackDraftErrors.writeFailed({ cause: new Error("disk full"), path: join(home, "slack-drafts.jsonl") }));
    const code = await runDelete({
      deps: deps({ journal: failing, message: ownMessage({ eventType: "test_card_v1" }), touched }),
      options: options({ home: freshHome() }),
    });

    expect(code).toBe(0);
    expect(touched).toEqual({ deletes: 1, out: ["deleted — channel=C1 ts=1700000000.000100"], transports: 1 });
  });

  it("keeps the delete's own exit when the journal THROWS, a lock release that cannot remove its file included", async () => {
    // A throw escaping after Slack confirmed the delete would have rejected the verb outright.
    const touched = untouched();
    const throwing: JournalDraftDeletion = () => {
      throw new Error("EACCES: permission denied, unlink 'slack-drafts.jsonl.lock'");
    };
    const code = await runDelete({
      deps: deps({ journal: throwing, message: ownMessage({ eventType: "test_card_v1" }), touched }),
      options: options({ home: freshHome() }),
    });

    expect(code).toBe(0);
    expect(touched).toEqual({ deletes: 1, out: ["deleted — channel=C1 ts=1700000000.000100"], transports: 1 });
  });

  it("heals a finding deleted before the journal existed: re-running on the gone message stops it being shared", async () => {
    // A draft deleted with no register line was still listed as owed 228h later.
    const home = freshHome();
    seedReleasedFinding({ home, id: "sd-dd932464" });
    const before = sharedFindingsOf({ events: parseSlackDraftLog({ lines: readSlackDraftLines({ home }) }).events });
    const touched = untouched();
    const real: JournalDraftDeletion = (args) => journalSlackDraftDeletion(args);
    const code = await runDelete({
      deps: deps({ journal: real, message: undefined, touched }),
      options: options({ home }),
    });
    const second = await runDelete({
      deps: deps({ journal: real, message: undefined, touched: untouched() }),
      options: options({ home }),
    });
    const log = parseSlackDraftLog({ lines: readSlackDraftLines({ home }) });

    expect(before.findings.map((finding) => finding.draftId)).toEqual(["sd-dd932464"]);
    expect({ code, out: touched.out, second }).toEqual({
      code: 1,
      out: ["draft register: recorded deleted on sd-dd932464"],
      second: 1,
    });
    expect(log.events.filter((event) => event.kind === "deleted")).toEqual([
      { channel: "C1", id: "sd-dd932464", kind: "deleted", ts: "1700000000.000100", tsIso: NOW },
    ]);
    expect(sharedFindingsOf({ events: log.events })).toEqual({ findings: [], undated: [] });
  });
});
