/**
 * The completion ledger's filesystem edge — same owner-only tightening (P3 finding #9) `judgementProfileStore`
 * already applies to `$home/judgement`, and the same round-trip discipline: what is appended is what is read
 * back.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AskIdentity } from "../../../../live/ask/identity.js";
import { parseTurnCompletionLog } from "../../../../live/turn/completionLog.js";
import {
  appendTurnCompletionEvent,
  completionLogPath,
  liveCompletionSink,
  readTurnCompletionText,
} from "../../../../live/turn/completionStore.js";
import type { TurnCompletion, TurnCompletionEvent } from "../../../../live/turn/envelope.js";
import { stateHomePaths } from "../../../../stateHome.js";

const ASK_IDENTITY: AskIdentity = { channel: "C1", messageTs: "2.2", threadTs: "1.1" };

/** A well-formed answered completion, for the tests below. */
function completion(): TurnCompletion {
  return {
    askIdentity: ASK_IDENTITY,
    primary: { answerTs: "1712345678.000500", kind: "answered" },
    provenance: { modelId: "claude-sonnet-5" },
    secondaryFailures: [],
    turnId: "turn-1",
    workingTs: "1712345678.000300",
  };
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp home with nothing in it. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-completion-store-"));
  fixtureDirs.push(home);
  return home;
}

/** The permission bits of a path, as a POSIX octal string (e.g. "700"). */
function modeOf({ path }: { path: string }): string {
  return (statSync(path).mode & 0o777).toString(8);
}

describe("completionLogPath", () => {
  it("names the log under the state home's ledgers directory", () => {
    expect(completionLogPath({ home: "/state" })).toBe(
      join(stateHomePaths({ home: "/state" }).ledgers, "turn-completions.jsonl"),
    );
  });
});

describe("readTurnCompletionText", () => {
  it("reads an absent log as the empty string, not an error", () => {
    expect(readTurnCompletionText({ home: freshHome() })).toBe("");
  });

  it("reads back exactly what was appended", () => {
    const home = freshHome();
    const event: TurnCompletionEvent = {
      completion: completion(),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };
    appendTurnCompletionEvent({ event, home });

    expect(parseTurnCompletionLog({ text: readTurnCompletionText({ home }) })).toEqual({
      events: [event],
      unreadable: [],
    });
  });
});

describe("appendTurnCompletionEvent", () => {
  it("creates the ledgers directory and file at 0700/0600", () => {
    const home = freshHome();
    const event: TurnCompletionEvent = {
      completion: completion(),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };
    appendTurnCompletionEvent({ event, home });

    const paths = stateHomePaths({ home });
    expect(modeOf({ path: paths.ledgers })).toBe("700");
    expect(modeOf({ path: completionLogPath({ home }) })).toBe("600");
  });

  it("re-tightens an already-existing, previously-permissive ledgers directory", () => {
    const home = freshHome();
    const paths = stateHomePaths({ home });
    mkdirSync(paths.ledgers, { mode: 0o755, recursive: true });
    expect(modeOf({ path: paths.ledgers })).toBe("755");

    const event: TurnCompletionEvent = {
      completion: completion(),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };
    appendTurnCompletionEvent({ event, home });

    expect(modeOf({ path: paths.ledgers })).toBe("700");
  });

  it("appends a second event after the first, rather than overwriting it", () => {
    const home = freshHome();
    const first: TurnCompletionEvent = {
      completion: completion(),
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:00.000Z",
    };
    const second: TurnCompletionEvent = {
      completion: { ...completion(), turnId: "turn-2" },
      kind: "turn-completed",
      tsIso: "2026-08-01T00:00:01.000Z",
    };
    appendTurnCompletionEvent({ event: first, home });
    appendTurnCompletionEvent({ event: second, home });

    expect(parseTurnCompletionLog({ text: readTurnCompletionText({ home }) })).toEqual({
      events: [first, second],
      unreadable: [],
    });
  });
});

describe("liveCompletionSink", () => {
  it("appends the completion under a stamped tsIso from the injected clock", async () => {
    const home = freshHome();
    const sink = liveCompletionSink({ home, nowIso: () => "2026-08-11T00:00:00.000Z" });

    await sink({ completion: completion() });

    expect(parseTurnCompletionLog({ text: readTurnCompletionText({ home }) })).toEqual({
      events: [{ completion: completion(), kind: "turn-completed", tsIso: "2026-08-11T00:00:00.000Z" }],
      unreadable: [],
    });
  });
});
