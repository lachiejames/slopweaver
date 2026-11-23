import { describe, expect, it } from "vitest";

import {
  channelsSchema,
  dateSchema,
  endingSchema,
  hrefSchema,
  idSchema,
  PRIORITY_LEVELS,
  personSchema,
  prioritySchema,
  textSchema,
  waitingOnSchema,
  workspaceSchema,
} from "../../../workstreams/schema.js";

describe("dateSchema", () => {
  it("accepts a day the calendar has", () => {
    expect(dateSchema.parse("2026-10-02")).toBe("2026-10-02");
  });

  it("refuses a day the calendar lacks and a shape that is not YYYY-MM-DD", () => {
    expect(dateSchema.safeParse("2026-02-30").error!.issues[0]!.message).toBe("a date is a day the calendar has");
    expect(dateSchema.safeParse("2 Oct 2026").error!.issues[0]!.message).toBe("a date is YYYY-MM-DD");
  });
});

describe("hrefSchema", () => {
  it("accepts an https link and a console path", () => {
    expect(hrefSchema.parse("https://example.test/a")).toBe("https://example.test/a");
    expect(hrefSchema.parse("/queue?row=abc")).toBe("/queue?row=abc");
  });

  it("refuses http and a bare word", () => {
    const message = "a link is https:// or a console path starting with /";
    expect(hrefSchema.safeParse("http://example.test").error!.issues[0]!.message).toBe(message);
    expect(hrefSchema.safeParse("example").error!.issues[0]!.message).toBe(message);
  });
});

describe("idSchema and textSchema", () => {
  it("reads a kebab-case id and refuses anything else", () => {
    expect(idSchema.parse("merge-gate-2")).toBe("merge-gate-2");
    expect(idSchema.safeParse("Merge Gate").error!.issues[0]!.message).toBe("an id is kebab-case");
  });

  it("trims text and refuses it blank", () => {
    expect(textSchema.parse("  moved  ")).toBe("moved");
    expect(textSchema.safeParse("   ").success).toBe(false);
  });
});

describe("workspaceSchema", () => {
  it("keeps the two roles as they are", () => {
    expect([workspaceSchema.parse("team"), workspaceSchema.parse("self")]).toEqual(["team", "self"]);
  });

  it("reads the old spellings as the roles they became", () => {
    expect([workspaceSchema.parse("acme"), workspaceSchema.parse("slopweaver")]).toEqual(["team", "self"]);
  });

  it("refuses a word that names neither a role nor an old spelling, and a non-string", () => {
    expect(workspaceSchema.safeParse("taem").success).toBe(false);
    expect(workspaceSchema.safeParse(3).success).toBe(false);
  });
});

describe("prioritySchema", () => {
  it("lists the levels most pressing first", () => {
    expect(PRIORITY_LEVELS).toEqual(["urgent", "high", "normal", "parked"]);
  });

  it("reads a ranked priority and a null one, and refuses a rank of zero", () => {
    const stated = { anchor: "talk-call:x#turn_y", because: "the audit", level: "urgent", rank: 1 };
    expect(prioritySchema.parse(stated)).toEqual(stated);
    expect(prioritySchema.parse(null)).toBe(null);
    expect(prioritySchema.safeParse({ ...stated, rank: 0 }).success).toBe(false);
  });
});

describe("waitingOnSchema", () => {
  it("reads a decision only the owner can make and a person to chase, and refuses a person with no name", () => {
    expect(waitingOnSchema.parse({ on: "you", what: "pick one" })).toEqual({ on: "you", what: "pick one" });
    expect(waitingOnSchema.parse({ on: "someone", what: "the quote", who: "Sadie" })).toEqual({
      on: "someone",
      what: "the quote",
      who: "Sadie",
    });
    expect(waitingOnSchema.safeParse({ on: "someone", what: "the quote" }).success).toBe(false);
  });
});

describe("endingSchema", () => {
  it("defaults to no ending and reads an abandoned one", () => {
    const ending = { anchor: "talk-call:x#turn_y", kind: "abandoned", on: "2026-10-02", reason: "dropped" };
    expect(endingSchema.parse(undefined)).toBe(null);
    expect(endingSchema.parse(ending)).toEqual(ending);
  });
});

describe("personSchema and channelsSchema", () => {
  it("names a person by Slack member id only", () => {
    expect(personSchema.parse({ part: "leads on-call", slack: "U0SYNTESTAAA1" }).slack).toBe("U0SYNTESTAAA1");
    expect(personSchema.safeParse({ part: "leads on-call", slack: "ari" }).error!.issues[0]!.message).toBe(
      "a person is their Slack member id",
    );
  });

  it("keys a conversation by its Slack id and refuses any other key", () => {
    expect(channelsSchema.parse({ C0SYNINCIDENTS: "#incidents" })).toEqual({ C0SYNINCIDENTS: "#incidents" });
    expect(channelsSchema.safeParse({ incidents: "#incidents" }).success).toBe(false);
  });
});
