import { describe, expect, it } from "vitest";
import { parseRow } from "../../../corpus/corpusRowCore.js";
import { bodyFields, deriveRawDigest } from "../../../corpus/deriveProjection.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { classifyActor } from "../../../silver/actorKind.js";
import { deriveSilver } from "../../../silver/deriveSilver.js";
import { buildIdentityMap } from "../../../silver/identity.js";

/**
 * The rows below are deliberately shaped like the real thing: a Slack message whose `raw` carries the three
 * Slack scalars silver reads, a GitHub row whose `raw.author.__typename` marks a bot, a row whose BODY (not title)
 * carries an unresolved marker, and one whose `raw` holds a large payload that must not survive the
 * projection.
 */
const ROWS: readonly string[] = [
  JSON.stringify({
    author: "alice",
    container: "acme/web",
    kind: "pr",
    raw: { author: { __typename: "User", login: "alice" }, bulk: "x".repeat(4096) },
    refs: ["#2", "@bob"],
    source: "github",
    sourceId: "#1",
    text: "this one is blocked on the migration",
    title: "Add the widget",
    tsIso: "2026-09-01T00:00:00.000Z",
    url: "https://example.invalid/1",
  }),
  JSON.stringify({
    author: "renovate",
    container: "acme/web",
    kind: "pr",
    raw: { author: { __typename: "Bot", login: "renovate" }, bulk: "y".repeat(4096) },
    refs: ["#1"],
    source: "github",
    sourceId: "#2",
    text: "chore: bump things",
    title: "Update dependency",
    tsIso: "2026-09-02T00:00:00.000Z",
    url: "https://example.invalid/2",
  }),
  JSON.stringify({
    author: "Bob",
    container: "C123",
    kind: "message",
    raw: { bot_id: "B9", subtype: "bot_message", text: "z".repeat(4096), user: "U42" },
    refs: ["#1"],
    source: "slack",
    sourceId: "C123:1.0",
    text: "todo: pick this up tomorrow",
    tsIso: "2026-09-03T00:00:00.000Z",
    url: "https://example.invalid/3",
  }),
  JSON.stringify({
    author: "Carol",
    container: "C123",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "C123:2.0",
    text: "all done here, nothing outstanding",
    tsIso: "2026-09-03T01:00:00.000Z",
    url: "https://example.invalid/4",
  }),
];

const parseAll = ({ projection }: { projection: "bronze" | "derive" }): readonly CorpusRecord[] =>
  ROWS.map((line) => {
    const parsed = parseRow({ line, projection });
    if (!("record" in parsed)) {
      throw new Error(`fixture row rejected: ${parsed.error}`);
    }
    return parsed.record;
  });

const silverFor = ({ projection }: { projection: "bronze" | "derive" }) => {
  const records = parseAll({ projection });
  return deriveSilver({ identityMap: buildIdentityMap({ records: [] }), records });
};

