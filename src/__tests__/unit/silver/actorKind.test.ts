import { describe, expect, it } from "vitest";
import type { EmailTrust, MemberBronzeRow } from "../../../corpus/members/types.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { accountKindIndexAll } from "../../../silver/accountKind.js";
import {
  classifyActor,
  machineIdentityReasons,
  machineTransportReasons,
  namesAPerson,
} from "../../../silver/actorKind.js";
import type { IdentitySource } from "../../../silver/identity.js";

/** A member row fixture — synthetic ids, `example.com` emails only. */
const member = ({
  source = "slack",
  nativeId,
  handle,
  email,
  emailTrust = "missing",
  bot = false,
}: {
  source?: IdentitySource;
  nativeId: string;
  handle?: string;
  email?: string;
  emailTrust?: EmailTrust;
  bot?: boolean;
}): MemberBronzeRow => ({
  fetchedAtIso: "2026-06-01T00:00:00.000Z",
  identity: {
    emailTrust,
    nativeId,
    source,
    ...(handle !== undefined ? { handle } : {}),
    ...(email !== undefined ? { email, emailNormalised: email.toLowerCase() } : {}),
  },
  profile: { bot },
  provenance: ["fixture"],
  raw: {},
  source,
  sourceId: nativeId,
  version: 1,
  warnings: [],
});

/** A corpus record fixture — the fields this classifier reads, defaulted to a plain human Slack message. */
const record = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  container: "#general",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "p1",
  text: "hello",
  tsIso: "2026-08-28T00:00:00.000Z",
  url: "https://example.invalid/p1",
  ...over,
});

/** A real teammate and a bot, the two accounts every case below classifies against. */
const INDEX = accountKindIndexAll({
  rows: [
    member({ email: "person@example.com", emailTrust: "trusted", handle: "realperson", nativeId: "U_PERSON" }),
    member({ bot: true, handle: "helpbot", nativeId: "U_BOT" }),
  ],
});

describe("machineTransportReasons", () => {
  it("reports the bot_message subtype", () => {
    expect(machineTransportReasons({ record: record({ raw: { subtype: "bot_message" } }) })).toEqual([
      "slack-subtype:bot_message",
    ]);
  });

  it("reports a bot_id with no subtype — the 917-of-944 majority path", () => {
    expect(machineTransportReasons({ record: record({ raw: { app_id: "A1", bot_id: "B1" } }) })).toEqual([
      "slack-bot-id",
    ]);
  });

  it("reports both when both are present, sorted", () => {
    expect(machineTransportReasons({ record: record({ raw: { bot_id: "B1", subtype: "bot_message" } }) })).toEqual([
      "slack-bot-id",
      "slack-subtype:bot_message",
    ]);
  });

  it("reports nothing for a plain human message", () => {
    expect(machineTransportReasons({ record: record({ author: "U_PERSON", raw: { user: "U_PERSON" } }) })).toEqual([]);
  });

  it("reports nothing when the record carries no raw payload at all", () => {
    expect(machineTransportReasons({ record: record({ author: "U_PERSON" }) })).toEqual([]);
  });

  it("ignores an empty-string bot_id rather than treating its presence as the signal", () => {
    expect(machineTransportReasons({ record: record({ raw: { bot_id: "" } }) })).toEqual([]);
  });

  it("ignores a non-string bot_id", () => {
    expect(machineTransportReasons({ record: record({ raw: { bot_id: 42 } }) })).toEqual([]);
  });
});

describe("machineIdentityReasons", () => {
  it("reports a GraphQL Bot author", () => {
    expect(
      machineIdentityReasons({
        record: record({ author: "coderabbitai", raw: { author: { __typename: "Bot", login: "coderabbitai" } } }),
      }),
    ).toEqual(["github-typename:Bot"]);
  });

  it("reports nothing for a User author", () => {
    expect(
      machineIdentityReasons({
        record: record({ author: "realperson", raw: { author: { __typename: "User", login: "realperson" } } }),
      }),
    ).toEqual([]);
  });

  it("reports nothing when the projection captured no __typename — pre-change bronze", () => {
    expect(
      machineIdentityReasons({
        record: record({ author: "coderabbitai", raw: { author: { login: "coderabbitai" } } }),
      }),
    ).toEqual([]);
  });

  it("reports nothing when author is not an object", () => {
    expect(machineIdentityReasons({ record: record({ author: "x", raw: { author: "x" } }) })).toEqual([]);
  });
});

