import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import type { HomeSyncOutcome } from "../../../codexPlugin/plan.js";
import { performFleetSync } from "../../../codexPlugin/sync.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import {
  cacheOf,
  copyingAdd,
  disposeTemplate,
  type Fleet,
  fleetDeps,
  homesOf,
  MARKETPLACE_WITH_SLOPWEAVER,
  makeFleet,
  marketplacePath,
  stampInstall,
  trusting,
  writeMarketplace,
} from "./fleetFixture.js";

let fleet: Fleet;

beforeEach(() => {
  fleet = makeFleet();
});

afterEach(() => {
  rmSync(fleet.root, { force: true, recursive: true });
});

afterAll(disposeTemplate);

/** One run over the fixture fleet's two homes, the checkout declared main. */
function run({
  scope,
  adds = [],
  trustHooks = trusting(),
  failAdd = [],
}: {
  scope: "update-installed" | "install-every-home";
  adds?: string[];
  trustHooks?: ReturnType<typeof trusting>;
  failAdd?: readonly string[];
}): ReturnType<typeof performFleetSync> {
  return performFleetSync({
    deps: fleetDeps({ codexAdd: copyingAdd({ adds, failFor: failAdd, userHome: fleet.paths.userHome }), trustHooks }),
    homes: homesOf({ fleet }),
    mainCheckouts: [fleet.paths.checkout],
    paths: fleet.paths,
    scope,
  });
}

const firstInstallWhy = (): string => `the Codex install carries no source stamp; HEAD is ${fleet.head.slice(0, 12)}`;

/** The whole outcome of a first install into one home, with the fixture trust pass's two hooks. */
function firstInstall({ codexHome }: { codexHome: string }): HomeSyncOutcome {
  return { codexHome, did: "refreshed", installedPath: cacheOf({ codexHome }), trusted: 2, why: firstInstallWhy() };
}

/** The message `JSON.parse` gives for `raw`, which the marketplace error carries as its detail. */
function parseFailure({ raw }: { raw: string }): string {
  try {
    JSON.parse(raw);
  } catch (error: unknown) {
    return errorMessage({ error });
  }
  throw new Error(`expected ${raw} not to parse`);
}

