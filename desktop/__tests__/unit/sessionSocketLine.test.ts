/*
 * The control plane's socket reads one JSON line per request: anything else is refused with BAD_REQUEST, echoing the
 * request id whenever one could be read so the caller can match the refusal. And the socket is served only from a real
 * owner-only directory, checked over a temp-dir fixture (a symlink spelled with a trailing slash included).
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_HARNESS_PROTOCOL_VERSION } from "../../src/sessionControlProtocol";
import { ownerOnlyDirectory, parseRequestLine, socketInsideDirectory } from "../../src/sessionSocketServer";

/** A Codex launch within the bound, which a case lengthens one field of. */
const LAUNCH = {
  codexHome: "/h/codex-one",
  directory: "/work/acme",
  judgedInstanceId: "instance-a",
  ledgerKey: "abc-1",
  title: "abc-1",
  vendor: "codex",
};

function lineOf({ request, version }: { request: unknown; version: number }): string {
  return JSON.stringify({ protocolVersion: version, request, requestId: "r3" });
}

function refusedWith({ message }: { message: string }): unknown {
  return {
    code: "BAD_REQUEST",
    message,
    outcome: "refused",
    protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
    requestId: "r3",
  };
}

describe("parseRequestLine", () => {
  it("reads a request this version accepts", () => {
    const line = JSON.stringify({
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      request: { kind: "ping" },
      requestId: "r1",
    });
    expect(parseRequestLine({ line })._unsafeUnwrap().requestId).toBe("r1");
  });

  it("refuses a line that is not JSON, with no id to echo", () => {
    const refused = parseRequestLine({ line: "{nope" })._unsafeUnwrapErr();
    expect(refused).toEqual({
      code: "BAD_REQUEST",
      message: "the line is not JSON",
      outcome: "refused",
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      requestId: "",
    });
  });

  it("refuses another version's request, echoing its id", () => {
    const line = JSON.stringify({
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION + 1,
      request: { kind: "ping" },
      requestId: "r2",
    });
    const refused = parseRequestLine({ line })._unsafeUnwrapErr();
    expect(refused).toEqual({
      code: "BAD_REQUEST",
      message: `not a protocol v${String(APP_HARNESS_PROTOCOL_VERSION)} request`,
      outcome: "refused",
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      requestId: "r2",
    });
  });

  it("refuses each launch kind with a title or ledger key past the bound, naming the field and the limit", () => {
    const pastBound = "a".repeat(201);
    const requests = [
      { kind: "launch.prepare", spec: { ...LAUNCH, title: pastBound } },
      { kind: "launch.prepare", spec: { ...LAUNCH, ledgerKey: pastBound } },
      { kind: "launch.resume", sessionId: "0b5e", spec: { ...LAUNCH, title: pastBound } },
      { kind: "launch.resume", sessionId: "0b5e", spec: { ...LAUNCH, ledgerKey: pastBound } },
    ];
    const refusals = requests.map((request) =>
      parseRequestLine({ line: lineOf({ request, version: APP_HARNESS_PROTOCOL_VERSION }) })._unsafeUnwrapErr(),
    );
    expect(refusals).toEqual([
      refusedWith({ message: "launch.prepare spec.title must be at most 200 characters" }),
      refusedWith({ message: "launch.prepare spec.ledgerKey must be at most 200 characters" }),
      refusedWith({ message: "launch.resume spec.title must be at most 200 characters" }),
      refusedWith({ message: "launch.resume spec.ledgerKey must be at most 200 characters" }),
    ]);
  });

  it("reads a launch of either kind whose title and ledger key are at the bound", () => {
    const atBound = "a".repeat(200);
    const spec = { ...LAUNCH, ledgerKey: atBound, title: atBound };
    const requests = [
      { kind: "launch.prepare", spec },
      { kind: "launch.resume", sessionId: "0b5e", spec },
    ];
    expect(
      requests.map(
        (request) =>
          parseRequestLine({ line: lineOf({ request, version: APP_HARNESS_PROTOCOL_VERSION }) })._unsafeUnwrap().request
            .kind,
      ),
    ).toEqual(["launch.prepare", "launch.resume"]);
  });

  it("names the bound only at this version, and keeps the version refusal for another version's overlong launch", () => {
    const request = { kind: "launch.prepare", spec: { ...LAUNCH, title: "a".repeat(201) } };
    const refusals = [APP_HARNESS_PROTOCOL_VERSION, APP_HARNESS_PROTOCOL_VERSION + 1].map((version) =>
      parseRequestLine({ line: lineOf({ request, version }) })._unsafeUnwrapErr(),
    );
    expect(refusals).toEqual([
      refusedWith({ message: "launch.prepare spec.title must be at most 200 characters" }),
      refusedWith({ message: `not a protocol v${String(APP_HARNESS_PROTOCOL_VERSION)} request` }),
    ]);
  });
});

