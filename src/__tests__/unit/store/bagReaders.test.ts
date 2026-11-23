/*
 * The untyped-bag readers: each takes one typed value off a provider payload, and answers its empty value
 * for a key that is absent or carries another type, keeping a zero and an empty-looking value it was given.
 */
import { describe, expect, it } from "vitest";

import { names, num, obj, str, when } from "../../../store/bagReaders.js";

describe("str", () => {
  it("reads a non-empty string", () => {
    expect(str({ bag: { bot_id: "B0SYN4E1234" }, key: "bot_id" })).toBe("B0SYN4E1234");
  });

  it("answers null for an empty string, another type, a missing key and a missing bag", () => {
    expect(str({ bag: { bot_id: "" }, key: "bot_id" })).toBeNull();
    expect(str({ bag: { bot_id: 42 }, key: "bot_id" })).toBeNull();
    expect(str({ bag: {}, key: "bot_id" })).toBeNull();
    expect(str({ bag: undefined, key: "bot_id" })).toBeNull();
  });
});

describe("num", () => {
  it("reads a finite number, zero included", () => {
    expect(num({ bag: { reply_count: 0 }, key: "reply_count" })).toBe(0);
    expect(num({ bag: { reply_count: 7 }, key: "reply_count" })).toBe(7);
  });

  it("answers null for a non-finite number and for a numeric string", () => {
    expect(num({ bag: { reply_count: Number.POSITIVE_INFINITY }, key: "reply_count" })).toBeNull();
    expect(num({ bag: { reply_count: Number.NaN }, key: "reply_count" })).toBeNull();
    expect(num({ bag: { reply_count: "7" }, key: "reply_count" })).toBeNull();
  });
});

describe("when", () => {
  it("reads an ISO timestamp as the instant it names", () => {
    const at = when({ bag: { closed_at: "2026-09-08T04:12:33.000Z" }, key: "closed_at" });
    expect(at!.toISOString()).toBe("2026-09-08T04:12:33.000Z");
  });

  it("answers null for an unparseable timestamp and a missing one", () => {
    expect(when({ bag: { closed_at: "not a time" }, key: "closed_at" })).toBeNull();
    expect(when({ bag: {}, key: "closed_at" })).toBeNull();
  });
});

describe("obj", () => {
  it("reads a nested object as itself", () => {
    const state = { name: "In Progress", type: "started" };
    expect(obj({ bag: { state }, key: "state" })).toEqual({ name: "In Progress", type: "started" });
  });

  it("answers undefined for an array, null and a scalar", () => {
    expect(obj({ bag: { state: ["started"] }, key: "state" })).toBeUndefined();
    expect(obj({ bag: { state: null }, key: "state" })).toBeUndefined();
    expect(obj({ bag: { state: "started" }, key: "state" })).toBeUndefined();
  });
});

describe("names", () => {
  it("keeps every non-empty named field in source order, duplicates included, and skips the rest", () => {
    const assignees: unknown[] = [
      { login: "ada" },
      { login: "" },
      { id: 3 },
      "grace",
      { login: 9 },
      { login: "linus" },
      { login: "ada" },
    ];
    expect(names({ field: "login", items: assignees })).toEqual(["ada", "linus", "ada"]);
  });

  it("answers an empty list for a value that is not an array", () => {
    expect(names({ field: "login", items: { login: "ada" } })).toEqual([]);
    expect(names({ field: "login", items: undefined })).toEqual([]);
  });
});
