import { describe, expect, it } from "vitest";

import { CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import {
  backgroundFailures,
  marketplaceEntryOf,
  renderSyncOutcome,
  type SyncOutcome,
  stampCommitOf,
  syncDecision,
  syncFailed,
} from "../../../codexPlugin/plan.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const HEAD = "a".repeat(40);
const OLDER = "b".repeat(40);

/** A personal marketplace document listing the given plugins. */
function marketplace({ plugins }: { plugins: readonly unknown[] }): unknown {
  return { interface: { displayName: "Personal" }, name: "personal", plugins };
}

describe("marketplaceEntryOf", () => {
  it("resolves slopweaver's local path against the marketplace root", () => {
    const document = marketplace({
      plugins: [{ name: "slopweaver", source: { path: "./plugins/slopweaver", source: "local" } }],
    });
    const entry = unwrap(marketplaceEntryOf({ document, home: "/Users/someone", path: "/m.json" }));
    expect(entry).toEqual({ kind: "found", marketplace: "personal", sourcePath: "/Users/someone/plugins/slopweaver" });
  });

  it("is absent when no entry is named slopweaver", () => {
    const document = marketplace({ plugins: [{ name: "other", source: { path: "./x", source: "local" } }] });
    const entry = unwrap(marketplaceEntryOf({ document, home: "/h", path: "/m.json" }));
    expect(entry).toEqual({ kind: "absent", why: "marketplace personal lists no slopweaver plugin" });
  });

  it("is absent when the entry is not a local source", () => {
    const document = marketplace({ plugins: [{ name: "slopweaver", source: { source: "git" } }] });
    const entry = unwrap(marketplaceEntryOf({ document, home: "/h", path: "/m.json" }));
    expect(entry).toEqual({
      kind: "absent",
      why: "marketplace personal's slopweaver is a git source, not a local path",
    });
  });

  it("refuses a document that is not a marketplace, naming the file", () => {
    const error = unwrapErr(marketplaceEntryOf({ document: { plugins: "nope" }, home: "/h", path: "/m.json" }));
    expect(error.code).toBe("MARKETPLACE_UNREADABLE");
    expect(error.message).toContain("/m.json");
  });
});

describe("stampCommitOf", () => {
  it("reads a full commit", () => {
    expect(stampCommitOf({ document: { commit: HEAD } })).toBe(HEAD);
  });

  it("is undefined for an absent file or an abbreviated commit", () => {
    expect(stampCommitOf({ document: undefined })).toBeUndefined();
    expect(stampCommitOf({ document: { commit: "abc123" } })).toBeUndefined();
  });
});

describe("syncDecision", () => {
  it("is current only when both the export and the install carry HEAD", () => {
    expect(syncDecision({ exported: HEAD, head: HEAD, installed: HEAD })).toEqual({
      refresh: false,
      why: "the Codex install is already aaaaaaaaaaaa",
    });
  });

  it("refreshes an install that predates stamping", () => {
    expect(syncDecision({ exported: undefined, head: HEAD, installed: undefined })).toEqual({
      refresh: true,
      why: "the Codex install carries no source stamp; HEAD is aaaaaaaaaaaa",
    });
  });

  it("refreshes a current export whose add never landed", () => {
    expect(syncDecision({ exported: HEAD, head: HEAD, installed: OLDER })).toEqual({
      refresh: true,
      why: "the Codex install is bbbbbbbbbbbb; HEAD is aaaaaaaaaaaa",
    });
  });
});

/** A fleet outcome with one home of each kind, in that order. */
const FLEET: SyncOutcome = {
  did: "synced",
  homes: [
    { codexHome: "/c/a", did: "refreshed", installedPath: "/c/a/cache", trusted: 3, why: "behind" },
    { codexHome: "/c/b", did: "current", trusted: undefined, why: "already" },
    { codexHome: "/c/c", did: "current", trusted: 1, why: "already" },
    { codexHome: "/c/d", did: "untouched", why: "not installed here" },
    { codexHome: "/c/e", did: "failed", error: CodexPluginSyncErrors.codexHomeMissing({ codexHome: "/c/e" }) },
  ],
};

describe("renderSyncOutcome", () => {
  it("names a failure's code", () => {
    const lines = renderSyncOutcome({
      outcome: { did: "failed", error: CodexPluginSyncErrors.addFailed({ detail: "exit 2" }) },
    });
    expect(lines).toEqual(["codex plugin-sync: FAILED [ADD_FAILED] — codex plugin add failed: exit 2"]);
  });

  it("names the log a background run writes to", () => {
    const lines = renderSyncOutcome({ outcome: { did: "backgrounded", log: "/h/sync.log", why: "behind" } });
    expect(lines).toEqual(["codex plugin-sync: refreshing in the background — behind; log /h/sync.log"]);
  });

  it("prints one line per Codex home, each naming its home, with skipped, current and untouched distinct", () => {
    expect(renderSyncOutcome({ outcome: { did: "skipped", why: "x" } })).toEqual(["codex plugin-sync: skipped — x"]);
    expect(renderSyncOutcome({ outcome: FLEET })).toEqual([
      "codex plugin-sync: /c/a refreshed — behind; installed at /c/a/cache; trusted 3 hook(s)",
      "codex plugin-sync: /c/b current — already",
      "codex plugin-sync: /c/c current — already; trusted 1 hook(s)",
      "codex plugin-sync: /c/d untouched — not installed here",
      `codex plugin-sync: /c/e FAILED [CODEX_HOME_MISSING] — ${CodexPluginSyncErrors.codexHomeMissing({ codexHome: "/c/e" }).message}`,
    ]);
  });
});

describe("syncFailed", () => {
  it("is true for a run that failed before any home, and for a fleet with one failed home", () => {
    const early: SyncOutcome = { did: "failed", error: CodexPluginSyncErrors.crashed({ detail: "x" }) };
    expect([syncFailed({ outcome: early }), syncFailed({ outcome: FLEET })]).toEqual([true, true]);
  });

  it("is false for a skip and for a fleet with no failed home", () => {
    const healthy: SyncOutcome = { did: "synced", homes: [{ codexHome: "/c/a", did: "untouched", why: "x" }] };
    expect([syncFailed({ outcome: { did: "skipped", why: "x" } }), syncFailed({ outcome: healthy })]).toEqual([
      false,
      false,
    ]);
  });
});

describe("backgroundFailures", () => {
  it("re-states every failed home, even one an earlier home's success follows", () => {
    const log = `${renderSyncOutcome({ outcome: FLEET }).join("\n")}\n`;
    expect(backgroundFailures({ log })).toEqual([
      `the last background run: /c/e FAILED [CODEX_HOME_MISSING] — ${CodexPluginSyncErrors.codexHomeMissing({ codexHome: "/c/e" }).message}`,
    ]);
  });

  it("re-states a run that threw, as the CRASHED line the background half records", () => {
    const crashed = renderSyncOutcome({
      outcome: { did: "failed", error: CodexPluginSyncErrors.crashed({ detail: "EACCES: symlink" }) },
    });
    expect(backgroundFailures({ log: `${crashed.join("\n")}\n` })).toEqual([
      "the last background run: FAILED [CRASHED] — the refresh threw: EACCES: symlink",
    ]);
  });

  it("is empty for a run that failed nowhere and for an empty log", () => {
    expect(backgroundFailures({ log: "codex plugin-sync: /c/a refreshed — behind; installed at /c\n" })).toEqual([]);
    expect(backgroundFailures({ log: "" })).toEqual([]);
  });
});
