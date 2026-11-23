/**
 * The live Codex account read's EFFECTFUL half, end to end through the real `tclsh` program, against a fake
 * app-server — never a real Codex. The fake is a small Node script whose behaviour is chosen by the store's
 * own directory name, so one batch can hold a signed-in store, a signed-out one, a slow one, one that never
 * answers and ignores EOF, one that answers and then will not exit, one that starts a detached helper, and one that floods — the isolation properties the reader exists to hold.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCodexHookTrust } from "../../../cli/commands/codex/hooksRun.js";
import { APP_SERVER_ENV, readCodexAccountsLive } from "../../../codex/accountLive.js";

const READ_AT = "2026-09-25T13:00:00.000Z";

/** The fake app-server: answers the two reads in the manner its store's directory name asks for. */
const FAKE_APP_SERVER = `#!/usr/bin/env node
const { basename, join } = require("node:path");
const { writeFileSync } = require("node:fs");
const home = process.env.CODEX_HOME;
const mode = basename(home);
writeFileSync(join(home, "argv.json"), JSON.stringify(process.argv.slice(2)));
writeFileSync(join(home, "pid"), String(process.pid));
if (mode === "helper") {
  const helper = require("node:child_process").spawn("sleep", ["600"], { detached: true, stdio: "ignore" });
  writeFileSync(join(home, "helper-pid"), String(helper.pid));
}
const say = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const answer = () => {
  if (mode === "hooks") {
    const hook = (key, pluginId, trustStatus) => ({ currentHash: "sha256:" + trustStatus, enabled: true, eventName: "sessionStart", key, pluginId, source: "plugin", trustStatus });
    say({ id: 7, result: { data: [{ cwd: "/repo", hooks: [
      hook("slopweaver@personal:hooks/codex-hooks.json:session_start:0:0", "slopweaver@personal", "untrusted"),
      hook("slopweaver@personal:hooks/hooks.json:stop:0:0", "slopweaver@personal", "trusted"),
      hook("other@x:hooks/hooks.json:stop:0:0", "other@x", "untrusted"),
    ] }] } });
    return;
  }
  if (mode === "out") {
    say({ error: { code: -32600, message: "codex account authentication required to read rate limits" }, id: 2 });
    say({ id: 3, result: { account: null, requiresOpenaiAuth: true } });
    return;
  }
  const codex = { limitId: "codex", primary: { resetsAt: 1790944998, usedPercent: 0, windowDurationMins: 10080 }, secondary: null };
  say({ id: 3, result: { account: { email: mode + "@example.com", planType: "prolite", type: "chatgpt" } } });
  say({ id: 2, result: { accountId: "acct-" + mode, rateLimitResetCredits: { availableCount: 1, credits: null }, rateLimits: codex, rateLimitsByLimitId: { codex } } });
};
if (mode === "silent") {
  process.stdin.on("end", () => {});
  setInterval(() => {}, 1000);
} else if (mode === "flood") {
  const line = JSON.stringify({ method: "noise", params: { pad: "x".repeat(4000) } }) + "\\n";
  for (let i = 0; i < 200; i += 1) process.stdout.write(line);
  setInterval(() => {}, 1000);
} else {
  let seen = 0;
  process.stdin.on("data", (chunk) => {
    seen += String(chunk).split("\\n").filter((l) => l.includes('"method"')).length;
    if (seen >= (mode === "hooks" ? 3 : 4)) setTimeout(answer, mode.startsWith("slow") ? 1500 : 20);
  });
  if (mode === "linger") {
    process.stdin.on("end", () => {});
    setInterval(() => {}, 1000);
  }
}
`;

let root = "";
let previousAppServer: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sw-live-"));
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

