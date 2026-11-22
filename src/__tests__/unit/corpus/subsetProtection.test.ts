/**
 * A subset build's preflight and the scaffolding list it shares with the copy, over synthetic paths only: nothing
 * here names a real directory, and the resolver is injected, so no registry is ever read.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { subsetPreflight, subsetScaffoldPairs } from "../../../corpus/subsetProtection.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { NO_PROTECTION } from "../../noProtection.js";

const SOURCE = "/fixture/source";
const OUT = "/fixture/subsets/out";

const entryAt =
  ({ mode, path }: { mode: "read-only" | "no-access"; path: string }): OwnerProtectionResolver =>
  () =>
    ok([{ addedIso: "2026-11-01T00:00:00.000Z", mode, path, why: "fixture" }]);

describe("subsetScaffoldPairs", () => {
  it("pairs each scaffolding path with its place in the subset home, root entries last", () => {
    const pairs = subsetScaffoldPairs({ outHome: OUT, sourceHome: SOURCE });
    expect(pairs.length).toBe(11);
    expect(pairs[0]).toStrictEqual({
      from: stateHomePaths({ home: SOURCE }).corpus.members,
      to: stateHomePaths({ home: OUT }).corpus.members,
    });
    expect(pairs.slice(-3)).toStrictEqual([
      { from: join(SOURCE, "profile.json"), to: join(OUT, "profile.json") },
      { from: join(SOURCE, "capability-profile.json"), to: join(OUT, "capability-profile.json") },
      { from: join(SOURCE, "judgement"), to: join(OUT, "judgement") },
    ]);
  });
});

describe("subsetPreflight", () => {
  it("hands back a judge allowing the subset home's own files when nothing is covered", () => {
    const judge = unwrap(subsetPreflight({ outHome: OUT, protection: NO_PROTECTION, sourceHome: SOURCE }));
    expect(unwrap(judge({ access: "write", path: join(OUT, "corpus", "a.jsonl") }))).toBeUndefined();
  });

  it("refuses a destination under a read-only entry before anything it reads is judged", () => {
    expect(
      unwrapErr(
        subsetPreflight({
          outHome: OUT,
          protection: entryAt({ mode: "read-only", path: "/fixture/subsets" }),
          sourceHome: SOURCE,
        }),
      ),
    ).toStrictEqual({
      code: "SUBSET_PROTECTED",
      message:
        `refusing to build a subset into ${OUT}: it would write to ${OUT}, which the owner's protect list marks ` +
        `read-only at /fixture/subsets (fixture) — nothing was copied`,
    });
  });

  it("refuses a scaffolding path the list marks no-access, which the copy would read", () => {
    const profile = join(SOURCE, "profile.json");
    expect(
      unwrapErr(
        subsetPreflight({
          outHome: OUT,
          protection: entryAt({ mode: "no-access", path: profile }),
          sourceHome: SOURCE,
        }),
      ).message,
    ).toBe(
      `refusing to build a subset into ${OUT}: it would search ${profile}, which the owner's protect list marks ` +
        `no-access at ${profile} (fixture) — nothing was copied`,
    );
  });
});
