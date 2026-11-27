import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  readCodexChairOwnerTurns,
  readRecordedCodexChair,
  recordedChairCodexHome,
} from "../../../supervisor/codexChairRead.js";
import { codexMarkTargetRefusal } from "../../../supervisor/intakeMarkTarget.js";
import type { SupervisorLink } from "../../../supervisor/supervisorLink.js";

/* Every Codex home here is a mkdtemp directory holding hand-written rollouts; no real home or rollout is read. */

const THREAD = "a0000301-0000-4000-8000-000000000001";
const OTHER = "a0000301-0000-4000-8000-000000000002";
const CHAIR = { host: "codex", id: THREAD } as const;

const env = ({ type, payload, at }: { type: string; payload: unknown; at: string }): string =>
  JSON.stringify({ payload, timestamp: at, type });
const meta = ({ thread = THREAD }: { thread?: string } = {}): string =>
  env({ at: "2026-11-20T09:00:00.000Z", payload: { id: thread }, type: "session_meta" });
const said = ({ text, at }: { text: string; at: string }): string =>
  env({ at, payload: { message: text, type: "user_message" }, type: "event_msg" });

let codexHome: string;

beforeEach(() => {
  codexHome = mkdtempSync(join(tmpdir(), "codex-chair-"));
});

afterEach(() => {
  rmSync(codexHome, { force: true, recursive: true });
});

/** Write one rollout into the dated tree and return its basename. */
const writeRollout = ({
  lines,
  thread = THREAD,
  stamp = "2026-11-20T09-00-00",
  day = "20",
}: {
  lines: readonly string[];
  thread?: string;
  stamp?: string;
  day?: string;
}): string => {
  const dir = join(codexHome, "sessions", "2026", "11", day);
  mkdirSync(dir, { recursive: true });
  const name = `rollout-${stamp}-${thread}.jsonl`;
  writeFileSync(join(dir, name), `${lines.join("\n")}\n`);
  return name;
};

const link = ({ home, session = CHAIR }: { home?: string; session?: SupervisorLink["session"] }): SupervisorLink => ({
  pinnedAtIso: "2026-11-20T08:00:00.000Z",
  session,
  source: "pin",
  workspaceId: "w",
  workspaceRef: "workspace:1",
  ...(home === undefined ? {} : { codexHome: home }),
});

describe("readCodexChairOwnerTurns", () => {
  it("reads the chair's owner turns off its one rollout, labelled by host and kept inside [since, until)", () => {
    const name = writeRollout({
      lines: [
        meta(),
        said({ at: "2026-11-20T09:01:00.000Z", text: "before the floor" }),
        said({ at: "2026-11-20T09:02:00.000Z", text: "at the floor" }),
        said({ at: "2026-11-20T09:03:00.000Z", text: "at the ceiling" }),
      ],
    });
    writeRollout({
      lines: [meta({ thread: OTHER }), said({ at: "2026-11-20T09:02:30.000Z", text: "not ours" })],
      thread: OTHER,
    });

    const turns = unwrap(
      readCodexChairOwnerTurns({
        codexHome,
        sinceIso: "2026-11-20T09:02:00.000Z",
        threadId: THREAD,
        untilIso: "2026-11-20T09:03:00.000Z",
      }),
    );

    expect(turns.map((turn) => [turn.text, turn.sessionId, turn.source, turn.lineNumber])).toEqual([
      ["at the floor", `codex:${THREAD}`, "unknown", 3],
    ]);
    expect(turns[0]!.pointer).toMatch(new RegExp(`^codex-rollout:${THREAD}#${name}@\\d+$`));
    expect(turns[0]!.turnUuid).toBe(turns[0]!.pointer.slice(`codex-rollout:${THREAD}#`.length));
  });

  it("fails the read on a bad line outside the tenure, because placing it outside needed it read", () => {
    writeRollout({ lines: [meta(), "{torn", said({ at: "2026-11-20T09:05:00.000Z", text: "in" })] });

    const read = readCodexChairOwnerTurns({
      codexHome,
      sinceIso: "2026-11-20T09:04:00.000Z",
      threadId: THREAD,
      untilIso: undefined,
    });

    expect(unwrapErr(read).code).toBe("CODEX_ROLLOUT_INVALID");
    expect(unwrapErr(read).message).toContain("(ROLLOUT_LINE_INVALID): line 2:");
  });

  it("names no rollout as NOT_FOUND, never an empty list", () => {
    writeRollout({ lines: [meta({ thread: OTHER })], thread: OTHER });

    expect(
      unwrapErr(readCodexChairOwnerTurns({ codexHome, sinceIso: undefined, threadId: THREAD, untilIso: undefined }))
        .code,
    ).toBe("CODEX_ROLLOUT_NOT_FOUND");
  });

  it("refuses two rollouts for one thread rather than reading either", () => {
    writeRollout({ lines: [meta()] });
    writeRollout({ day: "21", lines: [meta()], stamp: "2026-11-21T09-00-00" });

    expect(
      unwrapErr(readCodexChairOwnerTurns({ codexHome, sinceIso: undefined, threadId: THREAD, untilIso: undefined }))
        .code,
    ).toBe("CODEX_ROLLOUT_SPLIT");
  });

  it("refuses a walk that passed over a place, since that place could hold the rollout", () => {
    writeRollout({ lines: [meta()] });
    symlinkSync(join(codexHome, "nowhere"), join(codexHome, "sessions", "2026", "11", "22"));

    expect(
      unwrapErr(readCodexChairOwnerTurns({ codexHome, sinceIso: undefined, threadId: THREAD, untilIso: undefined }))
        .code,
    ).toBe("CODEX_ROLLOUT_WALK_INCOMPLETE");
  });
});

