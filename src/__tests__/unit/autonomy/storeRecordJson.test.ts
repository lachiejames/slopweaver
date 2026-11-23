/**
 * The text an autonomy record is stored as is a function of the validated record alone: an `Object.prototype.toJSON`
 * installed elsewhere in the process cannot rewrite it, on the store writer too. Each case installs a hostile serialiser on a SHARED prototype, proves it is live by
 * what a plain `JSON.stringify` makes of the same record, and removes it in a `finally`.
 */
import { describe, expect, it } from "vitest";

import { buildAutonomyAction } from "../../../autonomy/row.js";
import { AutonomyStoreErrors } from "../../../autonomy/storeErrors.js";
import { autonomyEventRow, autonomyRecordJson } from "../../../autonomy/storeRecord.js";
import type { AutonomyRecord } from "../../../autonomy/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const RECORD = {
  actionId: "demo-act",
  kinds: ["press-merge-when-ready"],
  why: "original",
} as const;

const EXPECTED = '{"actionId":"demo-act","kinds":["press-merge-when-ready"],"why":"original"}';

/** Run a body with a serialiser installed on one shared prototype, always removing it afterwards. */
function withInheritedToJson<T>({ prototype, body }: { prototype: object; body: () => T }): T {
  Object.defineProperty(prototype, "toJSON", {
    configurable: true,
    value: () => "rewritten",
  });
  try {
    return body();
  } finally {
    Reflect.deleteProperty(prototype, "toJSON");
  }
}

describe("autonomyRecordJson", () => {
  it("serialises the record's own fields, in order", () => {
    expect(autonomyRecordJson({ record: RECORD })).toBe(EXPECTED);
  });

  it("ignores a toJSON installed on Object.prototype, which rewrites a plain stringify of the same record", () => {
    const seen = withInheritedToJson({
      body: () => ({ ours: autonomyRecordJson({ record: RECORD }), plain: JSON.stringify(RECORD) }),
      prototype: Object.prototype,
    });
    expect(seen).toEqual({ ours: EXPECTED, plain: '"rewritten"' });
  });

  it("ignores a toJSON installed on Array.prototype, which rewrites a nested array in a plain stringify", () => {
    const seen = withInheritedToJson({
      body: () => ({ ours: autonomyRecordJson({ record: RECORD }), plain: JSON.stringify(RECORD) }),
      prototype: Array.prototype,
    });
    expect(seen).toEqual({
      ours: EXPECTED,
      plain: '{"actionId":"demo-act","kinds":"rewritten","why":"original"}',
    });
  });

  it("keeps a field named __proto__ as a field", () => {
    const record = JSON.parse('{"__proto__":"a field","actionId":"demo-act"}') as Record<string, unknown>;
    expect(autonomyRecordJson({ record })).toBe('{"__proto__":"a field","actionId":"demo-act"}');
  });

  it("keeps an own toJSON that is not callable as a plain field", () => {
    const record = { actionId: "demo-act", toJSON: "a field" };
    expect(autonomyRecordJson({ record })).toBe('{"actionId":"demo-act","toJSON":"a field"}');
  });

  it("throws on an own callable toJSON rather than letting it replace the record", () => {
    const record = Object.fromEntries([
      ["__proto__", "a field"],
      ["toJSON", () => ({ hijacked: true })],
      ["actionId", "demo-act"],
    ]);
    expect(JSON.stringify(record)).toBe('{"hijacked":true}');
    expect(() => autonomyRecordJson({ record })).toThrow(
      "autonomyRecordJson was handed a function, which autonomyEventRow refuses as unstorable",
    );
  });
});

describe("autonomyEventRow", () => {
  it("refuses a record carrying an own callable toJSON as unstorable, before anything serialises it", () => {
    const act = unwrap(
      buildAutonomyAction({
        actionId: "demo-act",
        bySession: "workspace:1 demo",
        doneIso: "2026-09-12T02:06:09Z",
        kind: "press-merge-when-ready",
        run: undefined,
        said: "Queued acme/acme-admin#12 to merge.",
        steer: undefined,
        subject: "https://github.com/acme/acme-admin/pull/12",
        why: "CI green and mergeable",
        witness: "slopweaver github enqueue --pr 12 -> queued",
      }),
    );
    const record = { ...act, toJSON: () => ({ hijacked: true }) } as unknown as AutonomyRecord;
    expect(unwrapErr(autonomyEventRow({ importKey: "k", record }))).toEqual(
      AutonomyStoreErrors.recordUnstorable({
        actionId: "demo-act",
        reason: "it holds a function value, which JSON cannot hold",
      }),
    );
  });
});
