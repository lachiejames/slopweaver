/*
 * What the `profile words` test files share: the chair session ids, a pin link, the two writes `cmux takeover`
 * makes, a `user` transcript line, a throwaway `~/.claude`, and the throwaway directories each case writes a state
 * home or a Claude home into, removed after every case by the `afterEach` that `useTempDirs()` registers.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

import { writeSupervisorPin } from "../../../../sessions/supervisorPinStore.js";
import type { SupervisorLink } from "../../../../supervisor/chain.js";
import { appendSupervisorLink } from "../../../../supervisor/chainStore.js";

export const A = "a0000013-0000-4000-8000-000000000014";
export const B = "b3f532df-83e5-495b-b5b8-8b8c3e54d512";
export const GONE = "ffffffff-ffff-4fff-8fff-ffffffffffff";

export const A_FIRST = "0a335102-005d-4f3d-a2e3-cbbf3fd794c0";
export const B_TURN = "6abc179e-8ed6-40b7-9465-cb6c69c929f6";
export const B_AFTER = "9a4c1f0e-2b7d-4e55-8c61-0d3f2a9b7e14";

const scratch: string[] = [];

/** Register the `afterEach` that removes every directory minted since the last case. Call it once per test file. */
export function useTempDirs(): void {
  afterEach(() => {
    scratch.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });
}

/**
 * A fresh temp directory, removed after the test.
 *
 * @returns the new directory's absolute path
 */
export function temp({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/**
 * A pin link.
 *
 * @returns the link `cmux takeover` journals when that session takes the pin at that instant
 */
export function pin({ session, at }: { session: string; at: string }): SupervisorLink {
  return {
    pinnedAtIso: at,
    session: { host: "claude-code", id: session },
    source: "pin",
    workspaceId: `ws-${session}`,
    workspaceRef: "w:1",
  };
}

/** Journal every link and record the last as the live pin, the two writes `cmux takeover` makes. */
export function seat({ home, links }: { home: string; links: readonly SupervisorLink[] }): void {
  links.forEach((link) => {
    appendSupervisorLink({ home, link });
  });
  // oxlint-disable-next-line typescript/no-non-null-assertion -- every caller seats at least one link; a guard would add a failure path the old in-file helper never had
  const { pinnedAtIso, session, workspaceId, workspaceRef } = links.at(-1)!;
  writeSupervisorPin({ home, record: { pinnedAtIso, session, workspaceId, workspaceRef } });
}

/**
 * One tenure of a Claude Code chair, as `wordTenures` reports it.
 *
 * @returns the tenure record with the chair named by host and id
 */
export function tenure({ id, from, until }: { id: string; from: string; until: string | undefined }): {
  fromIso: string;
  session: { host: "claude-code"; id: string };
  untilIso: string | undefined;
} {
  return { fromIso: from, session: { host: "claude-code", id }, untilIso: until };
}

/**
 * A `user` line the way Claude Code writes one.
 *
 * @returns the line as one JSON string, with no trailing newline
 */
export function userLine({ uuid, timestamp, text }: { uuid: string; timestamp: string; text: string }): string {
  return JSON.stringify({
    cwd: "/repo",
    message: { content: [{ text, type: "text" }], role: "user" },
    timestamp,
    type: "user",
    uuid,
  });
}

/**
 * A throwaway `~/.claude` holding one transcript per session given.
 *
 * @returns the Claude home's absolute path, removed after the test
 */
export function claudeHomeWith({ transcripts }: { transcripts: Readonly<Record<string, readonly string[]>> }): string {
  const dir = temp({ prefix: "words-claude-" });
  Object.entries(transcripts).forEach(([session, lines], index) => {
    const project = join(dir, "projects", `-project-${String(index)}`);
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, `${session}.jsonl`), `${lines.join("\n")}\n`, "utf8");
  });
  return dir;
}
