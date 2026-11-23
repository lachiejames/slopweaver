/**
 * The bronze-to-store projection, over every source shape bronze actually holds.
 *
 * A pure function of a record, so every case here is a value in and a value out with no Postgres, no
 * fixture home and no mock. The records below are the SHAPES measured off real bronze —
 * `head -1 ~/.slopweaver/corpus/bronze/<source>/*.jsonl` for each of the six — rather than shapes invented
 * to suit the projection, which is the difference between testing the code and testing the assumption.
 *
 * The container strings are the interesting half and the reason this file exists. They are source-shaped
 * rather than uniform: `owner/repo`, `slack/C0SY…`, `linear/INS`, a bare `notion`, `work-console-state`,
 * and `mail/updates` whose prefix is not even its own source name. A projection that split on `/` and took
 * element one would produce a Linear team of `INS` and a GitHub repo of `slopweaver`, and only one of
 * those is right.
 *
 * The container and author IDS below are synthetic while their SHAPES are the measured ones. That is the
 * hygiene gate's doing rather than a preference — a real Slack channel id is a `raw-workspace-id` leak
 * class, and this file carried ten of them before the gate flagged them. Only the structure matters
 * to the projection, so nothing under test is weakened by the substitution.
 */
import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../corpus/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { projectRecord } from "../../../store/project.js";

/** A record carrying only what the projection reads, so each test states its own subject. */
const record = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "slack/c-random",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "c-random:1000000000.000001",
  text: "hello",
  tsIso: "2026-09-05T11:59:13.000Z",
  url: "https://example.slack.com/archives/c-random/p1788609553942549",
  ...over,
});

/**
 * The per-source side row a record projects to, as an open record so one assertion names one column.
 *
 * The projection returns a DISCRIMINATED union — that is the point of it, and it is what stops a GitHub
 * reader touching a Slack column in real code. A test asserting one column at a time wants the opposite,
 * so it widens here, once, rather than narrowing at every call.
 */
const sideRow = ({ from }: { from: CorpusRecord }): Record<string, unknown> => {
  const projected = unwrap(projectRecord({ record: from }));
  return { ...projected.sourceRow?.row };
};

describe("each source's own columns are read into its own table", () => {
  it("takes a slack channel from the segment after the source prefix", () => {
    const row = sideRow({ from: record() });
    expect(row["channelId"]).toBe("c-random");
  });

  it("falls back to the payload's ts when the id is not one of the two Slack message layouts", () => {
    const row = sideRow({ from: record({ raw: { ts: "1000000000.000001" } }) });
    expect(row["messageTs"]).toBe("1000000000.000001");
  });

  it("counts every reaction across every emoji, which no column of bronze carries", () => {
    const raw = {
      reactions: [
        { count: 3, name: "sparkles" },
        { count: 26, name: "heart" },
      ],
      ts: "1.1",
    };
    expect(sideRow({ from: record({ raw }) })["reactionCount"]).toBe(29);
  });

  it("marks a message a bot wrote, which is 99.83% of one real container", () => {
    const raw = { bot_id: "B1", ts: "1.1" };
    expect(sideRow({ from: record({ raw }) })["isBot"]).toBe(true);
  });

  it("takes a linear team from the segment after the source prefix", () => {
    const row = sideRow({ from: record({ container: "linear/INS", kind: "issue", source: "linear" }) });
    expect(row["team"]).toBe("INS");
  });

  it("splits linear's state object into the name and the type a query filters on separately", () => {
    const raw = { state: { name: "In Progress", type: "started" } };
    const row = sideRow({ from: record({ container: "linear/DEVX", kind: "issue", raw, source: "linear" }) });
    expect(row["state"]).toBe("In Progress");
    expect(row["stateType"]).toBe("started");
  });

  it("takes a github repo from the WHOLE container, since owner/repo is the field", () => {
    const row = sideRow({ from: record({ container: "slopweaver/slopweaver", kind: "pr", source: "github" }) });
    expect(row["repo"]).toBe("slopweaver/slopweaver");
  });

  it("flattens github's label objects into the array a GIN index can answer", () => {
    const raw = { labels: [{ name: "enhancement" }, { name: "bug" }] };
    const row = sideRow({ from: record({ container: "o/r", kind: "issue", raw, source: "github" }) });
    expect(row["labels"]).toEqual(["enhancement", "bug"]);
  });

  it("reads notion's parent id through the key its own type names", () => {
    const raw = { parent: { block_id: "d0f67063", type: "block_id" } };
    const row = sideRow({ from: record({ container: "notion", kind: "page", raw, source: "notion" }) });
    expect(row["parentKind"]).toBe("block_id");
    expect(row["parentId"]).toBe("d0f67063");
  });

  it("keeps notion's property bag, the one shape a fixed column list cannot express", () => {
    const raw = { properties: { Status: { type: "select" } } };
    const row = sideRow({ from: record({ container: "notion", kind: "page", raw, source: "notion" }) });
    expect(row["properties"]).toEqual({ Status: { type: "select" } });
  });

  it("gives a source with no table no side row at all, rather than an empty one", () => {
    const projected = unwrap(
      projectRecord({ record: record({ container: "mail/updates", kind: "message", source: "gmail" }) }),
    );
    expect(projected.sourceRow).toBe(null);
  });

  it("refuses a slack record whose container yields no channel", () => {
    const refused = unwrapErr(projectRecord({ record: record({ container: "/" }) }));
    expect(refused.reason).toContain("fill no slack row");
  });
});

