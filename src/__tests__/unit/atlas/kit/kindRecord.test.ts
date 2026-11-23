import { describe, expect, it } from "vitest";

import { recordPerKind } from "../../../../atlas/kit/kindRecord.js";

const KINDS = ["user", "vault", "event"] as const;

describe("recordPerKind", () => {
  it("holds one value under every listed kind, each built from that kind", () => {
    const record = recordPerKind({ kinds: KINDS, valueFor: ({ kind }) => `${kind}-file` });
    expect(record).toEqual({ event: "event-file", user: "user-file", vault: "vault-file" });
  });

  it("keeps a kind whose value is undefined, so presence is judged by key and not by value", () => {
    const record = recordPerKind({ kinds: KINDS, valueFor: () => undefined });
    expect(Object.keys(record)).toEqual(["user", "vault", "event"]);
  });

  it("returns an empty record for an empty kind list", () => {
    const record = recordPerKind({ kinds: [], valueFor: () => 1 });
    expect(record).toEqual({});
  });
});
