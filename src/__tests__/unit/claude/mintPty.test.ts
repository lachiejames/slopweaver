import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { captureScript, MINT_PTY_PROGRAM, type MintPtyReport } from "../../../claude/mintFlow.js";
import {
  type MintPtyHandle,
  mintEnv,
  prepareMintDir,
  readMintScreen,
  removeMintDir,
  waitForAuthorizeUrl,
  watchMintWorker,
} from "../../../claude/mintPty.js";

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A fresh, empty Slopweaver home.
 *
 * @returns its path
 */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "mint-pty-"));
  homes.push(home);
  return home;
}

/**
 * A running-mint handle whose login never ends unless handed a report — a seam, not a mock.
 *
 * @param report what the login ended with, when it has ended
 * @returns the handle
 */
function handle({ report }: { report?: MintPtyReport }): MintPtyHandle {
  return {
    abort: () => undefined,
    finished: report === undefined ? new Promise<MintPtyReport>(() => undefined) : Promise.resolve(report),
  };
}

describe("prepareMintDir", () => {
  it("lays out one private mint directory, with the program, the capture script and an empty screen log", () => {
    const home = freshHome();

    const { cleared, paths } = unwrap(prepareMintDir({ home, nowMs: Date.now() }));

    expect(cleared).toBe(0);
    expect(paths.dir.startsWith(join(home, "claude-accounts", "minting"))).toBe(true);
    expect(statSync(paths.dir).mode & 0o777).toBe(0o700);
    expect(statSync(paths.storeDir).mode & 0o777).toBe(0o700);
    expect(readFileSync(paths.programPath, "utf8")).toBe(MINT_PTY_PROGRAM);
    expect(readFileSync(paths.scriptPath, "utf8")).toBe(captureScript({ urlPath: paths.urlPath }));
    expect(statSync(paths.scriptPath).mode & 0o777).toBe(0o700);
    expect(readFileSync(paths.screenLogPath, "utf8")).toBe("");
    expect(statSync(paths.screenLogPath).mode & 0o777).toBe(0o600);
  });

  it("deletes every leftover older than any mint can run, counts them, and keeps a mint still running", () => {
    const home = freshHome();
    const root = join(home, "claude-accounts", "minting");
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mkdirSync(join(root, "killed-one"), { recursive: true });
    writeFileSync(join(root, "killed-one", "screen.log"), "left behind");
    utimesSync(join(root, "killed-one"), longAgo, longAgo);
    mkdirSync(join(root, "killed-two"), { recursive: true });
    utimesSync(join(root, "killed-two"), longAgo, longAgo);
    mkdirSync(join(root, "running-now"), { recursive: true });

    const { cleared, paths } = unwrap(prepareMintDir({ home, nowMs: Date.now() }));

    expect(cleared).toBe(2);
    expect(readdirSync(root).toSorted()).toEqual([paths.dir.slice(root.length + 1), "running-now"].toSorted());
  });

  it("answers MINT_PTY_FAILED when the home cannot hold the directory", () => {
    const home = freshHome();
    writeFileSync(join(home, "claude-accounts"), "a file where the directory belongs");

    const error = unwrapErr(prepareMintDir({ home, nowMs: Date.now() }));

    expect(error.code).toBe("MINT_PTY_FAILED");
    expect(error.message).toContain("could not prepare the mint directory");
  });
});

describe("readMintScreen and removeMintDir", () => {
  it("reads the screen log, then removes the whole directory with it", () => {
    const { paths } = unwrap(prepareMintDir({ home: freshHome(), nowMs: Date.now() }));
    writeFileSync(paths.screenLogPath, "Opening browser to sign in…\r\n");

    expect(readMintScreen({ paths })).toBe("Opening browser to sign in…\r\n");
    removeMintDir({ paths });
    expect(existsSync(paths.dir)).toBe(false);
    expect(readMintScreen({ paths })).toBe("");
  });
});