describe("a github id is qualified by its repository, because #6 is not an id", () => {
  const gh = (over: Partial<CorpusRecord> = {}): CorpusRecord =>
    record({ container: "acme/1password-scim-gcp", kind: "issue", source: "github", sourceId: "#6", ...over });

  it("prefixes the repository, so two repos' #6 are two rows", () => {
    expect(unwrap(projectRecord({ record: gh() })).content.sourceId).toBe("acme/1password-scim-gcp#6");
  });

  it("gives a different repository's #6 a different id", () => {
    expect(unwrap(projectRecord({ record: gh({ container: "acme/cf-marketing-cdn" }) })).content.sourceId).toBe(
      "acme/cf-marketing-cdn#6",
    );
  });

  it("leaves an already-qualified id alone, so a re-ingest is idempotent", () => {
    expect(unwrap(projectRecord({ record: gh({ sourceId: "acme/acme-admin#13783" }) })).content.sourceId).toBe(
      "acme/acme-admin#13783",
    );
  });

  it("leaves every other source's id verbatim, because none of them collides", () => {
    expect(unwrap(projectRecord({ record: record() })).content.sourceId).toBe("c-random:1000000000.000001");
  });
});

describe("the container is stored whole, and typed per source", () => {
  it("keeps the slack container string verbatim as its native id", () => {
    expect(unwrap(projectRecord({ record: record() })).container.nativeId).toBe("slack/c-random");
  });

  it("calls a slack container a channel", () => {
    expect(unwrap(projectRecord({ record: record() })).container.kind).toBe("channel");
  });

  it("calls a github container a repository", () => {
    const projected = unwrap(
      projectRecord({ record: record({ container: "slopweaver/slopweaver", kind: "pr", source: "github" }) }),
    );
    expect(projected.container.kind).toBe("repository");
  });

  it("calls the mailbox's container a mailbox, whose prefix is not its own source name", () => {
    const projected = unwrap(
      projectRecord({ record: record({ container: "mail/updates", kind: "message", source: "gmail" }) }),
    );
    expect(projected.container.kind).toBe("mailbox");
    expect(projected.container.nativeId).toBe("mail/updates");
  });

  it("calls the owner's own writing a directory, whose container carries no prefix at all", () => {
    const projected = unwrap(
      projectRecord({ record: record({ container: "work-console-state", kind: "document", source: "self" }) }),
    );
    expect(projected.container.kind).toBe("directory");
    expect(projected.container.nativeId).toBe("work-console-state");
  });
});

describe("what a record carries into the store", () => {
  it("carries refs, so the cross-reference graph survives the move off files", () => {
    const projected = unwrap(projectRecord({ record: record({ refs: ["#123", "@someone"] }) }));
    expect(projected.content.metadata["refs"]).toEqual(["#123", "@someone"]);
  });

  it("drops raw, which the owner ruled out and which measured 31.3% to 64.7% of record bytes", () => {
    const projected = unwrap(projectRecord({ record: record({ raw: { ts: "1000000000.000001" } }) }));
    expect("raw" in projected.content.metadata).toBe(false);
  });

  it("keeps an attribute no per-source column claimed", () => {
    const projected = unwrap(projectRecord({ record: record({ attrs: { membership: "member" } }) }));
    expect(projected.content.metadata["attrs"]).toEqual({ membership: "member" });
  });

  it("drops an attribute a column claimed, so one fact never sits in two places", () => {
    const projected = unwrap(projectRecord({ record: record({ attrs: { channel: "#general" } }) }));
    expect("attrs" in projected.content.metadata).toBe(false);
  });

  it("carries the claimed attribute into the column instead of losing it", () => {
    expect(sideRow({ from: record({ attrs: { channel: "#general" } }) })["channelName"]).toBe("#general");
  });

  it("reads an unmarked record as public, which is what legacy bronze means", () => {
    expect(unwrap(projectRecord({ record: record() })).content.visibility).toBe("public");
  });

  it("keeps a private record private", () => {
    expect(unwrap(projectRecord({ record: record({ visibility: "private" }) })).content.visibility).toBe("private");
  });

  it("turns the ISO instant into a Date the column takes", () => {
    expect(unwrap(projectRecord({ record: record() })).content.occurredAt.toISOString()).toBe(
      "2026-09-05T11:59:13.000Z",
    );
  });

  it("names no author when the record has none", () => {
    expect(unwrap(projectRecord({ record: record() })).author).toBe(null);
  });

  it("names the author when the record has one", () => {
    expect(unwrap(projectRecord({ record: record({ author: "u-first" }) })).author?.nativeId).toBe("u-first");
  });

  it("carries no address for a Slack author, because the payload holds none", () => {
    expect(unwrap(projectRecord({ record: record({ author: "u-first" }) })).author?.email).toBe(null);
  });
});

