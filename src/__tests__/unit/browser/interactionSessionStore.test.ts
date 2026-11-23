/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { InteractionSession, PageObservation } from "../../../browser/interactionSession.js";
import {
  interactionSessionDir,
  listInteractionSessionIds,
  readInteractionSession,
  removeInteractionSession,
  removeInteractionWorkspace,
  writeInteractionSession,
} from "../../../browser/interactionSessionStore.js";
import { unwrapErr } from "../../../lib/result.js";

const ID = "5f2a1c30-0000-4000-8000-000000000001";

let home = "";

const session = (): InteractionSession => ({
  clientSession: "slopweaver-5f2a1c30",
  id: ID,
  openedAtIso: "2026-09-16T08:24:00.000Z",
  origins: ["https://ap1.datadoghq.com"],
  owner: { cmuxWorkspace: "WS-1", pid: 4242, runSlug: "some-run-28-sep" },
  ownerSessionId: "agent-1",
  placement: "foreground",
  touchedAtIso: "2026-09-16T08:30:00.000Z",
  workspace: join(home, "client"),
});

const observation = (): PageObservation => ({
  id: "obs-1",
  observedAtIso: "2026-09-16T08:30:00.000Z",
  screenshotPath: "/tmp/look.png",
  snapshotPath: "/tmp/page.yml",
  title: "APM Traces | Datadog",
  url: "https://ap1.datadoghq.com/apm/traces",
});

const openOne = (): string => {
  home = mkdtempSync(join(tmpdir(), "sessionstore-"));
  writeInteractionSession({ home, stored: { observation: observation(), session: session() } });
  return interactionSessionDir({ home, id: ID });
};

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("closing an interaction session", () => {
  it("writes a record a later command can read back", () => {
    openOne();
    expect(readInteractionSession({ home, id: ID })?.session.clientSession).toBe("slopweaver-5f2a1c30");
  });

  it("makes the session unreadable, so no later command can act through it", () => {
    openOne();
    removeInteractionSession({ home, id: ID });
    expect(readInteractionSession({ home, id: ID })).toBe(undefined);
  });

  it("KEEPS the pictures the session took — the evidence of clicks made under the owner's identity", () => {
    const dir = openOne();
    mkdirSync(join(dir, "client"), { recursive: true });
    const picture = join(dir, "client", "act-2026-09-16T08-30-25.708Z.png");
    writeFileSync(picture, "png-bytes");
    removeInteractionSession({ home, id: ID });
    expect(existsSync(picture)).toBe(true);
  });

  it("stops listing a closed session, because the listing reads records rather than directories", () => {
    openOne();
    expect(listInteractionSessionIds({ home })).toEqual([ID]);
    removeInteractionSession({ home, id: ID });
    const stillReadable = listInteractionSessionIds({ home }).filter(
      (id) => readInteractionSession({ home, id }) !== undefined,
    );
    expect(stillReadable).toEqual([]);
  });

  it("is idempotent, so a second close of a session that is already gone is not an error", () => {
    openOne();
    removeInteractionSession({ home, id: ID });
    removeInteractionSession({ home, id: ID });
    expect(readInteractionSession({ home, id: ID })).toBe(undefined);
  });

  it("removes a one-shot look's whole workspace, picture included, and is idempotent", () => {
    const dir = openOne();
    mkdirSync(join(dir, "client"), { recursive: true });
    const picture = join(dir, "client", "look.png");
    writeFileSync(picture, "png-bytes");
    expect(existsSync(picture)).toBe(true);
    expect(removeInteractionWorkspace({ home, id: ID }).isOk()).toBe(true);
    expect(removeInteractionWorkspace({ home, id: ID }).isOk()).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it("refuses an id that is not a minted UUID, so `..` cannot delete every session's directory", () => {
    const dir = openOne();
    const refused = removeInteractionWorkspace({ home, id: ".." });
    expect(unwrapErr(refused)).toEqual(['refused to remove the workspace of "..": not a minted session id']);
    expect(existsSync(dir)).toBe(true);
  });

  it("refuses the nil UUID, which has the hex shape but not the version-4 bits randomUUID() always sets", () => {
    home = mkdtempSync(join(tmpdir(), "sessionstore-"));
    const nil = "00000000-0000-0000-0000-000000000000";
    const dir = interactionSessionDir({ home, id: nil });
    mkdirSync(dir, { recursive: true });
    expect(unwrapErr(removeInteractionWorkspace({ home, id: nil }))).toEqual([
      `refused to remove the workspace of "${nil}": not a minted session id`,
    ]);
    expect(existsSync(dir)).toBe(true);
  });
});

describe("the placement a record carries", () => {
  it("round-trips a session opened to be shown", () => {
    openOne();
    expect(readInteractionSession({ home, id: ID })!.session.placement).toBe("foreground");
  });

  it("reads a record written before the choice existed as background, the way it was opened", () => {
    const dir = openOne();
    const legacy = { observation: null, session: { ...session(), placement: undefined } };
    writeFileSync(join(dir, "session.json"), JSON.stringify(legacy));
    expect(readInteractionSession({ home, id: ID })!.session.placement).toBe("background");
  });

  it("reads a torn value as background, the reading that asks least of the owner's screen", () => {
    const dir = openOne();
    const torn = { observation: null, session: { ...session(), placement: "FOREGROUND" } };
    writeFileSync(join(dir, "session.json"), JSON.stringify(torn));
    expect(readInteractionSession({ home, id: ID })!.session.placement).toBe("background");
  });
});

describe("the opener a record carries", () => {
  it("round-trips the owner a session was opened by", () => {
    openOne();
    expect(readInteractionSession({ home, id: ID })!.session.owner).toEqual({
      cmuxWorkspace: "WS-1",
      pid: 4242,
      runSlug: "some-run-28-sep",
    });
  });

  it("reads a record written before owners were recorded as owner null, not as a failed read", () => {
    const dir = openOne();
    const legacy = { observation: null, session: { ...session(), owner: undefined } };
    writeFileSync(join(dir, "session.json"), JSON.stringify(legacy));
    const stored = readInteractionSession({ home, id: ID })!;
    expect(stored.session.id).toBe(ID);
    expect(stored.session.owner).toBe(null);
  });

  it("refuses a record filed under an id it does not carry, so two directories cannot name one session", () => {
    openOne();
    const copy = "5f2a1c30-0000-4000-8000-000000000002";
    writeInteractionSession({ home, stored: { observation: null, session: { ...session(), id: copy } } });
    writeFileSync(
      join(interactionSessionDir({ home, id: copy }), "session.json"),
      JSON.stringify({ observation: null, session: session() }),
    );
    expect(readInteractionSession({ home, id: copy })).toBe(undefined);
    expect(readInteractionSession({ home, id: ID })!.session.id).toBe(ID);
  });

  it("reads a field of the wrong type as unrecorded rather than trusting it", () => {
    const dir = openOne();
    const torn = {
      observation: null,
      session: { ...session(), owner: { cmuxWorkspace: 7, pid: "4242", runSlug: null } },
    };
    writeFileSync(join(dir, "session.json"), JSON.stringify(torn));
    expect(readInteractionSession({ home, id: ID })!.session.owner).toEqual({
      cmuxWorkspace: null,
      pid: null,
      runSlug: null,
    });
  });
});
