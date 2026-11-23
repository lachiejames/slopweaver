/**
 * `chair-off-fable`'s source over a real state home: a Codex-held pin is unmeasurable, never cleared off a Fable
 * `spawned` row a Claude session left for the same workspace, while a Claude-held pin is still
 * judged off that row.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readChairOffFable } from "../../../monitor/chairOffFableSource.js";
import { writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { appendSupervisorLink } from "../../../supervisor/chainStore.js";

const scratch: string[] = [];

afterEach(() => {
  scratch.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A home whose pin names the given host in `workspace:29`, and whose ledger booted that workspace on Fable.
 *
 * @param host the pinned session's host
 * @returns the home
 */
function pinnedHome({ host }: { host: "claude-code" | "codex" }): string {
  const home = mkdtempSync(join(tmpdir(), "chair-off-fable-"));
  scratch.push(home);
  writeSupervisorPin({
    home,
    record: {
      pinnedAtIso: "2026-11-05T00:00:00.000Z",
      session: { host, id: "thread-1" },
      workspaceId: "w1",
      workspaceRef: "workspace:29",
    },
  });
  mkdirSync(join(home, "sessions"), { recursive: true });
  writeFileSync(
    join(home, "sessions", "sessions.jsonl"),
    `${JSON.stringify({ bootModel: { kind: "pinned", model: "fable" }, kind: "spawned", workspaceRef: "workspace:29" })}\n`,
  );
  return home;
}

describe("readChairOffFable", () => {
  it("reads a Codex-held pin as unmeasurable, never clear off the workspace's Fable boot row", () => {
    expect(readChairOffFable({ home: pinnedHome({ host: "codex" }) })).toStrictEqual({
      because:
        "the supervisor pin names a Codex thread in workspace:29, which has no Fable requirement and no Claude boot model to read",
      monitorId: "chair-off-fable",
      state: "unmeasurable",
    });
  });

  it("reads a chain-only Codex chair as unmeasurable, never as an unpinned chair", () => {
    const home = mkdtempSync(join(tmpdir(), "chair-off-fable-"));
    scratch.push(home);
    appendSupervisorLink({
      home,
      link: {
        pinnedAtIso: "2026-11-05T00:00:00.000Z",
        session: { host: "codex", id: "019a1a98-9b15-7482-8000-000000000001" },
        source: "pin",
        workspaceId: "w1",
        workspaceRef: "workspace:29",
      },
    });

    expect(readChairOffFable({ home })).toStrictEqual({
      because:
        "no supervisor pin is recorded, and the chain's newest link names Codex thread 019a1a98, which has no Fable requirement and no Claude boot model to read",
      monitorId: "chair-off-fable",
      state: "unmeasurable",
    });
  });

  it("still clears a Claude-held pin whose workspace booted on Fable", () => {
    expect(readChairOffFable({ home: pinnedHome({ host: "claude-code" }) })).toStrictEqual({
      monitorId: "chair-off-fable",
      state: "clear",
    });
  });
});
