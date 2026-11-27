import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CODEX_CHAIR_PEER_TRAFFIC_UNREAD } from "../../../supervisor/chain.js";
import { lateWrittenChairs, sortedTurnsOf, walkOwnerWindow } from "../../../supervisor/chainSpanWalk.js";
import { CodexChairReadErrors } from "../../../supervisor/codexChairRead.js";
import type { SupervisorLink } from "../../../supervisor/supervisorLink.js";

/* Every home here is a mkdtemp directory; the one rollout is hand-written, and no real home or rollout is read. */

const THREAD = "a0000302-0000-4000-8000-000000000001";
const CLAUDE = "a0000302-0000-4000-8000-000000000002";
const PINNED_AT = "2026-11-20T08:00:00.000Z";

const env = ({ type, payload, at }: { type: string; payload: unknown; at: string }): string =>
  JSON.stringify({ payload, timestamp: at, type });
const said = ({ text, at }: { text: string; at: string }): string =>
  env({ at, payload: { message: text, type: "user_message" }, type: "event_msg" });

let home: string;
let claudeHome: string;
let codexHome: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "span-home-"));
  claudeHome = mkdtempSync(join(tmpdir(), "span-claude-"));
  codexHome = mkdtempSync(join(tmpdir(), "span-codex-"));
});

afterEach(() => {
  for (const dir of [home, claudeHome, codexHome]) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Write the chair's one rollout — by default two owner turns a minute apart. */
const writeRollout = ({
  turns = [
    said({ at: "2026-11-20T09:01:00.000Z", text: "first" }),
    said({ at: "2026-11-20T09:02:00.000Z", text: "second" }),
  ],
}: { turns?: readonly string[] } = {}): void => {
  const dir = join(codexHome, "sessions", "2026", "11", "20");
  mkdirSync(dir, { recursive: true });
  const lines = [env({ at: "2026-11-20T09:00:00.000Z", payload: { id: THREAD }, type: "session_meta" }), ...turns];
  writeFileSync(join(dir, `rollout-2026-11-20T09-00-00-${THREAD}.jsonl`), `${lines.join("\n")}\n`);
};

/** A pin link at the given instant, carrying the Codex home only when one is given. */
const link = ({
  session,
  at = PINNED_AT,
  recordedHome,
}: {
  session: SupervisorLink["session"];
  at?: string;
  recordedHome?: string;
}): SupervisorLink => ({
  pinnedAtIso: at,
  session,
  source: "pin",
  workspaceId: "w",
  workspaceRef: "workspace:1",
  ...(recordedHome === undefined ? {} : { codexHome: recordedHome }),
});

describe("walkOwnerWindow on a Codex chair", () => {
  it("reads its owner turns off its rollout, oldest first, and names its peer traffic unread", () => {
    writeRollout();
    const window = walkOwnerWindow({
      chain: [link({ recordedHome: codexHome, session: { host: "codex", id: THREAD } })],
      claudeHome,
      home,
      sinceIso: undefined,
    });

    expect(window.walked.map((span) => span.why)).toEqual([""]);
    expect(sortedTurnsOf({ readable: window.walked }).map((turn) => turn.text)).toEqual(["first", "second"]);
    expect(window.walked[0]!.peerGap).toBe(CODEX_CHAIR_PEER_TRAFFIC_UNREAD);
    expect(window.walked[0]!.leg).toEqual({ fromIso: PINNED_AT, sessionId: `codex:${THREAD}`, turns: 2 });
  });

  it("keeps only the turns at or after the caller's floor, and starts the leg there", () => {
    writeRollout();
    const floor = "2026-11-20T09:01:30.000Z";
    const window = walkOwnerWindow({
      chain: [link({ recordedHome: codexHome, session: { host: "codex", id: THREAD } })],
      claudeHome,
      home,
      sinceIso: floor,
    });

    expect(sortedTurnsOf({ readable: window.walked }).map((turn) => turn.text)).toEqual(["second"]);
    expect(window.walked[0]!.leg.fromIso).toBe(floor);
  });

  it("keeps a turn inside its successor's pin millisecond, but before the pin, on the predecessor", () => {
    writeRollout({ turns: [said({ at: "2026-11-20T10:00:00.000200Z", text: "just before the handover" })] });
    const window = walkOwnerWindow({
      chain: [
        link({ recordedHome: codexHome, session: { host: "codex", id: THREAD } }),
        link({ at: "2026-11-20T10:00:00.000500Z", session: { host: "claude-code", id: CLAUDE } }),
      ],
      claudeHome,
      home,
      sinceIso: undefined,
    });
    const codexChair = window.walked.find((span) => span.session.id === THREAD)!;

    expect(codexChair.untilIso).toBe("2026-11-20T10:00:00.000500Z");
    expect(codexChair.turns.map((turn) => turn.text)).toEqual(["just before the handover"]);
  });

  it("raises the floor to a --since inside the pin's own millisecond but after it, dropping a turn before it", () => {
    const pinnedAt = "2026-11-20T10:00:00.000200Z";
    const floor = "2026-11-20T10:00:00.000500Z";
    writeRollout({
      turns: [
        said({ at: "2026-11-20T10:00:00.000300Z", text: "before the floor" }),
        said({ at: "2026-11-20T10:00:00.000600Z", text: "after the floor" }),
      ],
    });
    const window = walkOwnerWindow({
      chain: [link({ at: pinnedAt, recordedHome: codexHome, session: { host: "codex", id: THREAD } })],
      claudeHome,
      home,
      sinceIso: floor,
    });

    expect(window.walked[0]!.leg.fromIso).toBe(floor);
    expect(window.walked[0]!.turns.map((turn) => turn.text)).toEqual(["after the floor"]);
  });

  it("refuses a chair whose home was never recorded, rather than reading it as no turns", () => {
    const window = walkOwnerWindow({
      chain: [link({ session: { host: "codex", id: THREAD } })],
      claudeHome,
      home,
      sinceIso: undefined,
    });
    const refusal = CodexChairReadErrors.homeUnrecorded();

    expect(window.walked[0]!.why).toBe(`${refusal.code}: ${refusal.message}`);
    expect(window.walked[0]!.turns).toEqual([]);
  });
});

describe("lateWrittenChairs", () => {
  it("never walks a Codex chair the floor dropped for traffic, since it has no Claude transcript to stat", () => {
    const window = walkOwnerWindow({
      chain: [
        link({ recordedHome: codexHome, session: { host: "codex", id: THREAD } }),
        link({ at: "2026-11-20T10:00:00.000Z", session: { host: "claude-code", id: CLAUDE } }),
      ],
      claudeHome,
      home,
      sinceIso: "2026-11-20T11:00:00.000Z",
    });

    expect(window.walked.map((span) => span.session.id)).toEqual([CLAUDE]);
    expect(lateWrittenChairs({ sinceIso: "2026-11-20T11:00:00.000Z", window })).toEqual([]);
  });
});