describe("the derive projection carries exactly what silver reads", () => {
  it("drops the record body", () => {
    expect(parseAll({ projection: "derive" }).map((r) => r.text)).toEqual(["", "", "", ""]);
  });

  it("keeps the body under every other projection", () => {
    expect(parseAll({ projection: "bronze" })[0]!.text).toBe("this one is blocked on the migration");
  });

  it("precomputes the unresolved flag from the body it is about to drop", () => {
    // Rows 0 and 2 carry markers in TEXT only, which is exactly the signal a body-less projection would lose.
    expect(parseAll({ projection: "derive" }).map((r) => r.unresolved)).toEqual([true, false, true, false]);
  });

  it("leaves the flag absent under bronze, so the regex still decides there", () => {
    expect(parseAll({ projection: "bronze" }).map((r) => r.unresolved)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("keeps the Slack raw scalars silver reads", () => {
    const slack = parseAll({ projection: "derive" })[2]!;
    expect(slack.raw).toEqual({ bot_id: "B9", subtype: "bot_message", user: "U42" });
  });

  it("keeps the github author typename, nested exactly where actorKind looks for it", () => {
    expect(parseAll({ projection: "derive" })[1]!.raw).toEqual({ author: { __typename: "Bot" } });
  });

  it("drops the rest of the raw payload", () => {
    const rawUnderDerive = JSON.stringify(parseAll({ projection: "derive" }).map((r) => r.raw));
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule: the rows on
    // the way in really carry all four, so an empty projection is not what makes this green.
    const onTheWayIn = ROWS.join(" ");
    expect(onTheWayIn).toContain("xxxx");
    expect(onTheWayIn).toContain("yyyy");
    expect(onTheWayIn).toContain("zzzz");
    expect(onTheWayIn).toContain("login");
    expect(rawUnderDerive).not.toContain("xxxx");
    expect(rawUnderDerive).not.toContain("yyyy");
    expect(rawUnderDerive).not.toContain("zzzz");
    expect(rawUnderDerive).not.toContain("login");
  });

  it("omits raw entirely when none of the retained scalars were present", () => {
    expect(parseAll({ projection: "derive" })[3]!.raw).toBeUndefined();
  });

  it("is dramatically smaller than bronze on the same rows", () => {
    const bronze = JSON.stringify(parseAll({ projection: "bronze" })).length;
    const derived = JSON.stringify(parseAll({ projection: "derive" })).length;
    expect(derived).toBeLessThan(bronze / 4);
  });
});

describe("the derive projection changes no silver artefact", () => {
  it("builds a byte-identical directory", () => {
    expect(silverFor({ projection: "derive" }).directory).toEqual(silverFor({ projection: "bronze" }).directory);
  });

  it("builds a byte-identical cross-ref graph", () => {
    expect(silverFor({ projection: "derive" }).graph).toEqual(silverFor({ projection: "bronze" }).graph);
  });

  it("builds byte-identical opportunities, which is the detector that reads the body", () => {
    expect(silverFor({ projection: "derive" }).opportunities).toEqual(
      silverFor({ projection: "bronze" }).opportunities,
    );
  });

  it("classifies the same actors, which is the detector that reads raw", () => {
    expect(silverFor({ projection: "derive" }).kindedPeople).toEqual(silverFor({ projection: "bronze" }).kindedPeople);
  });

  it("builds byte-identical curated edges", () => {
    expect(silverFor({ projection: "derive" }).curated).toEqual(silverFor({ projection: "bronze" }).curated);
  });
});

/**
 * A `pr` row exactly as `corpus/github/fetch.ts` projects one: from a REST issue-search hit, whose author
 * lives at `raw.user` as an OBJECT carrying `type`, with no `author` and no `__typename` anywhere. Measured
 * on a real bronze store, every one of its 34,443 `pr` rows is this shape.
 */
const restHit = ({ type, login }: { type: string; login: string }): string =>
  JSON.stringify({
    author: login,
    container: "acme/web",
    kind: "pr",
    raw: { number: 7, user: { avatar_url: "https://example.invalid/a.png", login, type } },
    refs: [],
    source: "github",
    sourceId: "#7",
    text: "chore: bump things",
    title: "Update dependency",
    tsIso: "2026-09-04T00:00:00.000Z",
    url: "https://example.invalid/7",
  });

const parseOne = ({ line, projection }: { line: string; projection: "bronze" | "derive" }): CorpusRecord => {
  const parsed = parseRow({ line, projection });
  if (!("record" in parsed)) {
    throw new Error(`fixture row rejected: ${parsed.error}`);
  }
  return parsed.record;
};

describe("the derive projection keeps the GitHub REST account type", () => {
  it("carries user.type through, which the string-only read dropped for every pr row", () => {
    expect(parseOne({ line: restHit({ login: "renovate", type: "Bot" }), projection: "derive" }).raw).toEqual({
      user: { type: "Bot" },
    });
  });

  it("carries the User half the same way, since half a signal names no people", () => {
    expect(parseOne({ line: restHit({ login: "alice", type: "User" }), projection: "derive" }).raw).toEqual({
      user: { type: "User" },
    });
  });

  it("drops the rest of the REST user object", () => {
    const line = restHit({ login: "renovate", type: "Bot" });
    // The falsifiable half: the row on the way IN really carries both, so an empty projection is not what
    // makes the absence green.
    expect(line).toContain("avatar_url");
    expect(line).toContain('"login":"renovate"');
    const projected = JSON.stringify(parseOne({ line, projection: "derive" }).raw);
    expect(projected).not.toContain("avatar_url");
    expect(projected).not.toContain("renovate");
  });

  it("leaves a Slack string user exactly as it was — the same field name, a different field", () => {
    const slack = parseOne({ line: ROWS[2]!, projection: "derive" });
    expect(slack.raw).toEqual({ bot_id: "B9", subtype: "bot_message", user: "U42" });
  });

  it("classifies a REST bot row as a machine UNDER DERIVE, which is the projection derive actually uses", () => {
    const record = parseOne({ line: restHit({ login: "renovate", type: "Bot" }), projection: "derive" });
    expect(classifyActor({ index: new Map(), record }).kind).toBe("machine");
  });

  it("classifies a REST user row as a human under derive, with no member row anywhere", () => {
    const record = parseOne({ line: restHit({ login: "alice", type: "User" }), projection: "derive" });
    expect(classifyActor({ index: new Map(), record }).kind).toBe("human");
  });

  it("classifies the same way under bronze, so the projection is not what decides it", () => {
    const record = parseOne({ line: restHit({ login: "renovate", type: "Bot" }), projection: "bronze" });
    expect(classifyActor({ index: new Map(), record }).kind).toBe("machine");
  });
});

describe("bodyFields", () => {
  it("returns nothing under bronze and retrieval, so the body already on the record stands", () => {
    expect(bodyFields({ projection: "bronze", text: "this is blocked", title: undefined })).toEqual({});
    expect(bodyFields({ projection: "retrieval", text: "this is blocked", title: undefined })).toEqual({});
  });

  it("blanks the body under derive and flags a marker found in the body", () => {
    expect(bodyFields({ projection: "derive", text: "this is blocked on infra", title: "Ship it" })).toEqual({
      text: "",
      unresolved: true,
    });
  });

  it("flags a marker found only in the title", () => {
    expect(bodyFields({ projection: "derive", text: "all fine here", title: "WIP: the widget" })).toEqual({
      text: "",
      unresolved: true,
    });
  });

  it("does not flag a body and title with no marker, with or without a title", () => {
    expect(bodyFields({ projection: "derive", text: "all fine here", title: "Ship it" })).toEqual({
      text: "",
      unresolved: false,
    });
    expect(bodyFields({ projection: "derive", text: "all fine here", title: undefined })).toEqual({
      text: "",
      unresolved: false,
    });
  });
});

describe("deriveRawDigest", () => {
  it("returns undefined for no payload, an empty one and one carrying nothing silver reads", () => {
    expect(deriveRawDigest({ raw: undefined })).toBeUndefined();
    expect(deriveRawDigest({ raw: {} })).toBeUndefined();
    expect(deriveRawDigest({ raw: { channel: "C1", text: "hello", ts: "1.0" } })).toBeUndefined();
  });

  it("keeps every Slack scalar and the GraphQL typename together, dropping everything beside them", () => {
    expect(
      deriveRawDigest({
        raw: {
          author: { __typename: "Bot", login: "renovate" },
          blocks: [{ type: "section" }],
          bot_id: "B9",
          subtype: "bot_message",
          text: "bulk",
          user: "U42",
        },
      }),
    ).toEqual({ author: { __typename: "Bot" }, bot_id: "B9", subtype: "bot_message", user: "U42" });
  });

  it("keeps a GitHub REST user's type as an object, dropping the rest of that object", () => {
    expect(
      deriveRawDigest({
        raw: { number: 7, user: { avatar_url: "https://example.invalid/a.png", login: "a", type: "User" } },
      }),
    ).toEqual({ user: { type: "User" } });
  });

  it("keeps a Slack string user as the string itself", () => {
    expect(deriveRawDigest({ raw: { user: "U42" } })).toEqual({ user: "U42" });
  });

  it("omits every wrong-typed value, so a payload of only those yields undefined", () => {
    expect(
      deriveRawDigest({
        raw: { author: { __typename: 7 }, bot_id: null, subtype: 3, user: { login: "a", type: 1 } },
      }),
    ).toBeUndefined();
    expect(deriveRawDigest({ raw: { author: "alice", user: 42 } })).toBeUndefined();
  });
});
