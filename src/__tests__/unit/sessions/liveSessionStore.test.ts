/**
 * Reading the session registry off disk, and the rule that makes the result trustworthy: EVERY enumerated
 * file ends up either decoded or refused.
 *
 * That completeness is load-bearing rather than pedantic. A file name is a PID, not a session id, so a file
 * this scan could not read is a session it cannot name — and a caller that then answers "not running" about
 * some other session is guessing. `fleet reap` acts on that answer by ending a drive, so the cost of a silent
 * skip is a running agent's work.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  isBareSessionId,
  readTail,
  scanSessions,
  TITLE_TAIL_BYTES,
  transcriptPathFor,
} from "../../../sessions/liveSessionStore.js";

describe("scanSessions", () => {
  it("decodes a well-formed registry file", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-registry-"));
    writeFileSync(join(dir, "4242.json"), JSON.stringify({ pid: 4242, sessionId: "sess-a" }), "utf8");

    const scan = scanSessions({ sessionsDir: dir });

    expect(scan.records.length).toBe(1);
    expect(scan.records[0]!.sessionId).toBe("sess-a");
    expect(scan.refused).toEqual([]);
  });

  it("reports the whole directory as unreadable when it does not exist — not as zero sessions", () => {
    const scan = scanSessions({ sessionsDir: "/nope/never/here" });

    expect(scan.records).toEqual([]);
    expect(scan.unreadable).toContain("could not be read");
  });

  it("refuses a file that decodes to no pid, naming it", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-registry-"));
    writeFileSync(join(dir, "9.json"), JSON.stringify({ sessionId: "sess-b" }), "utf8");

    const scan = scanSessions({ sessionsDir: dir });

    expect(scan.records).toEqual([]);
    expect(scan.refused.length).toBe(1);
    expect(scan.refused[0]).toContain("9.json");
  });

  it("refuses a file holding a byte that is not UTF-8, rather than reading it as U+FFFD", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-registry-"));
    const head = Buffer.from('{"pid":1234,"sessionId":"sess-', "utf8");
    const tail = Buffer.from('d"}', "utf8");
    writeFileSync(join(dir, "1234.json"), Buffer.concat([head, Buffer.from([0xff]), tail]));

    const scan = scanSessions({ sessionsDir: dir });

    expect(scan.records).toEqual([]);
    expect(scan.refused).toEqual(["1234.json: holds bytes that are not UTF-8"]);
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses a file past the whole-read cap, whose tail alone would hide a bad byte before it", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-registry-"));
    const record = Buffer.from(JSON.stringify({ pid: 4321, sessionId: "sess-e" }), "utf8");
    const padding = Buffer.alloc(TITLE_TAIL_BYTES - record.length, " ");
    writeFileSync(join(dir, "4321.json"), Buffer.concat([Buffer.from([0xff]), padding, record]));

    const scan = scanSessions({ sessionsDir: dir });

    expect(scan.records).toEqual([]);
    expect(scan.refused).toEqual([
      `4321.json: is larger than the ${String(TITLE_TAIL_BYTES)} bytes a registry file is read whole in`,
    ]);
    rmSync(dir, { force: true, recursive: true });
  });

  /**
   * Reproduced before it was believed: an adversarial review pass claimed a permission error was swallowed by
   * the same branch as a vanished file. It was. `records: 0, refused: [], unreadable: undefined` is a roster
   * that confidently answers "this session is not running".
   */
  it("reports a PRESENT but unopenable file as a refusal rather than silently skipping it", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-registry-"));
    const file = join(dir, "4242.json");
    writeFileSync(file, JSON.stringify({ pid: 4242, sessionId: "sess-a" }), "utf8");
    chmodSync(file, 0o000);

    const scan = scanSessions({ sessionsDir: dir });
    chmodSync(file, 0o644);

    expect(scan.records).toEqual([]);
    expect(scan.unreadable).toBeUndefined();
    expect(scan.refused.length).toBe(1);
    expect(scan.refused[0]).toContain("4242.json");
  });

  it("reports an empty directory as zero sessions with nothing refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-registry-"));

    const scan = scanSessions({ sessionsDir: dir });

    expect(scan.records).toEqual([]);
    expect(scan.refused).toEqual([]);
    expect(scan.unreadable).toBeUndefined();
  });

  /**
   * A third adversarial round found this one. A file listed by `readdirSync` and unlinked before it is opened
   * raises ENOENT, and skipping it left `refused` empty — so a roster that had NOT accounted for every
   * enumerated file still answered "not running" about other sessions, which `fleet reap` acts on by ending a
   * drive. The name is a PID, not a session id, so nothing can say whose file vanished.
   */
  it("refuses a file that VANISHED between the listing and the read, rather than skipping it", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-registry-"));
    const file = join(dir, "5150.json");
    writeFileSync(file, JSON.stringify({ pid: 5150, sessionId: "sess-c" }), "utf8");
    // Stand in for the race: the directory listing sees it, the read does not.
    rmSync(file);

    const scan = scanSessions({ names: ["5150.json"], sessionsDir: dir });

    expect(scan.records).toEqual([]);
    expect(scan.refused.length).toBe(1);
    expect(scan.refused[0]).toContain("5150.json");
  });
});