/** Whether a pid still names a running process. */
function alive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("readCodexAccountsLive", () => {
  it("reads signed-in, signed-out and missing stores in one batch, in the order given", () => {
    const signedIn = store({ mode: "in" });
    const signedOut = store({ mode: "out" });
    const missing = join(root, "stores", "never-made");
    const rows = readCodexAccountsLive({ codexHomes: [signedIn, missing, signedOut], readAtIso: READ_AT });
    expect(rows.map((row) => row.kind)).toEqual(["signed-in", "store-missing", "signed-out"]);
    expect(rows[0]).toMatchObject({ accountId: "acct-in", email: "in@example.com", resetCreditsAvailable: 1 });
    expect(existsSync(join(missing, "argv.json"))).toBe(false);
  });

  it("launches the app-server with every quieting switch", () => {
    const signedIn = store({ mode: "in" });
    readCodexAccountsLive({ codexHomes: [signedIn], readAtIso: READ_AT });
    expect(JSON.parse(readFileSync(join(signedIn, "argv.json"), "utf8"))).toEqual([
      "app-server",
      "--strict-config",
      "--disable",
      "plugins",
      "--disable",
      "remote_plugin",
      "--disable",
      "memories",
      "--disable",
      "goals",
      "--disable",
      "skill_search",
      "--disable",
      "apps",
      "-c",
      "skills.bundled.enabled=false",
      "-c",
      "plugins.browser@openai-bundled.enabled=false",
      "-c",
      "plugins.computer-use@openai-bundled.enabled=false",
      "-c",
      "plugins.unified-computer-use@openai-bundled.enabled=false",
      "-c",
      "mcp_servers.node_repl.command=/usr/bin/false",
      "-c",
      "mcp_servers.node_repl.enabled=false",
    ]);
  });

  it("reads slow stores concurrently rather than one after another", () => {
    const started = Date.now();
    const rows = readCodexAccountsLive({
      codexHomes: [store({ mode: "slow-a" }), store({ mode: "slow-b" }), store({ mode: "slow-c" })],
      readAtIso: READ_AT,
    });
    expect(rows.map((row) => row.kind)).toEqual(["signed-in", "signed-in", "signed-in"]);
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("cuts off a flooding store and a silent one without costing the healthy store its answer", () => {
    const flood = store({ mode: "flood" });
    const silent = store({ mode: "silent" });
    const rows = readCodexAccountsLive({ codexHomes: [flood, store({ mode: "in" }), silent], readAtIso: READ_AT });
    expect(rows.map((row) => row.kind)).toEqual(["unreadable", "signed-in", "unreadable"]);
    expect(rows[0]).toMatchObject({ reason: "the app-server wrote more than the per-store byte cap" });
    expect(rows[2]).toMatchObject({
      reason: "the app-server did not answer both requests before the per-store deadline",
    });
    expect(alive({ pid: Number(readFileSync(join(silent, "pid"), "utf8")) })).toBe(false);
    expect(alive({ pid: Number(readFileSync(join(flood, "pid"), "utf8")) })).toBe(false);
  }, 20_000);

  it("kills a store that answered both reads and then will not exit, so no close blocks on it", () => {
    const linger = store({ mode: "linger" });
    const started = Date.now();
    const rows = readCodexAccountsLive({ codexHomes: [linger], readAtIso: READ_AT });
    expect(rows.map((row) => row.kind)).toEqual(["signed-in"]);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(alive({ pid: Number(readFileSync(join(linger, "pid"), "utf8")) })).toBe(false);
  }, 20_000);

  it("kills what the app-server started too, not only the app-server itself", () => {
    const helper = store({ mode: "helper" });
    const rows = readCodexAccountsLive({ codexHomes: [helper], readAtIso: READ_AT });
    expect(rows.map((row) => row.kind)).toEqual(["signed-in"]);
    expect(alive({ pid: Number(readFileSync(join(helper, "helper-pid"), "utf8")) })).toBe(false);
  }, 20_000);

  it("reads every store as unreadable when the app-server binary is absent", () => {
    process.env[APP_SERVER_ENV] = join(root, "absent");
    expect(readCodexAccountsLive({ codexHomes: [store({ mode: "in" })], readAtIso: READ_AT })).toEqual([
      {
        codexHome: join(root, "stores", "in"),
        kind: "unreadable",
        readAtIso: READ_AT,
        reason: `the Codex CLI is not at ${join(root, "absent")}`,
      },
    ]);
  });
});

describe("readCodexHookTrust", () => {
  it("launches with the installed plugins loaded and reads only Slopweaver's hooks from hooks/list", () => {
    const hooks = store({ mode: "hooks" });
    const reading = readCodexHookTrust({ codexHome: hooks, cwd: root });
    expect(reading).toEqual({
      hooks: [
        {
          currentHash: "sha256:untrusted",
          enabled: true,
          eventName: "sessionStart",
          key: "slopweaver@personal:hooks/codex-hooks.json:session_start:0:0",
          pluginId: "slopweaver@personal",
          source: "plugin",
          trustStatus: "untrusted",
        },
        {
          currentHash: "sha256:trusted",
          enabled: true,
          eventName: "sessionStart",
          key: "slopweaver@personal:hooks/hooks.json:stop:0:0",
          pluginId: "slopweaver@personal",
          source: "plugin",
          trustStatus: "trusted",
        },
      ],
      kind: "read",
    });
    const argv = JSON.parse(readFileSync(join(hooks, "argv.json"), "utf8")) as string[];
    expect(argv.slice(0, 4)).toEqual(["app-server", "--strict-config", "--disable", "remote_plugin"]);
    expect(argv).not.toContain("plugins");
  });

  it("reads a store that never answers as unreadable, naming the deadline marker", () => {
    const reading = readCodexHookTrust({ codexHome: store({ mode: "silent" }), cwd: root });
    expect(reading.kind).toBe("unreadable");
    expect(JSON.stringify(reading)).toContain("the app-server gave no hooks/list answer");
  }, 40_000);
});
