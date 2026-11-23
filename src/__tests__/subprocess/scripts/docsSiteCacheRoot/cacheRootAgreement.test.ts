/**
 * `scripts/docs-site.sh` resolves the cache root in bash, because it starts the servers that read it, so the two
 * resolutions are held to agreement here: whatever `--print-cache-paths` prints is what `src/cacheHome.ts` computes
 * over the same environment.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cachePaths, slopweaverCacheRootOf } from "../../../../cacheHome.js";
import { slopweaverHomeOf } from "../../../../homeDir.js";
import { envOf, made, printed, repoRoot, run, scratch } from "./harness.js";

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("docs-site.sh's cache root agrees with src/cacheHome.ts", () => {
  const CASES: readonly { name: string; over: (at: { user: string }) => Record<string, string> }[] = [
    { name: "no variable set", over: () => ({}) },
    { name: "an override with a trailing slash", over: ({ user }) => ({ SLOPWEAVER_CACHE_HOME: `${user}/c/` }) },
    { name: "a blank override", over: () => ({ SLOPWEAVER_CACHE_HOME: "  " }) },
    { name: "an XDG cache home", over: ({ user }) => ({ XDG_CACHE_HOME: `${user}/xdg` }) },
    { name: "a blank XDG cache home", over: () => ({ XDG_CACHE_HOME: " " }) },
    {
      name: "an override with dot, dot-dot, repeated slashes and a star",
      over: ({ user }) => ({ SLOPWEAVER_CACHE_HOME: `${user}//a/./b/../*/c/` }),
    },
  ];

  it("covers every case below", () => {
    expect(CASES.length).toBeGreaterThan(0);
  });

  for (const one of CASES) {
    it(`with ${one.name}`, () => {
      const user = scratch();
      const env = envOf({ over: one.over({ user }), user });
      const expected = slopweaverCacheRootOf({ env, platform: process.platform, userHome: user });
      const paths = printed({ env });
      expect(paths["cache_root"]).toBe(expected);
      expect(paths["docs_site"]).toBe(cachePaths({ root: expected }).docsSite);
    });
  }

  it("takes a relative override against the caller's directory, as `resolve` does against `process.cwd()`", () => {
    const user = scratch();
    // The directory as the kernel names it (`/private/var/…` on macOS): bash's `$PWD` and Node's `process.cwd()`
    // both read it that way in a child spawned there, which is what the two resolutions run in.
    const cwd = realpathSync(scratch());
    expect(printed({ cwd, env: envOf({ over: { SLOPWEAVER_CACHE_HOME: "rel/cache" }, user }) })["cache_root"]).toBe(
      join(cwd, "rel", "cache"),
    );
  });

  it("takes a relative override against the PHYSICAL directory when the shell was started under a link", () => {
    const user = scratch();
    const real = realpathSync(scratch());
    const linked = join(user, "linked");
    symlinkSync(real, linked);
    const env = { ...envOf({ over: { SLOPWEAVER_CACHE_HOME: "rel/cache" }, user }), PWD: linked };
    expect(printed({ cwd: linked, env })["cache_root"]).toBe(join(real, "rel", "cache"));
  });

  it("folds a dot-dot lexically, never through a link, exactly as `resolve` does", () => {
    const user = scratch();
    const cwd = realpathSync(scratch());
    mkdirSync(join(user, "elsewhere", "inner"), { recursive: true });
    symlinkSync(join(user, "elsewhere", "inner"), join(cwd, "alpha"));
    expect(printed({ cwd, env: envOf({ over: { SLOPWEAVER_CACHE_HOME: "alpha/../beta" }, user }) })["cache_root"]).toBe(
      join(cwd, "beta"),
    );
  });

  it("names one saved-readings directory per state home, under the cache root's console directory", () => {
    const user = scratch();
    const root = join(user, "c");
    const first = printed({
      env: { ...envOf({ over: { SLOPWEAVER_CACHE_HOME: root }, user }), SLOPWEAVER_HOME: "/a" },
    });
    const again = printed({
      env: { ...envOf({ over: { SLOPWEAVER_CACHE_HOME: root }, user }), SLOPWEAVER_HOME: "/a" },
    });
    const other = printed({
      env: { ...envOf({ over: { SLOPWEAVER_CACHE_HOME: root }, user }), SLOPWEAVER_HOME: "/b" },
    });
    expect(dirname(first["saved_readings"]!)).toBe(cachePaths({ root }).consoleSavedReadings);
    expect(first["saved_readings"]).toMatch(/\/[0-9a-f]{16}$/u);
    expect(again["saved_readings"]).toBe(first["saved_readings"]);
    const slashed = printed({
      env: { ...envOf({ over: { SLOPWEAVER_CACHE_HOME: root }, user }), SLOPWEAVER_HOME: "/a/" },
    });
    expect(slashed["saved_readings"]).toBe(first["saved_readings"]);
    expect(other["saved_readings"]).not.toBe(first["saved_readings"]);
  });

  it("refuses an empty HOME with no override, as src/cacheHome.ts does, rather than naming a root under `/`", () => {
    const user = scratch();
    const env = { ...envOf({ over: {}, user }), HOME: "", SLOPWEAVER_HOME: join(user, "home") };
    const out = run({ args: ["--print-cache-paths"], env });
    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    expect(out.stderr).toContain('docs-site: HOME "" is not absolute; set SLOPWEAVER_CACHE_HOME');
    expect(() => slopweaverCacheRootOf({ env, platform: process.platform, userHome: "" })).toThrow(
      'cache root: the user\'s home directory "" is not absolute; set SLOPWEAVER_CACHE_HOME',
    );
  });

  it("folds a HOME or XDG cache home of `/`, a trailing slash or a dot-dot exactly as `join` does", () => {
    const user = scratch();
    for (const over of [
      { HOME: "/" },
      { HOME: `${user}/` },
      { HOME: `${user}/a/../b` },
      { XDG_CACHE_HOME: "/" },
      { XDG_CACHE_HOME: `${user}//x/` },
    ]) {
      const env = { ...envOf({ over: {}, user }), ...over };
      expect(printed({ env })["cache_root"]).toBe(
        slopweaverCacheRootOf({ env, platform: process.platform, userHome: env["HOME"]! }),
      );
    }
  });

  it("falls back to the account's home when HOME is unset, as `os.homedir()` does", () => {
    const user = scratch();
    const env = envOf({ over: {}, user });
    delete env["HOME"];
    expect(printed({ env })["cache_root"]).toBe(
      slopweaverCacheRootOf({ env, platform: process.platform, userHome: userInfo().homedir }),
    );
  });

  it("reads an override of only Unicode spaces as SET, as src/cacheHome.ts does, under a UTF-8 locale", () => {
    const user = scratch();
    const cwd = realpathSync(scratch());
    for (const space of ["﻿", " ", " "]) {
      const env = { ...envOf({ over: { SLOPWEAVER_CACHE_HOME: space }, user }), LANG: "en_US.UTF-8" };
      expect(printed({ cwd, env })["cache_root"]).toBe(join(cwd, space));
      expect(slopweaverCacheRootOf({ env, platform: process.platform, userHome: user })).toBe(resolve(space));
    }
  });

  it("refuses a relative override under a working directory whose name ends in a newline, as the built module does", () => {
    const user = scratch();
    const cwd = join(realpathSync(scratch()), "ends\n");
    mkdirSync(cwd);
    const env = envOf({ over: { SLOPWEAVER_CACHE_HOME: "." }, user });
    const out = run({ args: ["--print-cache-paths"], cwd, env });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("docs-site: the working directory carries a control character; pass an absolute path");
    const built = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `(await import(${JSON.stringify(join(repoRoot, "dist-cli", "cacheHome.js"))})).slopweaverCacheRoot()`,
      ],
      { cwd, encoding: "utf8", env },
    );
    expect(built.status).toBe(1);
    expect(built.stderr).toContain(
      "cache root: the working directory carries a control character; pass an absolute path",
    );
  });

  it("refuses an override carrying a newline, as src/cacheHome.ts does, rather than naming it without one", () => {
    const user = scratch();
    const env = envOf({ over: { SLOPWEAVER_CACHE_HOME: `${user}/c\n` }, user });
    const out = run({ args: ["--print-cache-paths"], env });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("docs-site: SLOPWEAVER_CACHE_HOME carries a control character");
    expect(() => slopweaverCacheRootOf({ env, platform: process.platform, userHome: user })).toThrow(
      "cache root: SLOPWEAVER_CACHE_HOME carries a control character",
    );
  });

  it("reads a state home that JavaScript's `trim()` empties as unset, as `slopweaverHomeOf` does", () => {
    const user = scratch();
    const root = join(user, "c");
    const unset = { ...envOf({ over: { SLOPWEAVER_CACHE_HOME: root }, user }) };
    delete unset["SLOPWEAVER_HOME"];
    const expected = printed({ env: unset })["saved_readings"];
    // Built from code points so the source stays ASCII: a raw U+2028 broke the Codex SDK's parse of the diff.
    const spaces = [[0x20, 0x20], [0x3000], [0xfeff, 0x20], [0xa0, 0x2028]];
    for (const blank of spaces.map((points) => String.fromCodePoint(...points))) {
      const env = { ...unset, SLOPWEAVER_HOME: blank };
      // Its default reads this process's own home, not `env`'s, so it is compared with its answer when unset.
      expect(slopweaverHomeOf({ env })).toBe(slopweaverHomeOf({ env: {} }));
      expect(printed({ env })["saved_readings"]).toBe(expected);
    }
    const kept = printed({ env: { ...unset, SLOPWEAVER_HOME: "\u0085" } })["saved_readings"];
    expect(slopweaverHomeOf({ env: { ...unset, SLOPWEAVER_HOME: "\u0085" } })).toBe(resolve("\u0085"));
    expect(kept).not.toBe(expected);
  });

  it("refuses an empty HOME with a blank state home even under a cache override, rather than naming `/.slopweaver`", () => {
    const user = scratch();
    const env = envOf({ over: { HOME: "", SLOPWEAVER_CACHE_HOME: join(user, "c"), SLOPWEAVER_HOME: "  " }, user });
    const out = run({ args: ["--print-cache-paths"], env });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('docs-site: HOME "" is not absolute; set SLOPWEAVER_HOME');
  });

  it("refuses a state home ending in a newline rather than reading the home without it", () => {
    const user = scratch();
    const env = envOf({ over: { SLOPWEAVER_CACHE_HOME: join(user, "cache"), SLOPWEAVER_HOME: `${user}/h\n` }, user });
    const out = run({ args: ["--print-cache-paths"], env });
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("docs-site: SLOPWEAVER_HOME carries a control character");
  });

  it("prints the paths without creating anything", () => {
    const user = scratch();
    printed({ env: envOf({ over: { SLOPWEAVER_CACHE_HOME: join(user, "c") }, user }) });
    expect(existsSync(join(user, "c"))).toBe(false);
    expect(existsSync(join(user, "home"))).toBe(false);
  });
});
