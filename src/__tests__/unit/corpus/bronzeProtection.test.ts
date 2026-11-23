/**
 * The bronze writer's judge and its refusal line, over synthetic entries only.
 */
import { describe, expect, it } from "vitest";

import {
  bronzeJudgeFor,
  type OwnerProtectionResolver,
  protectedBronzeRefusal,
  protectionResolver,
} from "../../../corpus/bronzeProtection.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";

const entry: ProtectedPath = {
  addedIso: "2026-11-01T00:00:00.000Z",
  mode: "read-only",
  path: "/fixture/home/corpus/bronze/slack",
  why: "held\n\tfor   review",
};

describe("protectedBronzeRefusal", () => {
  it("names the source, the path, the entry and the owner's reason on one line", () => {
    expect(
      protectedBronzeRefusal({
        access: "write",
        entry,
        path: "/fixture/home/corpus/bronze/slack/a.jsonl",
        source: "slack",
      }),
    ).toBe(
      "refusing to write slack: it would write to /fixture/home/corpus/bronze/slack/a.jsonl, which the owner's " +
        "protect list marks read-only at /fixture/home/corpus/bronze/slack (held for review)",
    );
  });
});

describe("bronzeJudgeFor", () => {
  const { judge } = unwrap(bronzeJudgeFor({ protection: () => ok([entry]), source: "slack" }));

  it("lets a read-only path be read", () => {
    expect(unwrap(judge({ access: "read", path: "/fixture/home/corpus/bronze/slack/a.jsonl" }))).toBeUndefined();
  });

  it("refuses a write under a read-only path", () => {
    expect(unwrapErr(judge({ access: "write", path: "/fixture/home/corpus/bronze/slack/a.jsonl" }))).toEqual([
      "refusing to write slack: it would write to /fixture/home/corpus/bronze/slack/a.jsonl, which the owner's " +
        "protect list marks read-only at /fixture/home/corpus/bronze/slack (held for review)",
    ]);
  });

  it("lets a write outside every entry through", () => {
    expect(unwrap(judge({ access: "write", path: "/fixture/home/corpus/bronze/linear/a.jsonl" }))).toBeUndefined();
  });
});

describe("protectionResolver", () => {
  it("hands back an injected resolver as it is", () => {
    const protection: OwnerProtectionResolver = () => ok([entry]);

    expect(protectionResolver({ home: "/fixture/home", protection })).toBe(protection);
  });
});