describe("classifyActor", () => {
  it("calls a subtype bot_message machine, even though it has no author to look up", () => {
    const result = classifyActor({ index: INDEX, record: record({ raw: { bot_id: "B1", subtype: "bot_message" } }) });
    expect(result.kind).toBe("machine");
    expect(result.reasons).toEqual(["slack-bot-id", "slack-subtype:bot_message"]);
    expect(result.onBehalfOf).toBeUndefined();
  });

  it("calls an app posting as its own bot user machine, and carries the account's reason", () => {
    const result = classifyActor({ index: INDEX, record: record({ author: "U_BOT", raw: { bot_id: "B1" } }) });
    expect(result.kind).toBe("machine");
    expect(result.reasons).toEqual(["member-profile-bot", "slack-bot-id"]);
  });

  it("calls a machine transport under a real person's account machine-as-person, naming whose it wore", () => {
    const result = classifyActor({ index: INDEX, record: record({ author: "U_PERSON", raw: { bot_id: "B1" } }) });
    expect(result.kind).toBe("machine-as-person");
    expect(result.onBehalfOf).toBe("U_PERSON");
    expect(result.reasons).toEqual(["account:person", "slack-bot-id"]);
  });

  it("calls a real person typing human", () => {
    const result = classifyActor({ index: INDEX, record: record({ author: "U_PERSON", raw: { user: "U_PERSON" } }) });
    expect(result.kind).toBe("human");
    expect(result.reasons).toEqual(["account:person"]);
    expect(result.onBehalfOf).toBeUndefined();
  });

  it("calls a bot account with no transport signal machine", () => {
    const result = classifyActor({ index: INDEX, record: record({ author: "U_BOT" }) });
    expect(result.kind).toBe("machine");
    expect(result.reasons).toEqual(["member-profile-bot"]);
  });

  it("calls a [bot]-suffixed login machine without needing a member row", () => {
    const result = classifyActor({ index: INDEX, record: record({ author: "dependabot[bot]", source: "github" }) });
    expect(result.kind).toBe("machine");
    expect(result.reasons).toEqual(["login-suffix"]);
  });

  it("refuses to call a pre-__typename GitHub App review author a person — the coderabbitai case", () => {
    const result = classifyActor({
      index: INDEX,
      record: record({ author: "coderabbitai", kind: "review", source: "github" }),
    });
    expect(result.kind).toBe("unattributed");
    expect(result.reasons).toEqual(["author-not-in-directory"]);
  });

  it("calls the same review machine once __typename is captured — the durable fix", () => {
    const result = classifyActor({
      index: INDEX,
      record: record({
        author: "coderabbitai",
        kind: "review",
        raw: { author: { __typename: "Bot", login: "coderabbitai" } },
        source: "github",
      }),
    });
    expect(result.kind).toBe("machine");
    expect(result.reasons).toEqual(["github-typename:Bot"]);
    expect(result.onBehalfOf).toBeUndefined();
  });

  it("never turns a Bot author into an as-me post, even when the account index calls it a person", () => {
    const result = classifyActor({
      index: INDEX,
      record: record({
        author: "U_PERSON",
        raw: { author: { __typename: "Bot", login: "U_PERSON" }, bot_id: "B1" },
        source: "github",
      }),
    });
    expect(result.kind).toBe("machine");
    expect(result.reasons).toEqual(["github-typename:Bot"]);
    expect(result.onBehalfOf).toBeUndefined();
  });

  it("calls a User author human even when no member row can place them", () => {
    const result = classifyActor({
      index: INDEX,
      record: record({
        author: "a-teammate",
        kind: "review",
        raw: { author: { __typename: "User", login: "a-teammate" } },
        source: "github",
      }),
    });
    expect(result.kind).toBe("human");
    expect(result.reasons).toEqual(["github-typename:User"]);
  });

  it("prefers the directory's richer reason over the typename for an account it knows", () => {
    const result = classifyActor({
      index: INDEX,
      record: record({
        author: "U_PERSON",
        raw: { author: { __typename: "User", login: "U_PERSON" } },
        source: "github",
      }),
    });
    expect(result.kind).toBe("human");
    expect(result.reasons).toEqual(["account:person"]);
  });

  it("leaves an author type that is neither Bot nor User unattributed rather than guessing", () => {
    const result = classifyActor({
      index: INDEX,
      record: record({
        author: "an-org",
        raw: { author: { __typename: "Organization", login: "an-org" } },
        source: "github",
      }),
    });
    expect(result.kind).toBe("unattributed");
    expect(result.reasons).toEqual(["author-not-in-directory"]);
  });

  it("calls a record with no author at all unattributed", () => {
    const result = classifyActor({ index: INDEX, record: record({}) });
    expect(result.kind).toBe("unattributed");
    expect(result.reasons).toEqual(["no-author"]);
  });

  it("treats an empty-string author as no author", () => {
    const result = classifyActor({ index: INDEX, record: record({ author: "" }) });
    expect(result.kind).toBe("unattributed");
    expect(result.reasons).toEqual(["no-author"]);
  });

  it("matches an account key case-insensitively, as the index is built lower-cased", () => {
    const result = classifyActor({ index: INDEX, record: record({ author: "HELPBOT" }) });
    expect(result.kind).toBe("machine");
    expect(result.reasons).toEqual(["member-profile-bot"]);
  });

  it("classifies against an empty index without promoting anyone to human", () => {
    const empty = accountKindIndexAll({ rows: [] });
    const result = classifyActor({ index: empty, record: record({ author: "U_PERSON" }) });
    expect(result.kind).toBe("unattributed");
    expect(result.reasons).toEqual(["author-not-in-directory"]);
  });
});

describe("namesAPerson", () => {
  it("permits a human", () => {
    expect(namesAPerson({ classification: { kind: "human", reasons: ["account:person"] } })).toBe(true);
  });

  it("refuses an unattributed actor — the inverted default that stops a bot being named a reviewer", () => {
    expect(namesAPerson({ classification: { kind: "unattributed", reasons: ["author-not-in-directory"] } })).toBe(
      false,
    );
  });

  it("refuses a machine", () => {
    expect(namesAPerson({ classification: { kind: "machine", reasons: ["slack-bot-id"] } })).toBe(false);
  });

  it("refuses an as-me post, whose text reads as a person's own words", () => {
    expect(
      namesAPerson({
        classification: { kind: "machine-as-person", onBehalfOf: "U_PERSON", reasons: ["slack-bot-id"] },
      }),
    ).toBe(false);
  });
});
