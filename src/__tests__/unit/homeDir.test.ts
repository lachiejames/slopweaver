import { statSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  accountDefaultHome,
  clearAccountHomeSandbox,
  homeBeforeScopes,
  installAccountHomeSandbox,
  runUnderHome,
  slopweaverHome,
  userDefaultHome,
} from "../../homeDir.js";

describe("slopweaverHome", () => {
  // home-safety-exempt: this suite tests the resolver itself, so it must move the variable and put back what
  // it found — the read is a save/restore, never a home resolved from the ambient environment.
  const original = process.env["SLOPWEAVER_HOME"];
  afterEach(() => {
    if (original === undefined) {
      delete process.env["SLOPWEAVER_HOME"];
    } else {
      process.env["SLOPWEAVER_HOME"] = original;
    }
  });

  it("defaults to ~/.slopweaver when unset", () => {
    delete process.env["SLOPWEAVER_HOME"];
    expect(slopweaverHome()).toBe(join(homedir(), ".slopweaver"));
  });

  it("defaults to ~/.slopweaver when set to an empty/blank value", () => {
    process.env["SLOPWEAVER_HOME"] = "   ";
    expect(slopweaverHome()).toBe(join(homedir(), ".slopweaver"));
  });

  it("returns an already-absolute override unchanged", () => {
    process.env["SLOPWEAVER_HOME"] = "/tmp/some-slopweaver-home";
    expect(slopweaverHome()).toBe("/tmp/some-slopweaver-home");
  });

  it("resolves a relative override to an absolute path against the current working directory", () => {
    process.env["SLOPWEAVER_HOME"] = "relative-slopweaver-home";
    expect(slopweaverHome()).toBe(resolve("relative-slopweaver-home"));
    expect(slopweaverHome().startsWith("/")).toBe(true);
  });
});

