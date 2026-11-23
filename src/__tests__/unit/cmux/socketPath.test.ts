/** Where the cmux control socket is looked for, and in what order. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  cmuxStatePaths,
  productionSocketPathSources,
  resolveCmuxSocketEndpoint,
  resolveCmuxSocketPath,
  type SocketPathSources,
} from "../../../cmux/socketPath.js";

/** Sources with nothing configured, so each test opts exactly one thing in. */
function sources({
  env = {},
  pointer,
  existing,
}: {
  env?: Readonly<Record<string, string | undefined>>;
  pointer?: string;
  /** The socket paths that exist; absent, the sources cannot say and the first named wins. */
  existing?: ReadonlySet<string>;
} = {}): SocketPathSources {
  return {
    env,
    ...(existing === undefined ? {} : { exists: ({ path }) => existing.has(path) }),
    userHome: "/tmp/fake-home",
    readTextFile: ({ path }) =>
      path === cmuxStatePaths({ userHome: "/tmp/fake-home" }).pointerFile ? pointer : undefined,
  };
}

const DEFAULT_SOCKET = "/tmp/fake-home/.local/state/cmux/cmux.sock";

describe("resolveCmuxSocketPath", () => {
  it("prefers the environment", () => {
    expect(resolveCmuxSocketPath({ sources: sources({ env: { CMUX_SOCKET_PATH: "/tmp/env.sock" } }) })).toBe(
      "/tmp/env.sock",
    );
  });

  it("falls back to cmux's own pointer file", () => {
    expect(resolveCmuxSocketPath({ sources: sources({ pointer: "/tmp/pointed.sock\n" }) })).toBe("/tmp/pointed.sock");
  });

  it("falls back to the default path when neither is set", () => {
    expect(resolveCmuxSocketPath({ sources: sources() })).toBe("/tmp/fake-home/.local/state/cmux/cmux.sock");
  });

  it("treats a blank environment value as unset — cmux exports CMUX_SOCKET empty inside a workspace", () => {
    expect(
      resolveCmuxSocketPath({ sources: sources({ env: { CMUX_SOCKET_PATH: "  " }, pointer: "/tmp/p.sock" }) }),
    ).toBe("/tmp/p.sock");
  });

  // OBSERVED (cause plausible, not proven): the cmux 0.65.2 update renamed `cmux-501.sock` to `cmux.sock`,
  // and the console voice's `cmux list` asked for a socket path that did not exist while a command inside the new cmux
  // worked — consistent with a process holding the old path in its environment or pointer; which one was not captured.
  it("skips a named socket that does not exist for the next one that does — a stale environment, then a stale pointer", () => {
    const stale = { CMUX_SOCKET_PATH: "/tmp/fake-home/.local/state/cmux/cmux-501.sock" };

    expect(
      resolveCmuxSocketPath({
        sources: sources({ env: stale, existing: new Set(["/tmp/pointed.sock"]), pointer: "/tmp/pointed.sock" }),
      }),
    ).toBe("/tmp/pointed.sock");
    expect(
      resolveCmuxSocketPath({
        sources: sources({ env: stale, existing: new Set([DEFAULT_SOCKET]), pointer: "/tmp/pointed.sock" }),
      }),
    ).toBe(DEFAULT_SOCKET);
  });

  it("still prefers the environment when it exists, and names the environment's path when nothing exists", () => {
    const env = { CMUX_SOCKET_PATH: "/tmp/env.sock" };

    expect(
      resolveCmuxSocketPath({
        sources: sources({ env, existing: new Set(["/tmp/env.sock", DEFAULT_SOCKET]), pointer: "/tmp/p.sock" }),
      }),
    ).toBe("/tmp/env.sock");
    expect(resolveCmuxSocketPath({ sources: sources({ env, existing: new Set(), pointer: "/tmp/p.sock" }) })).toBe(
      "/tmp/env.sock",
    );
  });
});

describe("resolveCmuxSocketEndpoint", () => {
  it("presents the token cmux exports, trimmed, on the live socket", () => {
    expect(
      resolveCmuxSocketEndpoint({
        capability: undefined,
        socketPath: undefined,
        sources: sources({ env: { CMUX_SOCKET_CAPABILITY: " v1.sentinel \n", CMUX_SOCKET_PATH: "/tmp/env.sock" } }),
      }),
    ).toEqual({ capability: "v1.sentinel", socketPath: "/tmp/env.sock" });
  });

  it("presents none on the live socket when the variable is unset or blank — a process cmux never started", () => {
    expect(resolveCmuxSocketEndpoint({ capability: undefined, socketPath: undefined, sources: sources() })).toEqual({
      capability: undefined,
      socketPath: "/tmp/fake-home/.local/state/cmux/cmux.sock",
    });
    expect(
      resolveCmuxSocketEndpoint({
        capability: undefined,
        socketPath: undefined,
        sources: sources({ env: { CMUX_SOCKET_CAPABILITY: "  " } }),
      }).capability,
    ).toBeUndefined();
  });

  it("never hands the environment's token to a socket the caller named — a test's fake server", () => {
    expect(
      resolveCmuxSocketEndpoint({
        capability: undefined,
        socketPath: "/tmp/fake.sock",
        sources: sources({ env: { CMUX_SOCKET_CAPABILITY: "v1.real" } }),
      }),
    ).toEqual({ capability: undefined, socketPath: "/tmp/fake.sock" });
  });

  it("presents exactly the token a caller names for its own socket", () => {
    expect(
      resolveCmuxSocketEndpoint({ capability: "v1.given", socketPath: "/tmp/fake.sock", sources: sources() }),
    ).toEqual({ capability: "v1.given", socketPath: "/tmp/fake.sock" });
  });
});

describe("productionSocketPathSources", () => {
  const dirs: string[] = [];

  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });

  /** A throwaway directory this block owns and removes. */
  function freshDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "cmux-socket-path-"));
    dirs.push(dir);
    return dir;
  }

  it("reads the real environment and the real home rather than a fixture", () => {
    const production = productionSocketPathSources();

    expect(production.env).toBe(process.env);
    expect(production.userHome).toBe(homedir());
  });

  it("answers whether a path exists from the real disk", () => {
    const dir = freshDir();
    const written = join(dir, "cmux.sock");
    writeFileSync(written, "", "utf8");

    expect(productionSocketPathSources().exists?.({ path: written })).toBe(true);
    expect(productionSocketPathSources().exists?.({ path: join(dir, "cmux-501.sock") })).toBe(false);
  });

  it("reads a file that is there", () => {
    const path = join(freshDir(), "last-socket-path");
    writeFileSync(path, "/tmp/cmux-42.sock\n", "utf8");

    expect(productionSocketPathSources().readTextFile({ path })).toBe("/tmp/cmux-42.sock\n");
  });

  // The whole point of the injected reader: an ABSENT pointer file is an ordinary case (a process started
  // outside a cmux workspace), so it must answer undefined and let resolution fall through to the default,
  // never throw at the caller.
  it("answers undefined for a file that is not there, rather than throwing", () => {
    expect(productionSocketPathSources().readTextFile({ path: join(freshDir(), "never-written") })).toBeUndefined();
  });

  it("answers undefined for a path that is a directory, which is unreadable in the same way", () => {
    expect(productionSocketPathSources().readTextFile({ path: freshDir() })).toBeUndefined();
  });
});
