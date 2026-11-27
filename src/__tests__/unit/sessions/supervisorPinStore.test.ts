/**
 * The supervisor-pin store — a written pin reads back, and a path that is not a regular file reads as no pin
 * rather than a read that could block `talk offer`'s mint.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  readSupervisorPin,
  readSupervisorPinDisposition,
  supervisorPinPath,
  writeSupervisorPin,
} from "../../../sessions/supervisorPinStore.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "pin-store-"));
  homes.push(home);
  return home;
}

describe("readSupervisorPin", () => {
  it("reads back the pin it wrote", () => {
    const home = freshHome();
    const record = {
      session: { host: "claude-code" as const, id: "sess-super" },
      pinnedAtIso: "2026-09-02T04:47:00.000Z",
      workspaceId: "03A2AD7A",
      workspaceRef: "workspace:936",
    };
    writeSupervisorPin({ home, record });
    expect(readSupervisorPin({ home })).toEqual(record);
  });

  it("answers no pin, without blocking, when the path is a FIFO", () => {
    const home = freshHome();
    const path = supervisorPinPath({ home });
    mkdirSync(join(path, ".."), { recursive: true });
    execFileSync("mkfifo", [path]);
    expect(readSupervisorPin({ home })).toBe(undefined);
  });
});

describe("readSupervisorPinDisposition", () => {
  it("tells a missing pin from one it read", () => {
    const home = freshHome();
    expect(readSupervisorPinDisposition({ home })).toEqual({ kind: "absent" });
    const record = {
      pinnedAtIso: "2026-09-02T04:47:00.000Z",
      session: { host: "codex" as const, id: "thread-1" },
      workspaceId: "03A2AD7A",
      workspaceRef: "workspace:936",
    };
    writeSupervisorPin({ home, record });
    expect(readSupervisorPinDisposition({ home })).toEqual({ kind: "pin", record });
  });

  it("reads a pin carrying both shapes as unreadable, never as absent", () => {
    const home = freshHome();
    const path = supervisorPinPath({ home });
    mkdirSync(join(path, ".."), { recursive: true });
    const mixed = {
      claudeSessionId: "sess-super",
      pinnedAtIso: "2026-09-02T04:47:00.000Z",
      session: { host: "codex", id: "thread-1" },
      workspaceId: "03A2AD7A",
      workspaceRef: "workspace:936",
    };
    writeFileSync(path, JSON.stringify(mixed), "utf8");
    expect(readSupervisorPin({ home })).toBe(undefined);
    expect(readSupervisorPinDisposition({ home })).toEqual({
      kind: "unreadable",
      named: [
        { host: "claude-code", id: "sess-super" },
        { host: "codex", id: "thread-1" },
      ],
      why: "the supervisor pin does not parse as one record shape",
    });
  });

  it("reads a FIFO at the path as unreadable without blocking, naming no session since it read no text", () => {
    const home = freshHome();
    const path = supervisorPinPath({ home });
    mkdirSync(join(path, ".."), { recursive: true });
    execFileSync("mkfifo", [path]);
    const disposition = readSupervisorPinDisposition({ home });
    expect(disposition).toEqual({ kind: "unreadable", named: [], why: expect.stringContaining("would not read: ") });
  });
});
