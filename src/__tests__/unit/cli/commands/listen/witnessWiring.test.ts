/**
 * `listen`'s witness wiring: the snapshot opens with or without handles (the own watch needs none), a typed
 * refusal on a handle that does not resolve, the emitter's queue-then-stdout order, and `--follow` as the only
 * mode that taps a connection, and the tap's stand-down read over the real witness journal.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "#lib/result.js";
import type { ListenDeps } from "../../../../../cli/commands/listen/loop.js";
import {
  journalStoodDown,
  loadWitnessSetup,
  withWitnessTap,
  witnessEmitter,
} from "../../../../../cli/commands/listen/witnessWiring.js";
import { UNSCOPED } from "../../../../../live/listen/scope.js";
import type { SocketConnection } from "../../../../../live/listen/socket.js";
import { emptyWitnessState } from "../../../../../live/listen/witnessState.js";
import { witnessGateOver } from "../../../../../live/listen/witnessStateStore.js";
import { appendWitnessEvent } from "../../../../../live/witness/journalStore.js";
import { witnessIdOf } from "../../../../../live/witness/types.js";
import { type Profile, parseProfile } from "../../../../../profile.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "witness-wiring-"));
  homes.push(home);
  return home;
}

/** A profile whose bot names the given witness handles. */
function profileWith({ handles }: { handles: readonly string[] }): Profile {
  return unwrap(
    parseProfile({
      value: {
        displayName: "Ada Owner",
        gitNamespace: "ada-gh",
        id: "owner-1",
        schemaVersion: 1,
        slackBot: { witnessBotHandles: handles },
        sources: ["slack"],
      },
    }),
  );
}

/** The one connection every fake `openConnection` returns — compared by identity. */
const CONNECTION: SocketConnection = {
  acknowledge: () => undefined,
  cancel: async () => {},
  close: async () => {},
  discarded: () => 0,
  endedBecause: () => undefined,
  frames: async function* frames() {
    yield* [];
  },
};

/** The smallest live seams `withWitnessTap` reads. */
const DEPS: ListenDeps = {
  allowMultipleConnections: false,
  handler: async () => {},
  log: () => undefined,
  nowMs: () => 0,
  openConnection: async () => CONNECTION,
  openTicket: async () => ok("wss://example.invalid"),
  refuseResponder: async () => {},
  responderHatchOpen: () => false,
  responderWhitelist: () => ({ kind: "absent" }),
  scope: UNSCOPED,
  threadReplyChannels: [],
  wait: async () => "elapsed",
};

const SETUP = {
  bots: [{ handle: "peerbot", userId: "U0PEER" }],
  gate: witnessGateOver({ initial: emptyWitnessState(), now: () => 0, save: () => ok(undefined) }),
  stoodDown: () => ok(false),
};

/** Load the setup, collecting every warning. */
function load({ home, profile }: { home: string; profile: Profile | null }): {
  setup: ReturnType<typeof loadWitnessSetup>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const setup = loadWitnessSetup({ home, profile, warn: ({ line }) => warnings.push(line) });
  return { setup, warnings };
}

describe("loadWitnessSetup", () => {
  it("opens the snapshot with no peer bot when there is no profile at all — the own watch needs none", () => {
    const { setup, warnings } = load({ home: freshHome(), profile: null });

    expect(unwrap(setup)!.bots).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("opens the snapshot with no peer bot for an empty handle list", () => {
    const profile = unwrap(
      parseProfile({
        value: { displayName: "Ada", gitNamespace: "ada", id: "o", schemaVersion: 1, slackBot: {}, sources: [] },
      }),
    );

    expect(unwrap(load({ home: freshHome(), profile }).setup)!.bots).toEqual([]);
  });

  it("starts with the own watch OFF, said loudly, on a corrupt snapshot when no peer bot is configured", () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).live.slack.witnessStateJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    const { setup, warnings } = load({ home, profile: null });

    expect(unwrap(setup)).toBe(undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("witness: own watch OFF — ");
    expect(warnings[0]).toContain("tags are still answered");
  });

  it("refuses a configured handle the member directory does not hold", () => {
    const error = unwrapErr(load({ home: freshHome(), profile: profileWith({ handles: ["peerbot"] }) }).setup);

    expect(error.code).toBe("WITNESS_BOT_NOT_FOUND");
  });
});

describe("journalStoodDown", () => {
  it("reads a thread as stood down only once the journal holds a stood-down row in it", () => {
    const home = freshHome();
    const stoodDown = journalStoodDown({ home });
    const key = { channel: "C0OPS", messageTs: "1790000060.000100", threadTs: "1790000000.000100" };

    expect(unwrap(stoodDown({ channel: "C0OPS", threadTs: key.threadTs }))).toBe(false);
    unwrap(
      appendWitnessEvent({
        event: {
          ...key,
          kind: "settled",
          outcome: "stood-down",
          schemaVersion: 1,
          tsIso: "2026-10-13T22:10:00.000Z",
          why: "told it was in the way",
          witnessId: witnessIdOf({ key }),
        },
        home,
      }),
    );
    expect(unwrap(stoodDown({ channel: "C0OPS", threadTs: key.threadTs }))).toBe(true);
    expect(unwrap(stoodDown({ channel: "C0OPS", threadTs: "1790009999.000100" }))).toBe(false);
  });

  it("answers an unreadable journal as the text of why", () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).live.slack.witnessOutcomesJsonl;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{torn\n");

    expect(unwrapErr(journalStoodDown({ home })({ channel: "C0OPS", threadTs: "1.0" }))).toContain("line 1");
  });
});