describe("waitForAuthorizeUrl", () => {
  it("answers the URL the capture script landed", async () => {
    const { paths } = unwrap(prepareMintDir({ home: freshHome(), nowMs: Date.now() }));
    writeFileSync(paths.urlPath, "https://claude.com/cai/oauth/authorize?state=state_synthetic");

    const captured = await waitForAuthorizeUrl({ paths, pty: handle({}) });

    expect(unwrap(captured)).toBe("https://claude.com/cai/oauth/authorize?state=state_synthetic");
  });

  it("ends the wait at once when the login exits before handing over a URL", async () => {
    const { paths } = unwrap(prepareMintDir({ home: freshHome(), nowMs: Date.now() }));
    const report: MintPtyReport = { hung: false, status: 3, stderrTail: "" };

    const error = unwrapErr(await waitForAuthorizeUrl({ paths, pty: handle({ report }) }));

    expect(error.code).toBe("MINT_PTY_FAILED");
    expect(error.message).toBe(
      "the terminal the mint ran in failed (the login exited (3) before handing its browser a URL) — nothing was written",
    );
  });
});

describe("mintEnv", () => {
  it("drops the inherited tokens and points the login at the capture script, the throwaway store and the program's three variables", () => {
    const { paths } = unwrap(prepareMintDir({ home: freshHome(), nowMs: Date.now() }));

    const env = mintEnv({
      deadlineMs: 90_500,
      inherited: {
        BROWSER: "open",
        CLAUDE_CODE_OAUTH_TOKEN: "inherited-token",
        CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3",
        PATH: "/usr/bin",
        UNSET: undefined,
      },
      paths,
    });

    expect(env).toEqual({
      BROWSER: paths.scriptPath,
      CLAUDE_SECURESTORAGE_CONFIG_DIR: paths.storeDir,
      PATH: "/usr/bin",
      SLOPWEAVER_MINT_ABORT: paths.abortPath,
      SLOPWEAVER_MINT_DEADLINE_S: "91",
      SLOPWEAVER_MINT_SCREEN_LOG: paths.screenLogPath,
    });
  });
});

describe("watchMintWorker", () => {
  it("settles with the report the worker posted, even when its exit follows at once", async () => {
    const { paths } = unwrap(prepareMintDir({ home: freshHome(), nowMs: Date.now() }));
    const worker = new EventEmitter();
    const pty = watchMintWorker({ paths, worker });
    const report: MintPtyReport = { hung: false, status: 0, stderrTail: "" };

    worker.emit("message", report);
    worker.emit("exit", 0);

    expect(await pty.finished).toEqual(report);
  });

  it("settles with a failed report carrying the error when the worker throws", async () => {
    const { paths } = unwrap(prepareMintDir({ home: freshHome(), nowMs: Date.now() }));
    const worker = new EventEmitter();
    const pty = watchMintWorker({ paths, worker });

    worker.emit("error", new Error("claude mint worker: workerData did not carry a mint request"));

    expect(await pty.finished).toEqual({
      hung: false,
      status: null,
      stderrTail: "claude mint worker: workerData did not carry a mint request",
    });
  });

  it("still settles when the worker exits having posted nothing, so cleanup can never wait forever", async () => {
    const { paths } = unwrap(prepareMintDir({ home: freshHome(), nowMs: Date.now() }));
    const worker = new EventEmitter();
    const pty = watchMintWorker({ paths, worker });

    worker.emit("exit", 1);

    expect(await pty.finished).toEqual({
      hung: false,
      status: null,
      stderrTail: "the mint worker exited 1 and reported nothing",
    });
  });

  it("aborts by writing the abort file the program polls, and does not throw once the directory is gone", () => {
    const { paths } = unwrap(prepareMintDir({ home: freshHome(), nowMs: Date.now() }));
    const pty = watchMintWorker({ paths, worker: new EventEmitter() });

    pty.abort();
    expect(existsSync(paths.abortPath)).toBe(true);

    removeMintDir({ paths });
    pty.abort();
    expect(existsSync(paths.dir)).toBe(false);
  });
});
