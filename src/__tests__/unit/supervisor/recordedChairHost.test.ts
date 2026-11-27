import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SupervisorPinRecord } from "../../../sessions/supervisorPin.js";
import { supervisorPinPath } from "../../../sessions/supervisorPinStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { SupervisorLink } from "../../../supervisor/chain.js";
import { appendSupervisorLink } from "../../../supervisor/chainStore.js";
import { readRecordedChair, readRecordedChairHost, recordedChairOf } from "../../../supervisor/recordedChairHost.js";
import type { VisibleSupervisorSession } from "../../../supervisor/session.js";

const CLAUDE: VisibleSupervisorSession = { host: "claude-code", id: "a0000013-0000-4000-8000-000000000014" };
const CODEX: VisibleSupervisorSession = { host: "codex", id: "019a1a98-9b15-7482-8000-000000000001" };

const link = ({ session, at }: { session: VisibleSupervisorSession; at: string }): SupervisorLink => ({
  pinnedAtIso: at,
  session,
  source: "pin",
  workspaceId: "W",
  workspaceRef: "workspace:1",
});

const pin = ({ session }: { session: VisibleSupervisorSession }): SupervisorPinRecord => ({
  pinnedAtIso: "2026-11-05T00:00:00.000Z",
  session,
  workspaceId: "W",
  workspaceRef: "workspace:1",
});

/** A pin carrying BOTH the canonical Codex session and a legacy Claude id — the shape no writer produces. */
const MIXED_PIN = {
  claudeSessionId: CLAUDE.id,
  pinnedAtIso: "2026-11-05T04:00:00.000Z",
  session: CODEX,
  workspaceId: "W",
  workspaceRef: "workspace:1",
};

const ABSENT = { kind: "absent" } as const;
const clean = ({
  links,
}: {
  links: readonly SupervisorLink[];
}): { links: readonly SupervisorLink[]; problems: readonly string[] } => ({
  links,
  problems: [],
});

const scratch: string[] = [];

const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-chair-host-"));
  scratch.push(home);
  return home;
};

afterEach(() => {
  scratch.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("recordedChairOf", () => {
  it("takes the pin's session when there is a pin, whatever the chain's newest link names", () => {
    const chain = clean({ links: [link({ at: "2026-11-05T03:00:00.000Z", session: CODEX })] });

    expect(recordedChairOf({ chain, pin: { kind: "pin", record: pin({ session: CLAUDE }) } })).toEqual({
      kind: "session",
      pinnedAtIso: "2026-11-05T00:00:00.000Z",
      session: CLAUDE,
    });
  });

  it("takes the chain's newest link with the pin absent, so a Codex chair is never read through a Claude tab", () => {
    const chain = clean({
      links: [
        link({ at: "2026-11-05T03:00:00.000Z", session: CODEX }),
        link({ at: "2026-11-05T01:00:00.000Z", session: CLAUDE }),
      ],
    });

    expect(recordedChairOf({ chain, pin: ABSENT })).toEqual({
      kind: "session",
      pinnedAtIso: "2026-11-05T03:00:00.000Z",
      session: CODEX,
    });
  });

  it("is unresolved, never the older Claude link, when the pin is there and does not parse", () => {
    const chain = clean({ links: [link({ at: "2026-11-05T01:00:00.000Z", session: CLAUDE })] });

    expect(recordedChairOf({ chain, pin: { kind: "unreadable", named: [], why: "pin shape" } })).toEqual({
      kind: "unresolved",
      why: "pin shape",
    });
  });

  it("is unresolved beside a valid Claude pin when a chain line was refused, never the pin's Claude chair", () => {
    const chain = { links: [link({ at: "2026-11-05T01:00:00.000Z", session: CLAUDE })], problems: ["1 line"] };

    expect(recordedChairOf({ chain, pin: { kind: "pin", record: pin({ session: CLAUDE }) } })).toEqual({
      kind: "unresolved",
      why: "1 line",
    });
  });

  it("is unresolved when the pin's own instant will not parse, never a session with an unusable floor (Codex 4c plan)", () => {
    const record = { ...pin({ session: CODEX }), pinnedAtIso: "not-a-date" };

    expect(recordedChairOf({ chain: clean({ links: [] }), pin: { kind: "pin", record } })).toEqual({
      kind: "unresolved",
      why: "the supervisor pin carries an instant that does not parse",
    });
  });

  it("is unresolved when a chain line was refused, since it could be the newest link", () => {
    const chain = { links: [link({ at: "2026-11-05T01:00:00.000Z", session: CLAUDE })], problems: ["1 line"] };

    expect(recordedChairOf({ chain, pin: ABSENT })).toEqual({ kind: "unresolved", why: "1 line" });
  });

  it("is unresolved when a link's instant will not parse, rather than letting an older link win", () => {
    const chain = clean({
      links: [link({ at: "not-a-date", session: CODEX }), link({ at: "2026-11-05T01:00:00.000Z", session: CLAUDE })],
    });

    expect(recordedChairOf({ chain, pin: ABSENT }).kind).toBe("unresolved");
  });

  it("is absent with no pin and an empty chain", () => {
    expect(recordedChairOf({ chain: clean({ links: [] }), pin: ABSENT })).toEqual({ kind: "absent" });
  });
});

describe("readRecordedChairHost", () => {
  it("reads a Codex chair off a home holding only a chain journal", () => {
    const home = freshHome();
    appendSupervisorLink({ home, link: link({ at: "2026-11-05T03:00:00.000Z", session: CODEX }) });

    expect(readRecordedChairHost({ home })).toBe("codex");
    expect(readRecordedChair({ home })).toEqual({
      kind: "session",
      pinnedAtIso: "2026-11-05T03:00:00.000Z",
      session: CODEX,
    });
  });

  it("names no host for an empty home", () => {
    expect(readRecordedChairHost({ home: freshHome() })).toBe(undefined);
  });

  it("is unresolved for a mixed Codex pin beside an older Claude chain link, never claude-code", () => {
    const home = freshHome();
    appendSupervisorLink({ home, link: link({ at: "2026-11-05T01:00:00.000Z", session: CLAUDE }) });
    const path = supervisorPinPath({ home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(MIXED_PIN), "utf8");

    expect(readRecordedChairHost({ home })).toBe("unresolved");
  });

  it("is unresolved with no pin when a newer mixed chain line follows an older Claude link", () => {
    const home = freshHome();
    appendSupervisorLink({ home, link: link({ at: "2026-11-05T01:00:00.000Z", session: CLAUDE }) });
    appendFileSync(
      stateHomePaths({ home }).supervisorChainJsonl,
      `${JSON.stringify({ ...MIXED_PIN, source: "pin" })}\n`,
      "utf8",
    );

    expect(readRecordedChairHost({ home })).toBe("unresolved");
  });
});
