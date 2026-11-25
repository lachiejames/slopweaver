/**
 * The fixture the chain-read tests share: a throwaway `~/.claude` laid out exactly as the real one is — two
 * project directories for the outgoing and incoming supervisors plus one worker, one transcript each — and a
 * state home holding the chain journal.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unwrap } from "#lib/result.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { appendSupervisorLink } from "../../../supervisor/chainStore.js";
import type { InboundFinding } from "../../../supervisor/inbound.js";
import type { IntakeFinding, IntakeReport } from "../../../supervisor/intake.js";
import type { VisibleSupervisorSession } from "../../../supervisor/session.js";
import { buildSupervisorLink, type SupervisorLink } from "../../../supervisor/supervisorLink.js";

export const OLD = "a0000013-0000-4000-8000-000000000014";
export const NEW = "b3f532df-83e5-495b-b5b8-8b8c3e54d512";
export const PLAIN = "feedb3d7-7ab0-4cac-818b-13bdb201b514";

export const OLD_ASK = "0a335102-005d-4f3d-a2e3-cbbf3fd794c0";
const OLD_LATE = "5863a44b-2326-4b7e-bb5c-52f47acb42a9";
export const NEW_ASK = "6abc179e-8ed6-40b7-9465-cb6c69c929f6";

export const OLD_PINNED = "2026-09-04T22:00:00.000Z";
export const NEW_PINNED = "2026-09-05T02:00:00.000Z";
export const NOW = "2026-09-05T12:00:00.000Z";

export const PEER_LATE = "9a4c1f0e-2b7d-4e55-8c61-0d3f2a9b7e14";
export const PEER_PLAIN = "4b0d9c77-6f21-4d3e-9a58-7c2e5b1f80aa";
const PEER_ANSWERED = "1e6b8d2a-5c3f-4a90-b7e2-6f4d0c8a1b39";

const scratch: string[] = [];

/** Remove every directory this harness minted; each test file registers it in its own `afterEach`. */
export function cleanScratch(): void {
  scratch.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
}

/**
 * A `user` line the way Claude Code writes one.
 *
 * @returns one JSONL line
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

/** An `assistant` line invoking one skill — the marker a rescan looks for. */
function skillLine({ timestamp, skill }: { timestamp: string; skill: string }): string {
  return JSON.stringify({
    message: {
      content: [{ id: "toolu_1", input: { skill }, name: "Skill", type: "tool_use" }],
      role: "assistant",
    },
    timestamp,
    type: "assistant",
    uuid: "a-1",
  });
}

/** A peer message queued mid-turn, the `queued_command` attachment shape Claude Code writes. */
function peerLine({
  msgId,
  sender,
  timestamp,
  uuid,
}: {
  msgId: string;
  sender: string;
  timestamp: string;
  uuid: string;
}): string {
  return JSON.stringify({
    attachment: {
      origin: { body: "report", kind: "peer", msg_id: msgId, name: sender },
      prompt: "<cross-session-message>",
      type: "queued_command",
    },
    timestamp,
    type: "attachment",
    uuid,
  });
}

/** An `assistant` line making one `SendMessage` call, then the user line carrying its successful result. */
function sendLine({ timestamp, to }: { timestamp: string; to: string }): string {
  const call = JSON.stringify({
    message: {
      content: [{ id: "toolu_2", input: { message: "done", to }, name: "SendMessage", type: "tool_use" }],
      role: "assistant",
    },
    timestamp,
    type: "assistant",
    uuid: "a-2",
  });
  const result = JSON.stringify({
    message: { content: [{ content: "{}", tool_use_id: "toolu_2", type: "tool_result" }], role: "user" },
    timestamp,
    toolUseResult: { msg_id: "m-reply", success: true },
    type: "user",
    uuid: "r-2",
  });
  return `${call}\n${result}`;
}

/**
 * A throwaway `~/.claude` with three transcripts: the outgoing supervisor, the incoming one, and a session
 * that never invoked the skill at all.
 *
 * @returns the directory, removed by {@link cleanScratch}
 */
