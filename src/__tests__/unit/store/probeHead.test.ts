import { describe, expect, it } from "vitest";

import { headOf, peekOf } from "../../../store/probe/head.js";

const ROW = {
  author: "Thiago Sawan",
  authorNativeId: "U0SYN000010",
  bodyChars: 812,
  container: "C0ABC",
  excerpt: "the window",
  from: 40,
  id: "0b1a4d4e-1111-4222-8333-444455556666",
  kind: "message",
  occurredAt: "2026-09-21T03:00:00Z",
  source: "slack",
  sourceId: "C0ABC:1789571466.818409",
  title: "#dev message",
  url: "https://example.slack.com/archives/C0ABC/p1789571466818409",
};

describe("headOf", () => {
  it("reads every head column, keeping author and authorNativeId apart", () => {
    const head = headOf({ row: ROW });
    expect(head.author).toBe("Thiago Sawan");
    expect(head.authorNativeId).toBe("U0SYN000010");
    expect(head.container).toBe("C0ABC");
    expect(head.id).toBe("0b1a4d4e-1111-4222-8333-444455556666");
    expect(head.kind).toBe("message");
    expect(head.occurredAt).toBe("2026-09-21T03:00:00Z");
    expect(head.source).toBe("slack");
    expect(head.sourceId).toBe("C0ABC:1789571466.818409");
    expect(head.title).toBe("#dev message");
    expect(head.url).toBe("https://example.slack.com/archives/C0ABC/p1789571466818409");
  });

  it("reads a missing author id as null, never an invented one", () => {
    const { authorNativeId: _dropped, ...without } = ROW;
    const head = headOf({ row: { ...without, author: null, title: null } });
    expect(head.authorNativeId).toBeNull();
    expect(head.author).toBeNull();
    expect(head.title).toBeNull();
  });
});

describe("peekOf", () => {
  it("adds the window over the head", () => {
    const peek = peekOf({ row: ROW });
    expect(peek.authorNativeId).toBe("U0SYN000010");
    expect(peek.bodyChars).toBe(812);
    expect(peek.excerpt).toBe("the window");
    expect(peek.from).toBe(40);
  });
});