// The source-neutral flag the detective verbs filter on, decided by `botAuthor.ts`.
describe("the bot flag every source's content row carries", () => {
  it("flags a Slack message carrying a bot_id", () => {
    expect(unwrap(projectRecord({ record: record({ raw: { bot_id: "B1", ts: "1.1" } }) })).content.authorIsBot).toBe(
      true,
    );
  });

  it("flags a GitHub record whose author is a [bot] login", () => {
    const gh = record({
      author: "acme-renovate[bot]",
      container: "acme/acme-admin",
      kind: "pr",
      source: "github",
      sourceId: "acme/acme-admin#13783",
    });
    expect(unwrap(projectRecord({ record: gh })).content.authorIsBot).toBe(true);
  });

  it("leaves a person's record human", () => {
    expect(unwrap(projectRecord({ record: record({ author: "u-first" }) })).content.authorIsBot).toBe(false);
  });
});

describe("a record that cannot be stored is refused by name", () => {
  it("refuses gold, the one source synthesised at query time and never persisted", () => {
    const refused = unwrapErr(projectRecord({ record: record({ kind: "finding", source: "gold" }) }));
    expect(refused.code).toBe("ROW_REFUSED");
    expect(refused.reason).toContain("no column for source");
  });

  it("refuses a record naming no container", () => {
    expect(unwrapErr(projectRecord({ record: record({ container: "" }) })).reason).toContain("names no container");
  });

  it("names the record it refused, so a million-row run says WHICH row", () => {
    const refused = unwrapErr(projectRecord({ record: record({ container: "" }) }));
    expect(refused.sourceId).toBe("c-random:1000000000.000001");
    expect(refused.source).toBe("slack");
  });

  it("stores every kind the corpus can write, huddle and transcript included", () => {
    expect(unwrap(projectRecord({ record: record({ kind: "huddle" }) })).content.kind).toBe("huddle");
    expect(
      unwrap(projectRecord({ record: record({ container: "mail/x", kind: "transcript", source: "gmail" }) })).content
        .kind,
    ).toBe("transcript");
  });
});