describe("recordedChairCodexHome", () => {
  it("reads the one home every link naming the chair recorded, ignoring other chairs' homes", () => {
    const links = [
      link({ home: codexHome }),
      link({}),
      link({ home: "/elsewhere", session: { host: "codex", id: OTHER } }),
    ];

    expect(unwrap(recordedChairCodexHome({ links, session: CHAIR }))).toBe(codexHome);
  });

  it("names a chair with no recorded home UNRECORDED — the desktop-app-hosted Codex chair's case", () => {
    const appLink: SupervisorLink = {
      appSessionId: "app-1",
      pinnedAtIso: "2026-11-20T08:00:00.000Z",
      session: CHAIR,
      source: "pin",
    };

    expect(unwrapErr(recordedChairCodexHome({ links: [appLink], session: CHAIR })).code).toBe("CODEX_HOME_UNRECORDED");
    expect(unwrapErr(recordedChairCodexHome({ links: [], session: CHAIR })).code).toBe("CODEX_HOME_UNRECORDED");
  });

  it("reads no home off a scan link, so a scan-only Codex chair refuses rather than reading past another's pin", () => {
    const scanLink: SupervisorLink = { ...link({ home: codexHome }), source: "scan" };

    expect(unwrapErr(recordedChairCodexHome({ links: [scanLink], session: CHAIR })).code).toBe("CODEX_HOME_UNRECORDED");
  });

  it("refuses two homes for one chair rather than picking one", () => {
    const links = [link({ home: codexHome }), link({ home: "/another" })];

    expect(unwrapErr(recordedChairCodexHome({ links, session: CHAIR })).code).toBe("CODEX_HOME_CONFLICT");
  });

  it("reads the recorded chair end to end through its links", () => {
    writeRollout({ lines: [meta(), said({ at: "2026-11-20T09:01:00.000Z", text: "go" })] });

    const turns = unwrap(
      readRecordedCodexChair({
        links: [link({ home: codexHome })],
        session: CHAIR,
        sinceIso: undefined,
        untilIso: undefined,
      }),
    );

    expect(turns.map((turn) => turn.text)).toEqual(["go"]);
  });
});

describe("codexMarkTargetRefusal", () => {
  it("lets a mark land on an owner turn the rollout holds, and refuses one at another offset or on a failed read", () => {
    writeRollout({ lines: [meta(), said({ at: "2026-11-20T09:01:00.000Z", text: "go" })] });
    const turns = readRecordedCodexChair({
      links: [link({ home: codexHome })],
      session: CHAIR,
      sinceIso: undefined,
      untilIso: undefined,
    });
    const real = unwrap(turns)[0]!.pointer;
    const pointerOf = ({ offset }: { offset: number }) => ({
      byteOffset: offset,
      rolloutName: real.slice(real.indexOf("#") + 1, real.lastIndexOf("@")),
      threadId: THREAD,
    });
    const realOffset = Number(real.slice(real.lastIndexOf("@") + 1));

    expect(codexMarkTargetRefusal({ pointer: pointerOf({ offset: realOffset }), turns })).toBeUndefined();
    expect(codexMarkTargetRefusal({ pointer: pointerOf({ offset: 0 }), turns })).toContain(
      "names none of the owner's turns",
    );
    expect(
      codexMarkTargetRefusal({
        pointer: pointerOf({ offset: realOffset }),
        turns: readRecordedCodexChair({ links: [], session: CHAIR, sinceIso: undefined, untilIso: undefined }),
      }),
    ).toContain("cannot be checked — CODEX_HOME_UNRECORDED:");
  });
});
