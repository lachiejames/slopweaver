/**
 * `talk supervisor`'s read, over a throwaway `~/.claude` holding one transcript — the path from a session id
 * to the window the voice is handed, and the two ways it has nothing to hand over.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSupervisorWindow, runTalkSupervisor } from "../../../cli/commands/talk/supervisorRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { TalkErrors } from "../../../talk/errors.js";

const SESSION = "a0000036-0000-4000-8000-000000000000";

const LINES = [
  JSON.stringify({
    message: { content: "what is running", role: "user" },
    origin: { kind: "human" },
    promptSource: "typed",
    timestamp: "2026-09-23T12:00:00.000Z",
    type: "user",
    uuid: "u-1",
  }),
  JSON.stringify({
    message: { content: [{ text: "Three seats.", type: "text" }], role: "assistant" },
    timestamp: "2026-09-23T12:00:10.000Z",
    type: "assistant",
    uuid: "a-1",
  }),
];

describe("readSupervisorWindow", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "talk-sup-"));
    mkdirSync(join(root, "claude", "projects", "-repo"), { recursive: true });
    mkdirSync(join(root, "home"));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("reads a named session's transcript into the owner's turns and the chair's replies, newest first", () => {
    writeFileSync(join(root, "claude", "projects", "-repo", `${SESSION}.jsonl`), `${LINES.join("\n")}\n`);
    const read = readSupervisorWindow({
      claudeHome: join(root, "claude"),
      home: join(root, "home"),
      maxBytes: 12_288,
      session: SESSION,
    });
    expect(unwrap(read).exchanges.map((exchange) => `${exchange.who}: ${exchange.text}`)).toEqual([
      "chair: Three seats.",
      "owner: what is running",
    ]);
  });

  it("names the session when it has no transcript", () => {
    const read = readSupervisorWindow({
      claudeHome: join(root, "claude"),
      home: join(root, "home"),
      maxBytes: 12_288,
      session: SESSION,
    });
    expect(unwrapErr(read)).toEqual(TalkErrors.transcriptMissing({ sessionId: SESSION }));
  });

  it("says how to pin a supervisor when no session is named and none is pinned", () => {
    const read = readSupervisorWindow({
      claudeHome: join(root, "claude"),
      home: join(root, "home"),
      maxBytes: 12_288,
      session: undefined,
    });
    expect(unwrapErr(read)).toEqual(
      TalkErrors.supervisorUnresolved({
        why: ["no supervisor pin is recorded — run `slopweaver cmux takeover` in the supervisor"],
      }),
    );
    expect(unwrapErr(read).code).toBe("SUPERVISOR_UNRESOLVED");
  });
});

describe("runTalkSupervisor", () => {
  it("prints its usage on --help", () => {
    expect(runTalkSupervisor(["node", "bin", "talk", "supervisor", "--help"])).toBe(EXIT_OK);
  });

  it("refuses an unknown flag as a usage error", () => {
    expect(runTalkSupervisor(["node", "bin", "talk", "supervisor", "--nope"])).toBe(EXIT_USAGE);
  });
});