describe("witnessEmitter", () => {
  it("appends the queue line before printing the same JSON", async () => {
    const order: string[] = [];
    const emit = witnessEmitter({
      appendLine: ({ line, path }) => order.push(`queue ${path} ${line}`),
      queuePath: "/q.jsonl",
      sink: ({ line }) => order.push(`stdout ${line}`),
    });
    const line = {
      activation: false,
      channel: "C0OPS",
      kind: "witness",
      messageTs: "2.0",
      ownThread: false,
      text: "resolved",
      threadTs: "1.0",
      userId: "U0PEER",
      witnessUserId: "U0PEER",
    } as const;
    await emit(line);

    expect(order).toEqual([`queue /q.jsonl ${JSON.stringify(line)}`, `stdout ${JSON.stringify(line)}`]);
  });
});

describe("withWitnessTap", () => {
  it("returns the seams untouched when the setup was never read", () => {
    expect(
      withWitnessTap({
        deps: DEPS,
        follow: true,
        progressLog: () => undefined,
        queuePath: undefined,
        witness: undefined,
      }),
    ).toBe(DEPS);
  });

  it("returns the seams untouched with no peer bot and this bot's own id unknown", () => {
    expect(
      withWitnessTap({
        deps: DEPS,
        follow: true,
        progressLog: () => undefined,
        queuePath: undefined,
        witness: { ...SETUP, bots: [] },
      }),
    ).toBe(DEPS);
  });

  it("taps for the own watch alone when no peer bot is configured", async () => {
    const lines: string[] = [];
    const deps = withWitnessTap({
      deps: { ...DEPS, selfUserId: "U0SELF" },
      follow: true,
      progressLog: ({ line }) => lines.push(line),
      queuePath: undefined,
      witness: { ...SETUP, bots: [] },
    });

    expect(await deps.openConnection({ signal: new AbortController().signal, url: "wss://x" })).not.toBe(CONNECTION);
    expect(lines).toEqual([
      'witness: every thread a person tagged this bot (U0SELF) in — witnessed silently, each message there becomes a {"kind":"witness"} line; nothing is posted from here',
    ]);
  });

  it("names the bots as inert and taps nothing outside --follow", async () => {
    const lines: string[] = [];
    const deps = withWitnessTap({
      deps: DEPS,
      follow: false,
      progressLog: ({ line }) => lines.push(line),
      queuePath: undefined,
      witness: SETUP,
    });

    expect(await deps.openConnection({ signal: new AbortController().signal, url: "wss://x" })).toBe(CONNECTION);
    expect(lines).toEqual([
      "witness: every thread tagging @peerbot (U0PEER) — inert, witnessing runs under --follow only",
    ]);
  });

  it("wraps every opened connection under --follow", async () => {
    const deps = withWitnessTap({
      deps: DEPS,
      follow: true,
      progressLog: () => undefined,
      queuePath: undefined,
      witness: SETUP,
    });
    const opened = await deps.openConnection({ signal: new AbortController().signal, url: "wss://x" });

    expect(opened).not.toBe(CONNECTION);
    expect(opened!.endedBecause()).toBe(undefined);
  });
});