describe("the raw envelope, which is what makes promoting the next column a projection", () => {
  it("carries the slack payload verbatim beside the columns promoted out of it", () => {
    const row = sideRow({ from: record({ raw: { blocks: [{ type: "rich_text" }], ts: "1000000000.000001" } }) });
    expect(row["messageTs"]).toBe("1000000000.000001");
    expect(row["raw"]).toEqual({ blocks: [{ type: "rich_text" }], ts: "1000000000.000001" });
  });

  it("keeps a field NO column promoted, which is the whole reason the envelope exists", () => {
    const row = sideRow({ from: record({ raw: { edited: { ts: "1000000001.000000" }, ts: "1000000000.000001" } }) });
    expect(Object.hasOwn(row, "edited")).toBe(false);
    expect((row["raw"] as Record<string, unknown>)["edited"]).toEqual({ ts: "1000000001.000000" });
  });

  it("stores an empty object, not null, for bronze written before raw capture landed", () => {
    const row = sideRow({ from: record() });
    expect(row["raw"]).toEqual({});
  });

  it("copies rather than aliases the record, so a projected row cannot mutate its own bronze", () => {
    const from = record({ raw: { ts: "1000000000.000001" } });
    const row = sideRow({ from });
    expect(row["raw"]).not.toBe(from.raw);
    expect(row["raw"]).toEqual({ ts: "1000000000.000001" });
  });

  it("carries the envelope on github, whose columns read the fewest of its keys", () => {
    const from = record({
      container: "lachiejames/slopweaver",
      kind: "comment",
      raw: { body: "looks good", node_id: "MDEyOklzc3VlQ29t", path: "src/store/project.ts" },
      source: "github",
      sourceId: "#13783",
    });
    expect(sideRow({ from })["raw"]).toEqual({
      body: "looks good",
      node_id: "MDEyOklzc3VlQ29t",
      path: "src/store/project.ts",
    });
  });

  it("carries the envelope on linear beside the state it promoted out of it", () => {
    const from = record({
      container: "linear/INS",
      kind: "issue",
      raw: {
        identifier: "INS-42",
        slaBreachesAt: "2026-09-20T00:00:00.000Z",
        state: { name: "Done", type: "completed" },
      },
      source: "linear",
      sourceId: "INS-42",
    });
    const row = sideRow({ from });
    expect(row["state"]).toBe("Done");
    expect((row["raw"] as Record<string, unknown>)["slaBreachesAt"]).toBe("2026-09-20T00:00:00.000Z");
  });

  it("carries the envelope on notion beside the properties bag it already kept", () => {
    const from = record({
      container: "notion",
      kind: "page",
      raw: { properties: { Status: { type: "status" } }, public_url: "https://notion.so/x" },
      source: "notion",
      sourceId: "page-1",
    });
    const row = sideRow({ from });
    expect(row["properties"]).toEqual({ Status: { type: "status" } });
    expect((row["raw"] as Record<string, unknown>)["public_url"]).toBe("https://notion.so/x");
  });
});

/**
 * The two Slack timestamp columns, derived from the record's own id rather than from its payload.
 *
 * `redactRecord.ts`'s `redactRecord` runs the redactor over `raw` and not over `sourceId`, and the
 * `\d{9,}` pass turned every `ts` in that payload into `[number].008629`. MEASURED on the
 * live store: 662,438 of 709,059 `message_ts` values and 100% of the non-null `thread_ts` values were
 * carved up. So these columns read the id, and the payload is what they fall back to — which is the
 * direction the projection used to have backwards, and the reason a re-ingest of the same bronze heals
 * every row without a provider refetch.
 */
describe("the slack timestamps are derived from the id the redactor never touches", () => {
  /** A channel and a thread, spelled the way `corpus/slack/project.ts` builds a `sourceId`. */
  const CHANNEL = "C0SYN4E1234567";
  const ROOT = "1773784810.008629";
  const REPLY = "1773811363.025049";

  /** One Slack record, whose payload carries the CARVED-UP timestamps the live store actually holds. */
  const carved = (over: Partial<CorpusRecord> = {}): CorpusRecord =>
    record({
      container: `slack/${CHANNEL}`,
      raw: { thread_ts: "[number].008629", ts: "[number].008629" },
      sourceId: `${CHANNEL}:${ROOT}`,
      ...over,
    });

  it("reads a top-level message's ts out of its id, not out of the carved-up payload", () => {
    const row = sideRow({ from: carved() });
    expect(row["messageTs"]).toBe(ROOT);
    expect(row["threadTs"]).toBe(ROOT);
  });

  it("splits a reply's two timestamps, so its thread key is the root and not its own ts", () => {
    const row = sideRow({
      from: carved({ kind: "comment", sourceId: `${CHANNEL}:${ROOT}:reply:${REPLY}` }),
    });
    expect(row["messageTs"]).toBe(REPLY);
    expect(row["threadTs"]).toBe(ROOT);
  });

  it("leaves a message outside a thread with no thread key at all, rather than inventing one", () => {
    const row = sideRow({ from: carved({ raw: { ts: "[number].008629" } }) });
    expect(row["messageTs"]).toBe(ROOT);
    expect(row["threadTs"]).toBe(null);
  });

  it("keeps the carved payload verbatim beside the healed columns, because raw is what was ingested", () => {
    expect(sideRow({ from: carved() })["raw"]).toEqual({ thread_ts: "[number].008629", ts: "[number].008629" });
  });

  it("takes attrs.threadTs as the thread marker too, which is where an older bronze row carries it", () => {
    const row = sideRow({ from: carved({ attrs: { threadTs: "[number].008629" }, raw: { ts: "[number].008629" } }) });
    expect(row["threadTs"]).toBe(ROOT);
  });

  it("falls back to the id itself when neither the id nor the payload holds a timestamp", () => {
    const row = sideRow({ from: carved({ raw: {}, sourceId: `${CHANNEL}:pin:${ROOT}` }) });
    expect(row["messageTs"]).toBe(`${CHANNEL}:pin:${ROOT}`);
    expect(row["threadTs"]).toBe(null);
  });
});
