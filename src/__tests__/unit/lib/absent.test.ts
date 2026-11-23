import { describe, expect, it } from "vitest";
import { absentAs, absentAsEmpty, absentAsNull, absentAsNumber, unsetFieldAsNull } from "#lib/absent.js";

describe("absentAsNull", () => {
  it("carries an undefined value forward as null", () => {
    expect(absentAsNull({ value: undefined })).toBeNull();
  });

  it("returns a null value as null", () => {
    const value: string | null | undefined = null;
    expect(absentAsNull({ value })).toBeNull();
  });

  it("keeps a present falsy value rather than substituting for it", () => {
    expect(absentAsNull({ value: 0 })).toBe(0);
    expect(absentAsNull({ value: "" })).toBe("");
    expect(absentAsNull({ value: false })).toBe(false);
  });

  it("returns a present object as the same reference", () => {
    const value = { id: "zone-1" };
    expect(absentAsNull({ value })).toBe(value);
  });
});

describe("absentAs", () => {
  it("prints the caller's word for an undefined value", () => {
    expect(absentAs({ value: undefined, whenAbsent: "(unnamed)" })).toBe("(unnamed)");
  });

  it("prints the caller's word for a null value", () => {
    expect(absentAs({ value: null, whenAbsent: "unknown" })).toBe("unknown");
  });

  it("keeps an empty string rather than substituting for it", () => {
    expect(absentAs({ value: "", whenAbsent: "(none)" })).toBe("");
  });

  it("returns a present value unchanged", () => {
    expect(absentAs({ value: "v", whenAbsent: "(none)" })).toBe("v");
  });
});

describe("absentAsNumber", () => {
  it("answers the caller's number for an undefined value", () => {
    expect(absentAsNumber({ value: undefined, whenAbsent: 7 })).toBe(7);
  });

  it("answers the caller's number for a null value", () => {
    expect(absentAsNumber({ value: null, whenAbsent: 0 })).toBe(0);
  });

  it("keeps a present zero rather than substituting for it", () => {
    expect(absentAsNumber({ value: 0, whenAbsent: 1 })).toBe(0);
  });

  it("returns a present non-zero value unchanged", () => {
    expect(absentAsNumber({ value: 42, whenAbsent: 0 })).toBe(42);
  });
});

describe("absentAsEmpty", () => {
  it("carries an undefined list forward as an empty list", () => {
    expect(absentAsEmpty({ value: undefined })).toStrictEqual([]);
  });

  it("carries a null list forward as an empty list", () => {
    expect(absentAsEmpty({ value: null })).toStrictEqual([]);
  });

  it("keeps a present list of falsy values as the same reference", () => {
    const value = [0, "", false];
    expect(absentAsEmpty({ value })).toBe(value);
    expect(absentAsEmpty({ value })).toStrictEqual([0, "", false]);
  });

  it("keeps a present empty list as the same reference", () => {
    const value: readonly string[] = [];
    expect(absentAsEmpty({ value })).toBe(value);
  });

  it("builds a fresh empty list on every absent call, never a shared instance", () => {
    expect(absentAsEmpty({ value: undefined })).not.toBe(absentAsEmpty({ value: undefined }));
  });
});

describe("unsetFieldAsNull", () => {
  /** A record declaring one required, one optional and one nullable field. */
  interface Raw {
    readonly id: string;
    readonly name?: string;
    readonly ttl: number | null;
  }

  it("returns a present optional field", () => {
    const record: Raw = { id: "zone-1", name: "edge", ttl: 60 };
    expect(unsetFieldAsNull({ key: "name", record })).toBe("edge");
  });

  it("carries an unset optional field forward as null", () => {
    const record: Raw = { id: "zone-1", ttl: 60 };
    expect(unsetFieldAsNull({ key: "name", record })).toBeNull();
  });

  it("returns a nullable field's null as null, and keeps a present zero", () => {
    const unset: Raw = { id: "zone-1", ttl: null };
    const zero: Raw = { id: "zone-1", ttl: 0 };
    expect(unsetFieldAsNull({ key: "ttl", record: unset })).toBeNull();
    expect(unsetFieldAsNull({ key: "ttl", record: zero })).toBe(0);
  });

  it("answers null when the record itself is absent", () => {
    const none: readonly Raw[] = [];
    const record = none[0];
    expect(unsetFieldAsNull({ key: "name", record })).toBeNull();
  });

  it("refuses to compile a required key, so a value that must exist cannot be read through it", () => {
    const record: Raw = { id: "zone-1", ttl: 60 };
    // @ts-expect-error -- `id` is declared REQUIRED on Raw: read it directly, or refuse its absence with a typed error
    expect(unsetFieldAsNull({ key: "id", record })).toBe("zone-1");
  });

  it("refuses a key typed as a union that reaches a required one", () => {
    const record: Raw = { id: "zone-1", name: "edge", ttl: 60 };
    const keys: readonly ("id" | "name")[] = ["name"];
    const key = keys[0]!;
    // @ts-expect-error -- the union reaches `id`, which Raw declares REQUIRED
    expect(unsetFieldAsNull({ key, record })).toBe("edge");
  });

  it("refuses a required key typed unknown, which would otherwise admit undefined", () => {
    const record: { readonly payload: unknown } = { payload: "p" };
    // @ts-expect-error -- `payload` is REQUIRED; `unknown` does not declare it absent
    expect(unsetFieldAsNull({ key: "payload", record })).toBe("p");
  });

  it("accepts a required key whose type admits undefined", () => {
    const record: { readonly note: string | undefined } = { note: undefined };
    expect(unsetFieldAsNull({ key: "note", record })).toBeNull();
  });
});
