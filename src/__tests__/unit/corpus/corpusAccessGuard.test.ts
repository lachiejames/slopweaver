/**
 * The rewriters' preflight and the whole-tree write check, over synthetic entries only: a fixture path that names no
 * real directory, so nothing here is ever statted, and an injected resolver, so no registry is ever read.
 */
import { describe, expect, it } from "vitest";

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { preflightCorpusAccesses } from "../../../corpus/corpusAccessGuard.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { OwnerProtectionErrors } from "../../../protectedPaths/ownerEntries.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";

const HOME = "/fixture/home";
const OPERATION = { target: "slack", verb: "compact" } as const;

const readOnly: ProtectedPath = {
  addedIso: "2026-11-01T00:00:00.000Z",
  mode: "read-only",
  path: "/fixture/home/corpus/bronze/slack/held",
  why: "kept for reference",
};

const noAccess: ProtectedPath = {
  addedIso: "2026-11-01T00:00:00.000Z",
  mode: "no-access",
  path: "/fixture/home/corpus/bronze/notion/private",
  why: "never read",
};

const protecting =
  (...entries: readonly ProtectedPath[]): OwnerProtectionResolver =>
  () =>
    ok(entries);

describe("preflightCorpusAccesses", () => {
  it("hands back a judge when nothing in the batch is covered", () => {
    const walk = unwrap(
      preflightCorpusAccesses({
        accesses: [
          { access: "read", path: "/fixture/home/corpus/bronze/slack/a.jsonl" },
          { access: "write", path: "/fixture/home/corpus/bronze/slack/b.jsonl" },
        ],
        home: HOME,
        operation: OPERATION,
        protection: protecting(readOnly),
      }),
    );
    expect(unwrap(walk.judge({ access: "write", path: "/fixture/home/corpus/bronze/slack/c.jsonl" }))).toBeUndefined();
  });

  it("refuses on the first covered access in batch order, naming it", () => {
    expect(
      unwrapErr(
        preflightCorpusAccesses({
          accesses: [
            { access: "write", path: "/fixture/home/corpus/bronze/slack/a.jsonl" },
            { access: "write", path: "/fixture/home/corpus/bronze/slack/held/b.jsonl" },
            { access: "read", path: "/fixture/home/corpus/bronze/notion/private/c.jsonl" },
          ],
          home: HOME,
          operation: OPERATION,
          protection: protecting(readOnly, noAccess),
        }),
      ),
    ).toEqual([
      "refusing to compact slack: it would write to /fixture/home/corpus/bronze/slack/held/b.jsonl, which the " +
        "owner's protect list marks read-only at /fixture/home/corpus/bronze/slack/held (kept for reference)",
    ]);
  });

  it("lets a read of a read-only path through", () => {
    const walk = unwrap(
      preflightCorpusAccesses({
        accesses: [{ access: "read", path: "/fixture/home/corpus/bronze/slack/held/b.jsonl" }],
        home: HOME,
        operation: OPERATION,
        protection: protecting(readOnly),
      }),
    );
    expect(walk.coverOf({ access: "write", path: "/fixture/home/corpus/bronze/slack/held/b.jsonl" })).toEqual(readOnly);
  });

  it("refuses when the protect list itself cannot be read", () => {
    const unreadable: OwnerProtectionResolver = () =>
      err(OwnerProtectionErrors.unknown({ reason: "it will not parse" }));
    expect(
      unwrapErr(preflightCorpusAccesses({ accesses: [], home: HOME, operation: OPERATION, protection: unreadable })),
    ).toEqual([
      "refusing to compact slack: the owner's protect list could not be read, so nothing it might cover is touched: " +
        "it will not parse",
    ]);
  });
});

describe("tree-write", () => {
  const treeWrite = ({ path, entries }: { path: string; entries: readonly ProtectedPath[] }): readonly string[] =>
    preflightCorpusAccesses({
      accesses: [{ access: "tree-write", path }],
      home: HOME,
      operation: OPERATION,
      protection: protecting(...entries),
    }).match(
      () => [],
      (lines) => lines,
    );

  it("refuses a root with a read-only entry beneath it, which a plain write never sees", () => {
    expect(treeWrite({ entries: [readOnly], path: "/fixture/home/corpus" })).toEqual([
      "refusing to compact slack: it would write to /fixture/home/corpus/bronze/slack/held, which the owner's " +
        "protect list marks read-only at /fixture/home/corpus/bronze/slack/held (kept for reference)",
    ]);
  });

  it("refuses a root with a no-access entry beneath it", () => {
    expect(treeWrite({ entries: [noAccess], path: "/fixture/home" })).toEqual([
      "refusing to compact slack: it would write to /fixture/home/corpus/bronze/notion/private, which the owner's " +
        "protect list marks no-access at /fixture/home/corpus/bronze/notion/private (never read)",
    ]);
  });

  it("refuses a root at or under an entry, as a plain write does", () => {
    expect(treeWrite({ entries: [readOnly], path: "/fixture/home/corpus/bronze/slack/held/new" })).toEqual([
      "refusing to compact slack: it would write to /fixture/home/corpus/bronze/slack/held/new, which the owner's " +
        "protect list marks read-only at /fixture/home/corpus/bronze/slack/held (kept for reference)",
    ]);
  });

  it("lets a sibling tree through", () => {
    expect(treeWrite({ entries: [readOnly, noAccess], path: "/fixture/home/corpus/bronze/linear" })).toEqual([]);
  });
});