describe("runUnderHome", () => {
  // home-safety-exempt: this suite tests the switch itself, so it must move the variable and put back what it
  // found — the read is a save/restore, never a home resolved from the ambient environment.
  const original = process.env["SLOPWEAVER_HOME"];
  afterEach(() => {
    if (original === undefined) {
      delete process.env["SLOPWEAVER_HOME"];
    } else {
      process.env["SLOPWEAVER_HOME"] = original;
    }
  });

  it("resolves the given home inside the work and the prior one after it", async () => {
    process.env["SLOPWEAVER_HOME"] = "/tmp/ambient-home";
    const inside = await runUnderHome({ home: "/tmp/tick-home", run: () => Promise.resolve(slopweaverHome()) });
    expect([inside, slopweaverHome()]).toEqual(["/tmp/tick-home", "/tmp/ambient-home"]);
  });

  it("unsets the variable again when it was unset before", async () => {
    delete process.env["SLOPWEAVER_HOME"];
    await runUnderHome({ home: "/tmp/tick-home", run: () => Promise.resolve(undefined) });
    expect(Object.hasOwn(process.env, "SLOPWEAVER_HOME")).toBe(false);
  });

  it("restores the prior home when the work throws", async () => {
    process.env["SLOPWEAVER_HOME"] = "/tmp/ambient-home";
    await expect(
      runUnderHome({ home: "/tmp/tick-home", run: () => Promise.reject(new Error("row threw")) }),
    ).rejects.toThrow("row threw");
    expect(slopweaverHome()).toBe("/tmp/ambient-home");
  });

  it("refuses a second scope opened while one is open, leaving the first one's home in place", async () => {
    process.env["SLOPWEAVER_HOME"] = "/tmp/ambient-home";
    const seen = await runUnderHome({
      home: "/tmp/tick-a",
      run: async () => {
        const second = runUnderHome({ home: "/tmp/tick-b", run: () => Promise.resolve(slopweaverHome()) });
        await expect(second).rejects.toThrow("a scope under /tmp/tick-a is still open");
        return slopweaverHome();
      },
    });
    expect([seen, slopweaverHome()]).toEqual(["/tmp/tick-a", "/tmp/ambient-home"]);
  });

  it("exports a relative home absolute, and joins a later scope spelling that same directory absolutely", async () => {
    delete process.env["SLOPWEAVER_HOME"];
    const seen = await runUnderHome({
      home: "relative-tick",
      run: async () => {
        // home-safety-exempt: reads the RAW exported value inside a test, after the sandbox is installed, because
        // the resolver would make a relative export absolute and hide the defect this case proves absent.
        const exported = process.env["SLOPWEAVER_HOME"];
        const inner = await runUnderHome({
          home: resolve("relative-tick"),
          run: () => Promise.resolve(slopweaverHome()),
        });
        return [exported, inner];
      },
    });
    expect(seen).toEqual([resolve("relative-tick"), resolve("relative-tick")]);
  });

  it("refuses a home the environment would cut at a NUL, leaving the variable as it was", async () => {
    process.env["SLOPWEAVER_HOME"] = "/tmp/ambient-home";
    await expect(
      runUnderHome({ home: "/tmp/bad\u0000suffix", run: () => Promise.resolve(slopweaverHome()) }),
    ).rejects.toThrow("a home containing a NUL byte");
    expect(slopweaverHome()).toBe("/tmp/ambient-home");
  });

  it("re-asserts the home for a joining scope when work inside the open one moved the variable", async () => {
    process.env["SLOPWEAVER_HOME"] = "/tmp/ambient-home";
    const inner = await runUnderHome({
      home: "/tmp/tick-a",
      run: () => {
        process.env["SLOPWEAVER_HOME"] = "/tmp/ambient-home";
        return runUnderHome({ home: "/tmp/tick-a", run: () => Promise.resolve(slopweaverHome()) });
      },
    });
    expect([inner, slopweaverHome()]).toEqual(["/tmp/tick-a", "/tmp/ambient-home"]);
  });

  it("joins a nested scope naming the same home, restoring the prior home only once the outer one closes", async () => {
    process.env["SLOPWEAVER_HOME"] = "/tmp/ambient-home";
    const seen = await runUnderHome({
      home: "/tmp/tick-a",
      run: async () => {
        const inner = await runUnderHome({ home: "/tmp/tick-a", run: () => Promise.resolve(slopweaverHome()) });
        return [inner, slopweaverHome()];
      },
    });
    expect([...seen, slopweaverHome()]).toEqual(["/tmp/tick-a", "/tmp/tick-a", "/tmp/ambient-home"]);
  });

  it("keeps the home in place while a same-home scope outlives the one that opened it", async () => {
    process.env["SLOPWEAVER_HOME"] = "/tmp/ambient-home";
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });
    let late: Promise<string> = Promise.resolve("never joined");
    await runUnderHome({
      home: "/tmp/tick-a",
      run: () => {
        late = runUnderHome({ home: "/tmp/tick-a", run: () => held.then(() => slopweaverHome()) });
        return Promise.resolve(undefined);
      },
    });
    const whileHeld = slopweaverHome();
    release();
    expect([whileHeld, await late, slopweaverHome()]).toEqual(["/tmp/tick-a", "/tmp/tick-a", "/tmp/ambient-home"]);
  });

  it("refuses an overlapping scope opened through a SECOND copy of the module", async () => {
    // A query makes the loader evaluate the file again, so this copy owns its own module-level state.
    const specifier = "../../homeDir.js?second-copy";
    const copy: { runUnderHome: typeof runUnderHome } = await import(specifier);
    expect(copy.runUnderHome).not.toBe(runUnderHome);
    process.env["SLOPWEAVER_HOME"] = "/tmp/ambient-home";
    const seen = await runUnderHome({
      home: "/tmp/tick-a",
      run: async () => {
        const second = copy.runUnderHome({ home: "/tmp/tick-b", run: () => Promise.resolve(slopweaverHome()) });
        await expect(second).rejects.toThrow("a scope under /tmp/tick-a is still open");
        return slopweaverHome();
      },
    });
    expect([seen, slopweaverHome()]).toEqual(["/tmp/tick-a", "/tmp/ambient-home"]);
  });

  it("leaves the variable unset when only an INHERITED property of that name existed", async () => {
    delete process.env["SLOPWEAVER_HOME"];
    const ownPrototype: object | null = Object.getPrototypeOf(process.env);
    Object.setPrototypeOf(process.env, Object.assign(Object.create(ownPrototype), { SLOPWEAVER_HOME: "/tmp/proto" }));
    try {
      await runUnderHome({ home: "/tmp/tick-a", run: () => Promise.resolve(undefined) });
      expect(Object.hasOwn(process.env, "SLOPWEAVER_HOME")).toBe(false);
    } finally {
      Object.setPrototypeOf(process.env, ownPrototype);
    }
  });

  it("answers the home from before the open scopes inside one, and the environment's own outside", async () => {
    process.env["SLOPWEAVER_HOME"] = "/tmp/ambient-home";
    const inside = await runUnderHome({ home: "/tmp/tick-a", run: () => Promise.resolve(homeBeforeScopes()) });
    expect([inside, homeBeforeScopes()]).toEqual(["/tmp/ambient-home", "/tmp/ambient-home"]);
  });

  it("answers the default home from inside a scope opened while the variable was unset", async () => {
    delete process.env["SLOPWEAVER_HOME"];
    const inside = await runUnderHome({ home: "/tmp/tick-a", run: () => Promise.resolve(homeBeforeScopes()) });
    expect(inside).toBe(userDefaultHome());
  });

  it("honours a scope another realm recorded on the shared process, where that realm's globalThis differs", async () => {
    // A VM realm sharing this `process` has its own `globalThis`; what it shares is `process` and the symbol
    // registry, so a scope it opened is exactly this record on `process`.
    const slot = Symbol.for("slopweaver.runUnderHome.scope");
    const host = process as typeof process & Record<symbol, unknown>;
    host[slot] = { current: { home: "/tmp/tick-other-realm", open: 1, prior: "/tmp/ambient-home" } };
    process.env["SLOPWEAVER_HOME"] = "/tmp/tick-other-realm";
    try {
      await expect(runUnderHome({ home: "/tmp/tick-b", run: () => Promise.resolve(slopweaverHome()) })).rejects.toThrow(
        "a scope under /tmp/tick-other-realm is still open",
      );
      expect(slopweaverHome()).toBe("/tmp/tick-other-realm");
    } finally {
      host[slot] = { current: undefined };
    }
  });
});

