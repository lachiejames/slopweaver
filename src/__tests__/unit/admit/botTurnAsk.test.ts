/**
 * `admit/botTurnAsk.ts` — which asks this Claude session is the dispatched worker for, read off a real temp
 * home the live path's own store functions wrote.
 */
import { appendFileSync, chmodSync, readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { botTurnAskForSession } from "../../../admit/botTurnAsk.js";
import { askLifecyclePath } from "../../../live/ask/store.js";
import { workerSessionPath } from "../../../live/turn/workerSessionStore.js";
import { dispatchAsk, ENGINEER, freshHome, OWNER, removeHomes, WORKER_SESSION } from "./botTurnFixture.js";

const dirs: string[] = [];

afterEach(() => {
  removeHomes({ dirs });
});

describe("botTurnAskForSession", () => {
  it("reads a home with no ask log as not a bot turn, rather than throwing", () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });

    expect(botTurnAskForSession({ home, sessionId: WORKER_SESSION })).toStrictEqual({ kind: "not-bot-turn" });
  });

  it("answers unreadable for a worker record that is there but cannot be read, never not-a-bot-turn", () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    const messageTs = "1791000009.000100";
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs });
    const path = workerSessionPath({
      askIdentity: { channel: "C0SYNDEPLOYS01", messageTs, threadTs: messageTs },
      home,
    });
    chmodSync(path, 0o000);

    const match = botTurnAskForSession({ home, sessionId: WORKER_SESSION });
    chmodSync(path, 0o600);

    expect(match).toStrictEqual({ kind: "unreadable", what: path });
  });

  it("holds a named worker on a torn ask-log line, and leaves a session no worker record names alone", () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000010.000100" });
    const log = askLifecyclePath({ home });
    appendFileSync(log, '{"kind":"dispatched","torn\n');

    expect(botTurnAskForSession({ home, sessionId: WORKER_SESSION })).toStrictEqual({
      kind: "unreadable",
      what: `${log} line ${readFileSync(log, "utf8").trimEnd().split("\n").length}`,
    });
    expect(botTurnAskForSession({ home, sessionId: "the-owners-own-session" })).toStrictEqual({ kind: "not-bot-turn" });
  });

  it("names the asker of the ask this session announced itself as the worker for", () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000001.000100" });

    expect(botTurnAskForSession({ home, sessionId: WORKER_SESSION })).toStrictEqual({
      asks: [{ askerUserId: ENGINEER, channel: "C0SYNDEPLOYS01", messageTs: "1791000001.000100", text: undefined }],
      kind: "bot-turn",
    });
  });

  it("does not claim another session's turn, nor one whose worker never announced itself", () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: "another-session", asker: ENGINEER, home, messageTs: "1791000002.000100" });
    dispatchAsk({ announcedAs: undefined, asker: ENGINEER, home, messageTs: "1791000003.000100" });

    expect(botTurnAskForSession({ home, sessionId: WORKER_SESSION })).toStrictEqual({ kind: "not-bot-turn" });
  });

  it("returns every ask one session holds, so a single colleague's ask among the owner's still counts", () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: OWNER, home, messageTs: "1791000004.000100" });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000005.000100" });

    expect(botTurnAskForSession({ home, sessionId: WORKER_SESSION })).toStrictEqual({
      asks: [
        { askerUserId: OWNER, channel: "C0SYNDEPLOYS01", messageTs: "1791000004.000100", text: undefined },
        { askerUserId: ENGINEER, channel: "C0SYNDEPLOYS01", messageTs: "1791000005.000100", text: undefined },
      ],
      kind: "bot-turn",
    });
  });
});