describe("codex plugin-sync, a foreground run", () => {
  it("seeds an absent marketplace and installs into the registered home and the ambient one", () => {
    const adds: string[] = [];
    const outcome = run({ adds, scope: "install-every-home" });

    expect(outcome).toEqual({
      did: "synced",
      homes: [
        {
          codexHome: fleet.registered,
          did: "refreshed",
          installedPath: cacheOf({ codexHome: fleet.registered }),
          trusted: 2,
          why: firstInstallWhy(),
        },
        {
          codexHome: fleet.ambient,
          did: "refreshed",
          installedPath: cacheOf({ codexHome: fleet.ambient }),
          trusted: 2,
          why: firstInstallWhy(),
        },
      ],
    });
    expect(adds).toEqual([fleet.registered, fleet.ambient]);
    expect(JSON.parse(readFileSync(marketplacePath({ userHome: fleet.paths.userHome }), "utf8"))).toEqual(
      MARKETPLACE_WITH_SLOPWEAVER,
    );
    expect(readFileSync(join(cacheOf({ codexHome: fleet.ambient }), "README.md"), "utf8")).toBe("tracked\n");
    expect(existsSync(join(cacheOf({ codexHome: fleet.registered }), "untracked.txt"))).toBe(false);
    expect(existsSync(join(cacheOf({ codexHome: fleet.registered }), ".git"))).toBe(false);
  });

  it("appends its entry to a marketplace without one, keeping every other key and entry in order", () => {
    const other = { extra: 1, name: "other", source: { path: "./plugins/other", source: "local" } };
    writeMarketplace({
      raw: JSON.stringify({ interface: { displayName: "Mine" }, name: "mine", plugins: [other] }),
      userHome: fleet.paths.userHome,
    });

    const outcome = run({ scope: "install-every-home" });

    expect(JSON.parse(readFileSync(marketplacePath({ userHome: fleet.paths.userHome }), "utf8"))).toEqual({
      interface: { displayName: "Mine" },
      name: "mine",
      plugins: [other, { name: "slopweaver", source: { path: "./plugins/slopweaver", source: "local" } }],
    });
    expect(outcome).toMatchObject({
      did: "synced",
      homes: [
        { did: "refreshed", installedPath: cacheOf({ codexHome: fleet.registered, marketplace: "mine" }) },
        { did: "refreshed", installedPath: cacheOf({ codexHome: fleet.ambient, marketplace: "mine" }) },
      ],
    });
  });

  it("refuses an unparseable marketplace, leaving its bytes and every home untouched", () => {
    writeMarketplace({ raw: "{ not json", userHome: fleet.paths.userHome });
    const adds: string[] = [];

    const outcome = run({ adds, scope: "install-every-home" });

    expect(outcome).toMatchObject({ did: "failed", error: { code: "MARKETPLACE_UNREADABLE" } });
    expect(readFileSync(marketplacePath({ userHome: fleet.paths.userHome }), "utf8")).toBe("{ not json");
    expect(adds).toEqual([]);
  });

  it("fails a registered home with no directory on its own line, never creating it, and installs the rest", () => {
    rmSync(fleet.registered, { recursive: true });

    const outcome = run({ scope: "install-every-home" });

    expect(outcome).toEqual({
      did: "synced",
      homes: [
        {
          codexHome: fleet.registered,
          did: "failed",
          error: CodexPluginSyncErrors.codexHomeMissing({ codexHome: fleet.registered }),
        },
        firstInstall({ codexHome: fleet.ambient }),
      ],
    });
    expect(existsSync(fleet.registered)).toBe(false);
  });

  it("leaves a missing ambient home untouched and uncreated, which is not a failure", () => {
    rmSync(fleet.ambient, { recursive: true });

    const outcome = run({ scope: "install-every-home" });

    expect(outcome).toEqual({
      did: "synced",
      homes: [
        firstInstall({ codexHome: fleet.registered }),
        { codexHome: fleet.ambient, did: "untouched", why: "no Codex home here" },
      ],
    });
    expect(existsSync(fleet.ambient)).toBe(false);
  });

  it("fails the one home whose add fails and still installs the next", () => {
    const outcome = run({ failAdd: [fleet.registered], scope: "install-every-home" });

    expect(outcome).toMatchObject({
      did: "synced",
      homes: [
        {
          codexHome: fleet.registered,
          did: "failed",
          error: { code: "ADD_FAILED", message: "codex plugin add failed: error: marketplace not found" },
        },
        { codexHome: fleet.ambient, did: "refreshed" },
      ],
    });
  });

  it("fails a home where a Slopweaver hook is left not running", () => {
    const outcome = run({ scope: "install-every-home", trustHooks: trusting({ failFor: [fleet.ambient] }) });

    expect(outcome).toEqual({
      did: "synced",
      homes: [
        firstInstall({ codexHome: fleet.registered }),
        {
          codexHome: fleet.ambient,
          did: "failed",
          error: CodexPluginSyncErrors.hookTrustFailed({ codexHome: fleet.ambient, detail: "1 hook still skipped" }),
        },
      ],
    });
  });

  it("re-checks hook trust on a home already on HEAD, so a rerun repairs a failed trust pass", () => {
    run({ scope: "install-every-home" });
    const calls: string[] = [];
    const adds: string[] = [];

    const outcome = run({ adds, scope: "install-every-home", trustHooks: trusting({ calls, trusted: 1 }) });

    const why = `the Codex install is already ${fleet.head.slice(0, 12)}`;
    expect(outcome).toEqual({
      did: "synced",
      homes: [
        { codexHome: fleet.registered, did: "current", trusted: 1, why },
        { codexHome: fleet.ambient, did: "current", trusted: 1, why },
      ],
    });
    expect([adds, calls]).toEqual([[], [fleet.registered, fleet.ambient]]);
  });

  it("repoints a dangling marketplace source at the export", () => {
    mkdirSync(join(fleet.paths.userHome, "plugins"), { recursive: true });
    symlinkSync(join(fleet.root, "a-deleted-worktree"), join(fleet.paths.userHome, "plugins", "slopweaver"));

    run({ scope: "install-every-home" });

    expect(readlinkSync(join(fleet.paths.userHome, "plugins", "slopweaver"))).toBe(
      join(fleet.paths.exportRoot, "slopweaver"),
    );
  });

  it("refuses to replace a real directory at the marketplace's source path", () => {
    mkdirSync(join(fleet.paths.userHome, "plugins", "slopweaver"), { recursive: true });
    const adds: string[] = [];

    const outcome = run({ adds, scope: "install-every-home" });

    expect([outcome, adds]).toMatchObject([{ did: "failed", error: { code: "SOURCE_NOT_SYMLINK" } }, []]);
  });

  it("writes nothing, the marketplace included, from a checkout that is not a declared main checkout", () => {
    const outcome = performFleetSync({
      deps: fleetDeps({ codexAdd: copyingAdd({ userHome: fleet.paths.userHome }) }),
      homes: homesOf({ fleet }),
      mainCheckouts: [join(fleet.root, "elsewhere")],
      paths: fleet.paths,
      scope: "install-every-home",
    });

    expect(outcome).toEqual({
      did: "skipped",
      why: `${fleet.paths.checkout} is not a declared main checkout, and only one publishes the Codex install`,
    });
    expect(existsSync(marketplacePath({ userHome: fleet.paths.userHome }))).toBe(false);
  });
});