describe("accountDefaultHome", () => {
  // home-safety-exempt: this suite moves HOME to prove the resolver ignores it, and puts back what it found.
  const original = process.env["HOME"];
  // The sandbox `setup-ambient-home.ts` installed at module scope, put back after each case that clears or moves it.
  const installed = accountDefaultHome();
  const realAccountHome = join(userInfo().homedir, ".slopweaver");
  afterEach(() => {
    if (original === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = original;
    }
    installAccountHomeSandbox({ home: installed });
  });

  it("answers this file's sandbox under test, an existing directory under the per-file temp root", () => {
    expect(installed === realAccountHome).toBe(false);
    expect(installed.startsWith(`${tmpdir()}/slopweaver-account-home-`)).toBe(true);
    expect(statSync(installed).isDirectory()).toBe(true);
  });

  it("stays at the account's own home when HOME moves, where userDefaultHome follows it", () => {
    clearAccountHomeSandbox();
    process.env["HOME"] = "/tmp/a-moved-home";
    expect([accountDefaultHome(), userDefaultHome()]).toEqual([realAccountHome, "/tmp/a-moved-home/.slopweaver"]);
  });

  it("answers an installed sandbox made absolute against the cwd", () => {
    installAccountHomeSandbox({ home: "relative-account-home" });
    expect(accountDefaultHome()).toBe(resolve("relative-account-home"));
  });

  it("throws on a slot holding a non-string rather than answering the real home", () => {
    const host = process as typeof process & Record<symbol, unknown>;
    host[Symbol.for("slopweaver.accountDefaultHome.sandbox")] = 42;
    expect(() => accountDefaultHome()).toThrow("the account-home sandbox slot holds a non-string value");
  });
});
