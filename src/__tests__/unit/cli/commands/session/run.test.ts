/**
 * `session record` / `list` / `close` — real filesystem round trips against a temp state home, exactly the
 * genuine fixture round-trip testing.md allows (never a mock of the store).
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runSessionClose, runSessionList, runSessionRecord } from "../../../../../cli/commands/session/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { appendSessionEvent, sessionLogPath } from "../../../../../sessions/sessionStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Build an argv the router would hand a verb: `[node, cli, noun, verb, …rest]`. */
function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "session", verb, ...rest];
}

/** A fresh, empty state home. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-cli-home-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("session record", () => {
  it("prints usage on --help without its act phase", async () => {
    expect(await runSessionRecord(argv({ rest: ["--help"], verb: "record" }))).toBe(EXIT_OK);
  });

  it("requires a session key", async () => {
    expect(await runSessionRecord(argv({ rest: ["--note", "hi", "--home", home()], verb: "record" }))).toBe(EXIT_USAGE);
  });

  it("requires a non-blank --note", async () => {
    expect(await runSessionRecord(argv({ rest: ["a-doc", "--home", home()], verb: "record" }))).toBe(EXIT_USAGE);
    expect(await runSessionRecord(argv({ rest: ["a-doc", "--note", "   ", "--home", home()], verb: "record" }))).toBe(
      EXIT_USAGE,
    );
  });

  it("appends a real, readable line to the ledger", async () => {
    const dir = home();

    expect(await runSessionRecord(argv({ rest: ["a-doc", "--note", "hello", "--home", dir], verb: "record" }))).toBe(
      EXIT_OK,
    );

    const line = JSON.parse(readFileSync(sessionLogPath({ home: dir }), "utf8").trim());
    expect(line.kind).toBe("noted");
    expect(line.sessionKey).toBe("a-doc");
    expect(line.note).toBe("hello");
  });
});

describe("session list", () => {
  it("reports nothing tracked yet for a fresh home", async () => {
    expect(await runSessionList(argv({ rest: ["--home", home()], verb: "list" }))).toBe(EXIT_OK);
  });

  it("shows what record just wrote", async () => {
    const dir = home();
    await runSessionRecord(argv({ rest: ["a-doc", "--note", "hello", "--home", dir], verb: "record" }));

    expect(await runSessionList(argv({ rest: ["--home", dir, "--json"], verb: "list" }))).toBe(EXIT_OK);
  });

  it("rejects a flag it does not know", async () => {
    expect(await runSessionList(argv({ rest: ["--nope"], verb: "list" }))).toBe(EXIT_USAGE);
  });
});

describe("session close", () => {
  it("requires a session key", async () => {
    expect(await runSessionClose(argv({ rest: ["--home", home()], verb: "close" }))).toBe(EXIT_USAGE);
  });

  it("appends a real closed event", async () => {
    const dir = home();
    await runSessionRecord(argv({ rest: ["a-doc", "--note", "hello", "--home", dir], verb: "record" }));

    expect(await runSessionClose(argv({ rest: ["a-doc", "--home", dir], verb: "close" }))).toBe(EXIT_OK);

    const lines = readFileSync(sessionLogPath({ home: dir }), "utf8")
      .trim()
      .split("\n");
    expect(JSON.parse(lines[1]!).kind).toBe("closed");
    expect(JSON.parse(lines[1]!).workspaceRef).toBe(undefined);
  });

  it("--workspace closes only the row it names", async () => {
    const dir = home();

    expect(
      await runSessionClose(argv({ rest: ["a-doc", "--workspace", "workspace:1", "--home", dir], verb: "close" })),
    ).toBe(EXIT_OK);

    const line = JSON.parse(readFileSync(sessionLogPath({ home: dir }), "utf8").trim());
    expect(line.kind).toBe("closed");
    expect(line.workspaceRef).toBe("workspace:1");
  });
});

describe("session list surfaces a corrupt ledger rather than hiding it", () => {
  it("exits non-zero and still prints what it could read", async () => {
    const dir = home();
    appendSessionEvent({ event: { kind: "closed", sessionKey: "a-doc", tsIso: "t" }, home: dir });
    // Corrupt the ledger by hand, after one real event has already landed.
    appendFileSync(sessionLogPath({ home: dir }), "not json\n");

    expect(await runSessionList(argv({ rest: ["--home", dir], verb: "list" }))).toBe(EXIT_ERROR);
  });
});
