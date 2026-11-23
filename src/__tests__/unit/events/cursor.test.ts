import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readSupervisorEventCursor,
  SupervisorCursorErrors,
  supervisorEventCursorPath,
  writeSupervisorEventCursor,
} from "../../../events/cursor.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-cursor-"));
  fixtureDirs.push(dir);
  return dir;
};

describe("a cursor name", () => {
  it("resolves a plain name to a file under the home", () => {
    const dir = home();
    expect(unwrap(supervisorEventCursorPath({ home: dir, name: "supervisor" }))).toBe(
      join(dir, "live", "events", "cursors", "supervisor.json"),
    );
  });

  it("accepts hyphens and digits", () => {
    expect(unwrap(supervisorEventCursorPath({ home: home(), name: "sweep-2" })).endsWith("sweep-2.json")).toBe(true);
  });

  it("refuses a traversal rather than sanitising it into a different cursor", () => {
    const refusal = unwrapErr(supervisorEventCursorPath({ home: home(), name: "../../etc/thing" }));
    expect(refusal.length).toBe(1);
    expect(refusal[0]!.includes("not usable")).toBe(true);
  });

  it("refuses to read under an unusable name with its own code, apart from an untrusted file", () => {
    expect(unwrapErr(readSupervisorEventCursor({ home: home(), name: "../oops" })).code).toBe("CURSOR_NAME_UNUSABLE");
  });

  it("refuses an empty name", () => {
    expect(unwrapErr(supervisorEventCursorPath({ home: home(), name: "" })).length).toBe(1);
  });

  it("refuses uppercase, so two spellings can never become two cursors for one reader", () => {
    expect(unwrapErr(supervisorEventCursorPath({ home: home(), name: "Supervisor" })).length).toBe(1);
  });
});

describe("reading and writing", () => {
  it("reads undefined before anything has been recorded", () => {
    expect(unwrap(readSupervisorEventCursor({ home: home(), name: "supervisor" }))).toBe(undefined);
  });

  it("round-trips an offset and its stamp", () => {
    const dir = home();
    unwrap(
      writeSupervisorEventCursor({ home: dir, name: "supervisor", nowIso: "2026-08-23T04:00:00.000Z", offset: 512 }),
    );
    expect(unwrap(readSupervisorEventCursor({ home: dir, name: "supervisor" }))).toStrictEqual({
      offset: 512,
      recordedAtIso: "2026-08-23T04:00:00.000Z",
    });
  });

  it("keeps two names as two independent positions", () => {
    const dir = home();
    unwrap(
      writeSupervisorEventCursor({ home: dir, name: "supervisor", nowIso: "2026-08-23T04:00:00.000Z", offset: 9 }),
    );
    unwrap(writeSupervisorEventCursor({ home: dir, name: "ad-hoc", nowIso: "2026-08-23T04:00:00.000Z", offset: 400 }));
    expect(unwrap(readSupervisorEventCursor({ home: dir, name: "supervisor" }))?.offset).toBe(9);
    expect(unwrap(readSupervisorEventCursor({ home: dir, name: "ad-hoc" }))?.offset).toBe(400);
  });

  it("overwrites a name's previous position rather than appending a second one", () => {
    const dir = home();
    unwrap(
      writeSupervisorEventCursor({ home: dir, name: "supervisor", nowIso: "2026-08-23T04:00:00.000Z", offset: 9 }),
    );
    unwrap(
      writeSupervisorEventCursor({ home: dir, name: "supervisor", nowIso: "2026-08-23T04:05:00.000Z", offset: 99 }),
    );
    expect(unwrap(readSupervisorEventCursor({ home: dir, name: "supervisor" }))?.offset).toBe(99);
  });

  it("refuses to write under an unusable name", () => {
    const refusal = unwrapErr(
      writeSupervisorEventCursor({ home: home(), name: "../oops", nowIso: "2026-08-23T04:00:00.000Z", offset: 1 }),
    );
    expect(refusal[0]!.includes("not usable")).toBe(true);
  });
});

describe("a cursor that cannot be trusted", () => {
  it("refuses a file that is not JSON rather than rewinding to offset 0", () => {
    const dir = home();
    const path = unwrap(supervisorEventCursorPath({ home: dir, name: "supervisor" }));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    expect(unwrapErr(readSupervisorEventCursor({ home: dir, name: "supervisor" }))).toEqual(
      SupervisorCursorErrors.untrusted({ detail: "it is not JSON", path }),
    );
  });

  it("refuses an offset that is not a number", () => {
    const dir = home();
    const path = unwrap(supervisorEventCursorPath({ home: dir, name: "supervisor" }));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ offset: "512" }));
    expect(unwrapErr(readSupervisorEventCursor({ home: dir, name: "supervisor" })).message).toContain(
      "(its offset is not a non-negative integer)",
    );
  });

  it("refuses an instant that is there but not a string", () => {
    const dir = home();
    const path = unwrap(supervisorEventCursorPath({ home: dir, name: "supervisor" }));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ offset: 9, recordedAtIso: 123 }));
    expect(unwrapErr(readSupervisorEventCursor({ home: dir, name: "supervisor" })).message).toContain(
      "(its recordedAtIso is not a string)",
    );
  });

  it("refuses an explicit null instant as a wrong-shaped record, since a writer omits one it does not have", () => {
    const dir = home();
    const path = unwrap(supervisorEventCursorPath({ home: dir, name: "supervisor" }));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ offset: 12, recordedAtIso: null }));
    expect(unwrapErr(readSupervisorEventCursor({ home: dir, name: "supervisor" })).message).toContain(
      "(its recordedAtIso is not a string)",
    );
  });

  it("refuses a negative offset", () => {
    const dir = home();
    const path = unwrap(supervisorEventCursorPath({ home: dir, name: "supervisor" }));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ offset: -1 }));
    expect(unwrapErr(readSupervisorEventCursor({ home: dir, name: "supervisor" })).message).toContain(
      "(its offset is not a non-negative integer)",
    );
  });

  it("keeps an offset whose instant is missing, with no instant", () => {
    const dir = home();
    const path = unwrap(supervisorEventCursorPath({ home: dir, name: "supervisor" }));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ offset: 12 }));
    expect(unwrap(readSupervisorEventCursor({ home: dir, name: "supervisor" }))).toEqual({
      offset: 12,
    });
  });
});