describe("socketInsideDirectory", () => {
  it("accepts a socket directly in the owner-only directory", () => {
    expect(
      socketInsideDirectory({ directory: "/tmp/slopweaver-501", socket: "/tmp/slopweaver-501/s.sock" }).isOk(),
    ).toBe(true);
  });

  it("refuses a socket outside the directory, whose mode would not protect it", () => {
    expect(
      socketInsideDirectory({ directory: "/tmp/slopweaver-501", socket: "/tmp/session.sock" })._unsafeUnwrapErr(),
    ).toBe(
      "/tmp/session.sock is not directly inside /tmp/slopweaver-501, so that directory's mode would not protect it",
    );
  });

  it("refuses a path that climbs out of the directory", () => {
    expect(
      socketInsideDirectory({
        directory: "/tmp/slopweaver-501",
        socket: "/tmp/slopweaver-501/../s.sock",
      })._unsafeUnwrapErr(),
    ).toContain("is not directly inside /tmp/slopweaver-501");
  });

  it("refuses a .. that only lexically lands inside, since the kernel follows a symlink before it", () => {
    expect(
      socketInsideDirectory({
        directory: "/tmp/slopweaver-501",
        socket: "/tmp/slopweaver-501/jump/../s.sock",
      })._unsafeUnwrapErr(),
    ).toBe(
      "/tmp/slopweaver-501/jump/../s.sock is not directly inside /tmp/slopweaver-501, so that directory's mode would not protect it",
    );
  });

  it("refuses a relative socket path", () => {
    expect(socketInsideDirectory({ directory: "/tmp/slopweaver-501", socket: "s.sock" })._unsafeUnwrapErr()).toContain(
      "is not directly inside",
    );
  });
});

describe("ownerOnlyDirectory", () => {
  let root = "";
  let target = "";
  let link = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sw-own-"));
    target = join(root, "real");
    link = join(root, "link");
    mkdirSync(target, { mode: 0o700 });
    chmodSync(target, 0o700);
    symlinkSync(target, link);
  });
  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("accepts a real owner-only directory, and creates an absent one", async () => {
    expect((await ownerOnlyDirectory({ directory: target })).isOk()).toBe(true);
    expect((await ownerOnlyDirectory({ directory: join(root, "fresh") })).isOk()).toBe(true);
  });

  it("refuses a symlinked directory, a trailing slash included, which lstat would otherwise follow", async () => {
    expect((await ownerOnlyDirectory({ directory: link }))._unsafeUnwrapErr()).toBe(`${link} is not a real directory`);
    expect((await ownerOnlyDirectory({ directory: `${link}/` }))._unsafeUnwrapErr()).toBe(
      `${link}/ is not a real directory`,
    );
  });

  it("refuses a directory open to other users", async () => {
    chmodSync(target, 0o755);
    expect((await ownerOnlyDirectory({ directory: target }))._unsafeUnwrapErr()).toBe(
      `${target} is open to other users (mode 755)`,
    );
  });
});
