/**
 * A Codex Connect's sign-in, end to end through the real `tclsh` login program, against a fake app-server and a
 * fake page opener — never a real Codex, never a real browser. The fake's behaviour is chosen by its store's
 * directory name; the opener records the page it was handed, and in the cancel case drops the cancel marker as a
 * person pressing Cancel mid sign-in would.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_SERVER_ENV } from "../../../codex/accountLive.js";
import { type CodexLoginRun, runCodexLoginExchange } from "../../../codex/loginExchange.js";
import { parseCodexLoginExchange } from "../../../codex/loginExchangeParse.js";

const FAKE_APP_SERVER = `#!/usr/bin/env node
const { basename, join } = require("node:path");
const { writeFileSync } = require("node:fs");
const home = process.env.CODEX_HOME;
const mode = basename(home);
writeFileSync(join(home, "pid"), String(process.pid));
const say = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const page = mode === "badurl" ? "https://evil.example/oauth" : "https://auth.openai.com/oauth/authorize?state=abc";
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += String(chunk);
  let at;
  while ((at = buffer.indexOf("\\n")) >= 0) {
    const message = JSON.parse(buffer.slice(0, at));
    buffer = buffer.slice(at + 1);
    if (message.id === 1) say({ id: 1, result: {} });
    if (message.method === "account/login/start") {
      if (mode === "refused") {
        say({ error: { code: -32600, message: "port 1455 is in use" }, id: message.id });
        continue;
      }
      say({ id: message.id, result: { authUrl: page, loginId: "l-1", type: "chatgpt" } });
      if (mode === "ok") {
        setTimeout(() => say({ method: "account/login/completed", params: { loginId: "l-1", success: true } }), 300);
      }
    }
    if (message.method === "account/read") {
      say({ id: message.id, result: { account: { email: "b@example.com", planType: "pro", type: "chatgpt" } } });
    }
    if (message.method === "account/login/cancel") {
      writeFileSync(join(home, "cancelled-login"), message.params.loginId);
      say({ id: message.id, result: { status: "canceled" } });
    }
  }
});
process.stdin.on("end", () => {});
setInterval(() => {}, 1000);
`;

let root = "";
let previousAppServer: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sw-login-"));
  const fake = join(root, "fake-app-server.cjs");
  writeFileSync(fake, FAKE_APP_SERVER, "utf8");
  chmodSync(fake, 0o755);
  previousAppServer = process.env[APP_SERVER_ENV];
  process.env[APP_SERVER_ENV] = fake;
});

afterEach(() => {
  process.env[APP_SERVER_ENV] = previousAppServer;
  rmSync(root, { force: true, recursive: true });
});

/** A store directory the fake reads its behaviour from. */
function store({ mode }: { mode: string }): string {
  const dir = join(root, "stores", mode);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** An opener that records the page, and drops the cancel marker too when asked. */
function opener({ cancelPath }: { cancelPath?: string }): { readonly path: string; readonly opened: string } {
  const opened = join(root, "opened.txt");
  const path = join(root, "opener.sh");
  const cancel = cancelPath === undefined ? "" : `: > '${cancelPath}'\n`;
  writeFileSync(path, `#!/bin/sh\nprintf '%s' "$1" > '${opened}'\n${cancel}`, "utf8");
  chmodSync(path, 0o755);
  return { opened, path };
}

/** The lines a run printed; a run that never ran fails the test here, by name. */
function linesOf({ run }: { run: CodexLoginRun }): readonly string[] {
  if (run.kind !== "ran") {
    throw new Error(`the sign-in program did not run: ${run.reason}`);
  }
  return run.lines;
}

/** Whether a pid still names a running process. */
function alive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runCodexLoginExchange", () => {
  it("opens the sign-in page, waits for the completion, and reads the account", () => {
    const codexHome = store({ mode: "ok" });
    const open = opener({});
    const signInUrlPath = join(root, "page.url");
    const run = runCodexLoginExchange({
      cancelPath: join(root, "never.cancel"),
      codexHome,
      deadlineMs: 15_000,
      opener: open.path,
      signInUrlPath,
    });
    expect(run.kind).toBe("ran");
    expect(parseCodexLoginExchange({ lines: linesOf({ run }) })).toEqual({ email: "b@example.com", kind: "connected" });
    expect(readFileSync(open.opened, "utf8")).toBe("https://auth.openai.com/oauth/authorize?state=abc");
    expect(readFileSync(signInUrlPath, "utf8")).toBe("https://auth.openai.com/oauth/authorize?state=abc\n");
    expect(statSync(signInUrlPath).mode & 0o777).toBe(0o600);
    expect(alive({ pid: Number(readFileSync(join(codexHome, "pid"), "utf8")) })).toBe(false);
  });

  it("sends the cancel with the login id once the marker appears mid sign-in", () => {
    const codexHome = store({ mode: "cancel" });
    const cancelPath = join(root, "attempt.cancel");
    const run = runCodexLoginExchange({
      cancelPath,
      codexHome,
      deadlineMs: 15_000,
      opener: opener({ cancelPath }).path,
      signInUrlPath: join(root, "page.url"),
    });
    expect(parseCodexLoginExchange({ lines: linesOf({ run }) })).toEqual({ kind: "cancelled" });
    expect(readFileSync(join(codexHome, "cancelled-login"), "utf8")).toBe("l-1");
  });

  it("never opens a page that is not the provider's own sign-in host", () => {
    const codexHome = store({ mode: "badurl" });
    const open = opener({});
    const run = runCodexLoginExchange({
      cancelPath: join(root, "never.cancel"),
      codexHome,
      deadlineMs: 15_000,
      opener: open.path,
      signInUrlPath: join(root, "page.url"),
    });
    expect(parseCodexLoginExchange({ lines: linesOf({ run }) })).toEqual({ failure: "URL_REFUSED", kind: "failed" });
    expect(existsSync(open.opened)).toBe(false);
  });

  it("reports the provider's refusal to start", () => {
    const run = runCodexLoginExchange({
      cancelPath: join(root, "never.cancel"),
      codexHome: store({ mode: "refused" }),
      deadlineMs: 15_000,
      opener: opener({}).path,
      signInUrlPath: join(root, "page.url"),
    });
    expect(parseCodexLoginExchange({ lines: linesOf({ run }) })).toEqual({
      detail: "port 1455 is in use",
      failure: "START_REFUSED",
      kind: "failed",
    });
  });

  it("gives up at the deadline and kills the app-server", () => {
    const codexHome = store({ mode: "never" });
    const run = runCodexLoginExchange({
      cancelPath: join(root, "never.cancel"),
      codexHome,
      deadlineMs: 1_500,
      opener: opener({}).path,
      signInUrlPath: join(root, "page.url"),
    });
    expect(parseCodexLoginExchange({ lines: linesOf({ run }) })).toEqual({ failure: "TIMED_OUT", kind: "failed" });
    expect(alive({ pid: Number(readFileSync(join(codexHome, "pid"), "utf8")) })).toBe(false);
  });

  it("names a missing CLI rather than running anything", () => {
    process.env[APP_SERVER_ENV] = join(root, "absent");
    const run = runCodexLoginExchange({
      cancelPath: join(root, "never.cancel"),
      codexHome: store({ mode: "ok" }),
      deadlineMs: 1_500,
      opener: opener({}).path,
      signInUrlPath: join(root, "page.url"),
    });
    expect(run).toEqual({ kind: "cli-missing", reason: `the Codex CLI is not at ${join(root, "absent")}` });
  });
});
