import { describe, expect, it } from "vitest";
import { safeCodex, safeFs, safeFsAsync } from "../../../lib/safeBoundary.js";
import { assertInstanceOf } from "../../assertInstanceOf.js";

describe("safeCodex", () => {
  it("maps a Codex throw to a typed llm error with provider codex, NOT claude", async () => {
    const result = await safeCodex({
      execute: async () => {
        throw new Error("codex thread failed to start");
      },
      operation: "codex.startThread",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe("llm");
    expect(result._unsafeUnwrapErr().provider).toBe("codex");
  });

  it("preserves an AbortError's name through safeCodex, so a bounded abort stays distinguishable", async () => {
    const result = await safeCodex({
      execute: async () => {
        throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      },
      operation: "codex.run",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().provider).toBe("codex");
    const cause = result._unsafeUnwrapErr().cause;
    assertInstanceOf(cause, Error);
    expect(cause.name).toBe("AbortError");
  });
});

describe("safeFsAsync / safeFs", () => {
  it("maps an async fs throw to a typed io error carrying code and path", async () => {
    const result = await safeFsAsync({
      execute: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      operation: "appendRecordRows",
      path: "/tmp/records.jsonl",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe("io");
    expect(result._unsafeUnwrapErr().code).toBe("ENOENT");
    expect(result._unsafeUnwrapErr().path).toBe("/tmp/records.jsonl");
  });

  it("returns the value from a synchronous fs call", () => {
    const result = safeFs({ execute: () => "contents", operation: "readFileSync" });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("contents");
  });

  it("maps a synchronous fs throw to a typed io error", () => {
    const result = safeFs({
      execute: () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      },
      operation: "writeJsonFile",
      path: "/root/x.json",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe("io");
    expect(result._unsafeUnwrapErr().path).toBe("/root/x.json");
  });
});