describe("readTail", () => {
  it("reads the last bytes of a regular file", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-tail-"));
    writeFileSync(join(dir, "t.jsonl"), "abcdef", "utf8");
    expect(readTail({ maxBytes: 3, path: join(dir, "t.jsonl") })).toBe("def");
    rmSync(dir, { force: true, recursive: true });
  });

  it("refuses anything but a regular file, since opening a FIFO blocks until a writer appears", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-tail-"));
    expect(() => readTail({ maxBytes: 3, path: dir })).toThrow("is not a regular file");
    rmSync(dir, { force: true, recursive: true });
  });

  it("reads a file that fits whole when asked to, and throws on one past the cap rather than tailing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-tail-"));
    writeFileSync(join(dir, "t.json"), "abc", "utf8");
    expect(readTail({ maxBytes: 3, path: join(dir, "t.json"), whole: true })).toBe("abc");
    expect(() => readTail({ maxBytes: 2, path: join(dir, "t.json"), whole: true })).toThrow("past the 2 read whole");
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("transcriptPathFor", () => {
  it("finds a transcript past directories that miss and a stray file that is no directory at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-projects-"));
    mkdirSync(join(dir, "-a-miss"));
    writeFileSync(join(dir, "-b-stray-file"), "", "utf8");
    mkdirSync(join(dir, "-c-holder"));
    writeFileSync(join(dir, "-c-holder", "s-1.jsonl"), "", "utf8");
    expect(transcriptPathFor({ projectsDir: dir, sessionId: "s-1" })).toBe(join(dir, "-c-holder", "s-1.jsonl"));
    rmSync(dir, { force: true, recursive: true });
  });

  it("answers undefined for a session no directory holds", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-projects-"));
    mkdirSync(join(dir, "-a-miss"));
    writeFileSync(join(dir, "-b-stray-file"), "", "utf8");
    expect(transcriptPathFor({ projectsDir: dir, sessionId: "s-2" })).toBeUndefined();
    rmSync(dir, { force: true, recursive: true });
  });

  it("never resolves an id carrying a path separator to a file outside the projects tree", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-claude-home-"));
    const projectsDir = join(home, "projects");
    mkdirSync(join(projectsDir, "only-project"), { recursive: true });
    mkdirSync(join(home, "outside"));
    writeFileSync(join(home, "outside", "not-the-codex-rollout.jsonl"), "{}\n", "utf8");
    const sessionId = "../../outside/not-the-codex-rollout";
    expect(existsSync(join(projectsDir, "only-project", `${sessionId}.jsonl`))).toBe(true);
    expect(transcriptPathFor({ projectsDir, sessionId })).toBeUndefined();
    expect(transcriptPathFor({ projectsDir, sessionId: "..\\..\\outside\\not-the-codex-rollout" })).toBeUndefined();
    rmSync(home, { force: true, recursive: true });
  });
});

describe("isBareSessionId", () => {
  it("accepts a UUID-shaped id and refuses an empty id, a separator, a parent segment or padding", () => {
    expect(isBareSessionId({ sessionId: "a0000066-0000-4000-8000-000000000072" })).toBe(true);
    expect(isBareSessionId({ sessionId: "" })).toBe(false);
    expect(isBareSessionId({ sessionId: "a/b" })).toBe(false);
    expect(isBareSessionId({ sessionId: "a\\b" })).toBe(false);
    expect(isBareSessionId({ sessionId: ".." })).toBe(false);
    expect(isBareSessionId({ sessionId: "." })).toBe(false);
    expect(isBareSessionId({ sessionId: " 019a1b2c" })).toBe(false);
  });
});