export function claudeHome(): string {
  const claude = mkdtempSync(join(tmpdir(), "slopweaver-chain-claude-"));
  scratch.push(claude);
  const write = ({ dir, session, lines }: { dir: string; session: string; lines: readonly string[] }): void => {
    const project = join(claude, "projects", dir);
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, `${session}.jsonl`), `${lines.join("\n")}\n`, "utf8");
  };
  mkdirSync(join(claude, "sessions"), { recursive: true });
  write({
    dir: "-handoff-9068",
    lines: [
      skillLine({ skill: "slopweaver:supervisor", timestamp: "2026-09-04T22:00:05.000Z" }),
      userLine({ text: "the corpus refresh needs a lock", timestamp: "2026-09-04T23:10:00.000Z", uuid: OLD_ASK }),
      // Typed AFTER the successor took the pin: the successor's turn, not this session's.
      userLine({ text: "still here", timestamp: "2026-09-05T03:00:00.000Z", uuid: OLD_LATE }),
      // A report queued mid-turn AFTER the successor took the pin, which no chair ever answers.
      peerLine({
        msgId: "m-late",
        sender: "live-bot-loop-12sep-a-fb",
        timestamp: "2026-09-05T03:30:00.000Z",
        uuid: PEER_LATE,
      }),
      // A report inside this chair's own span, which the SUCCESSOR later answers.
      peerLine({
        msgId: "m-answered",
        sender: "policy-dm-renders-with-no-show-more-a-no-07",
        timestamp: "2026-09-04T23:30:00.000Z",
        uuid: PEER_ANSWERED,
      }),
    ],
    session: OLD,
  });
  write({
    dir: "-handoff-9069",
    lines: [
      skillLine({ skill: "slopweaver:supervisor", timestamp: "2026-09-05T02:00:05.000Z" }),
      userLine({ text: "brief me", timestamp: "2026-09-05T04:00:00.000Z", uuid: NEW_ASK }),
      sendLine({ timestamp: "2026-09-05T04:10:00.000Z", to: "policy-dm-renders-with-no-show-more-a-no-07" }),
    ],
    session: NEW,
  });
  write({
    dir: "-some-worker",
    lines: [
      skillLine({ skill: "slopweaver:github", timestamp: "2026-09-05T01:00:00.000Z" }),
      userLine({ text: "land it", timestamp: "2026-09-05T01:10:00.000Z", uuid: OLD_ASK }),
      peerLine({ msgId: "m-plain", sender: "worker-77", timestamp: "2026-09-05T01:20:00.000Z", uuid: PEER_PLAIN }),
    ],
    session: PLAIN,
  });
  return claude;
}

/**
 * A throwaway state home whose chain journal holds the given links.
 *
 * @returns the directory, removed by {@link cleanScratch}
 */
export function stateHome({ links }: { links: readonly SupervisorLink[] }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-chain-home-"));
  scratch.push(home);
  links.forEach((link) => {
    appendSupervisorLink({ home, link });
  });
  return home;
}

/**
 * A pin link for a Claude Code session.
 *
 * @returns the link
 */
export function linkFor({ session, at }: { session: string; at: string }): SupervisorLink {
  return unwrapLink({ at, session: { host: "claude-code", id: session } });
}

/**
 * A pin link for a session on either host, or a throw carrying the refusal.
 *
 * @returns the link
 */
export function unwrapLink({ session, at }: { session: VisibleSupervisorSession; at: string }): SupervisorLink {
  return unwrap(
    buildSupervisorLink({
      pinnedAtIso: at,
      session,
      source: "pin",
      target: { kind: "cmux", workspaceId: "W", workspaceRef: "workspace:1" },
    }),
  );
}

export const CHAIN = [linkFor({ at: OLD_PINNED, session: OLD }), linkFor({ at: NEW_PINNED, session: NEW })];

export const NO_DOCS: readonly HandoverDoc[] = [];

/**
 * The finding, or a throw naming why the read was unavailable — the union's `unwrap`, so no assertion branches.
 *
 * @returns the intake finding
 */
export function read({ report }: { report: IntakeReport }): IntakeFinding {
  if (report.kind !== "read") {
    throw new Error(`the intake was unavailable: ${report.why}`);
  }
  return report.finding;
}

/**
 * The inbound half, unwrapped the same way.
 *
 * @returns the inbound finding
 */
export function inboundRead({ report }: { report: IntakeReport }): InboundFinding {
  if (report.kind !== "read") {
    throw new Error(`the intake was unavailable: ${report.why}`);
  }
  return report.inbound;
}