describe("codex plugin-sync, the post-merge hook's scope", () => {
  it("updates a home that already carries an install stamp, and leaves an unstamped home untouched", () => {
    writeMarketplace({ raw: JSON.stringify(MARKETPLACE_WITH_SLOPWEAVER), userHome: fleet.paths.userHome });
    stampInstall({ codexHome: fleet.registered, commit: "a".repeat(40) });
    const adds: string[] = [];

    const outcome = run({ adds, scope: "update-installed" });

    expect(outcome).toEqual({
      did: "synced",
      homes: [
        {
          codexHome: fleet.registered,
          did: "refreshed",
          installedPath: cacheOf({ codexHome: fleet.registered }),
          trusted: 2,
          why: `the Codex install is ${"a".repeat(12)}; HEAD is ${fleet.head.slice(0, 12)}`,
        },
        { codexHome: fleet.ambient, did: "untouched", why: "not installed here — run `slopweaver codex plugin-sync`" },
      ],
    });
    expect(adds).toEqual([fleet.registered]);
    expect(existsSync(cacheOf({ codexHome: fleet.ambient }))).toBe(false);
  });

  it("neither seeds an absent marketplace nor installs anywhere, and names the foreground command", () => {
    stampInstall({ codexHome: fleet.registered, commit: "a".repeat(40) });
    const adds: string[] = [];

    const outcome = run({ adds, scope: "update-installed" });

    const path = marketplacePath({ userHome: fleet.paths.userHome });
    expect(outcome).toEqual({
      did: "skipped",
      why: `no personal Codex marketplace at ${path} — nothing is installed; run \`slopweaver codex plugin-sync\``,
    });
    expect([existsSync(path), adds]).toEqual([false, []]);
  });

  it("leaves a marketplace that lists no slopweaver entry exactly as it was", () => {
    const raw = JSON.stringify({ name: "mine", plugins: [] });
    writeMarketplace({ raw, userHome: fleet.paths.userHome });

    const outcome = run({ scope: "update-installed" });

    expect(outcome).toMatchObject({ did: "skipped" });
    expect(readFileSync(marketplacePath({ userHome: fleet.paths.userHome }), "utf8")).toBe(raw);
  });

  it("does not re-run hook trust on a home already on HEAD", () => {
    run({ scope: "install-every-home" });
    const calls: string[] = [];

    const outcome = run({ scope: "update-installed", trustHooks: trusting({ calls }) });

    const why = `the Codex install is already ${fleet.head.slice(0, 12)}`;
    // toStrictEqual, not toEqual: it fails if `trusted` is absent rather than present and undefined.
    expect(outcome).toStrictEqual({
      did: "synced",
      homes: [
        { codexHome: fleet.registered, did: "current", trusted: undefined, why },
        { codexHome: fleet.ambient, did: "current", trusted: undefined, why },
      ],
    });
    expect(calls).toEqual([]);
  });

  it("adds only the stale home when one stamped home is current and one is behind, a line each", () => {
    run({ scope: "install-every-home" });
    stampInstall({ codexHome: fleet.ambient, commit: "c".repeat(40) });
    const adds: string[] = [];

    const outcome = run({ adds, scope: "update-installed" });

    expect(outcome).toStrictEqual({
      did: "synced",
      homes: [
        {
          codexHome: fleet.registered,
          did: "current",
          trusted: undefined,
          why: `the Codex install is already ${fleet.head.slice(0, 12)}`,
        },
        {
          codexHome: fleet.ambient,
          did: "refreshed",
          installedPath: cacheOf({ codexHome: fleet.ambient }),
          trusted: 2,
          why: `the Codex install is ${"c".repeat(12)}; HEAD is ${fleet.head.slice(0, 12)}`,
        },
      ],
    });
    expect(adds).toEqual([fleet.ambient]);
  });

  it("leaves an unparseable marketplace byte-identical and installs nothing", () => {
    const raw = "{ not json";
    writeMarketplace({ raw, userHome: fleet.paths.userHome });
    stampInstall({ codexHome: fleet.registered, commit: "a".repeat(40) });
    const adds: string[] = [];

    const outcome = run({ adds, scope: "update-installed" });

    const path = marketplacePath({ userHome: fleet.paths.userHome });
    expect(outcome).toEqual({
      did: "failed",
      error: CodexPluginSyncErrors.marketplaceUnreadable({ detail: parseFailure({ raw }), path }),
    });
    expect([readFileSync(path, "utf8"), adds]).toEqual([raw, []]);
  });
});
