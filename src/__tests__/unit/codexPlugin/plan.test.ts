import { describe, expect, it } from "vitest";

import { CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import {
  lastBackgroundFailure,
  marketplaceEntryOf,
  renderSyncOutcome,
  stampCommitOf,
  syncDecision,
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

describe("renderSyncOutcome", () => {
  it("names a failure's code", () => {
    const line = renderSyncOutcome({
      outcome: { did: "failed", error: CodexPluginSyncErrors.addFailed({ detail: "exit 2" }) },
    });
    expect(line).toBe("codex plugin-sync: FAILED [ADD_FAILED] — codex plugin add failed: exit 2");
  });

  it("names the log a background run writes to", () => {
    const line = renderSyncOutcome({ outcome: { did: "backgrounded", log: "/h/sync.log", why: "behind" } });
    expect(line).toBe("codex plugin-sync: refreshing in the background — behind; log /h/sync.log");
  });

  it("keeps skipped and current distinct", () => {
    expect(renderSyncOutcome({ outcome: { did: "skipped", why: "x" } })).toBe("codex plugin-sync: skipped — x");
    expect(renderSyncOutcome({ outcome: { did: "current", why: "x" } })).toBe("codex plugin-sync: current — x");
  });
});

describe("lastBackgroundFailure", () => {
  it("re-states a failed run's own line", () => {
    const failed = renderSyncOutcome({
      outcome: { did: "failed", error: CodexPluginSyncErrors.addFailed({ detail: "exit 2" }) },
    });
    expect(lastBackgroundFailure({ log: `${failed}\n` })).toBe(
      "the last background run FAILED [ADD_FAILED] — codex plugin add failed: exit 2",
    );
  });

  it("re-states a run that threw, as the CRASHED line the background half records", () => {
    const crashed = renderSyncOutcome({
      outcome: { did: "failed", error: CodexPluginSyncErrors.crashed({ detail: "EACCES: symlink" }) },
    });
    expect(lastBackgroundFailure({ log: `${crashed}\n` })).toBe(
      "the last background run FAILED [CRASHED] — the refresh threw: EACCES: symlink",
    );
  });

  it("is silent for a refreshed run and for an empty log", () => {
    expect(lastBackgroundFailure({ log: "codex plugin-sync: refreshed — behind; installed at /c\n" })).toBeUndefined();
    expect(lastBackgroundFailure({ log: "" })).toBeUndefined();
  });
});
