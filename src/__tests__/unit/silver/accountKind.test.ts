import { describe, expect, it } from "vitest";
import { absentAs } from "#lib/absent.js";
import type { EmailTrust, MemberBronzeRow } from "../../../corpus/members/types.js";
import {
  accountKindIndex,
  classifyAccount,
  classifyMemberRow,
  hasBotLoginSuffix,
  isIntegrationEmail,
  withAccountKinds,
} from "../../../silver/accountKind.js";
import type { IdentitySource, Person } from "../../../silver/identity.js";

/** A member row fixture — synthetic ids, `example.com` emails only. */
const member = ({
  source = "slack",
  nativeId,
  handle,
  name,
  email,
  emailTrust = "missing",
  bot = false,
}: {
  source?: IdentitySource;
  nativeId: string;
  handle?: string;
  name?: string;
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
    ...(name !== undefined ? { name } : {}),
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

/** A resolved person fixture. */
const person = ({
  id,
  source = "slack",
  nativeId,
  name,
  email,
}: {
  id: string;
  source?: IdentitySource;
  nativeId: string;
  name?: string;
  email?: string;
}): Person => ({
  confidence: "single-source",
  displayName: absentAs({ value: name, whenAbsent: nativeId }),
  id,
  identities: [
    { nativeId, source, ...(name !== undefined ? { name } : {}), ...(email !== undefined ? { email } : {}) },
  ],
  provenance: [],
});

describe("isIntegrationEmail", () => {
  it("matches the Linear app domain exactly and by dot-suffix", () => {
    expect(isIntegrationEmail({ email: "app@integration.linear.app" })).toBe(true);
    expect(isIntegrationEmail({ email: "app@oauthapp.linear.app" })).toBe(true);
    expect(isIntegrationEmail({ email: "app@linear.app" })).toBe(true);
  });

  it("does not match a human address, nor a look-alike domain", () => {
    expect(isIntegrationEmail({ email: "ada@example.com" })).toBe(false);
    expect(isIntegrationEmail({ email: "ada@notlinear.appliances.com" })).toBe(false);
    expect(isIntegrationEmail({ email: "no-at-sign" })).toBe(false);
  });
});

describe("hasBotLoginSuffix", () => {
  it("matches only the exact `[bot]` login suffix", () => {
    expect(hasBotLoginSuffix({ value: "dependabot[bot]" })).toBe(true);
    expect(hasBotLoginSuffix({ value: "@dependabot[bot]" })).toBe(true);
    expect(hasBotLoginSuffix({ value: "robotics-ada" })).toBe(false);
    expect(hasBotLoginSuffix({ value: "ada" })).toBe(false);
  });
});

describe("classifyMemberRow", () => {
  it("classifies a `profile.bot` member as a bot", () => {
    expect(classifyMemberRow({ row: member({ bot: true, name: "Deploy Notifier", nativeId: "u-bot-1" }) })).toEqual({
      kind: "bot",
      reasons: ["member-profile-bot"],
    });
  });

  it("classifies an integration email domain as an integration", () => {
    expect(
      classifyMemberRow({
        row: member({ email: "app@integration.linear.app", nativeId: "l-app-1", source: "linear" }),
      }),
    ).toEqual({ kind: "integration", reasons: ["integration-email-domain"] });
  });

  it("classifies a known bot login suffix as a bot, with both reasons", () => {
    expect(classifyMemberRow({ row: member({ bot: true, nativeId: "dependabot[bot]", source: "github" }) })).toEqual({
      kind: "bot",
      reasons: ["login-suffix:[bot]", "member-profile-bot"],
    });
  });

  it("classifies a known integration handle as an integration when it carries no trusted email", () => {
    expect(classifyMemberRow({ row: member({ name: "Datadog", nativeId: "u-dd-1" }) })).toEqual({
      kind: "integration",
      reasons: ["known-integration-handle"],
    });
  });

  it("does NOT classify a member merely named after a product a human could be named (over-filter guard)", () => {
    // `slack`/`linear`/`github`/`incident` are deliberately absent from the known-handle sets: an
    // email-less real member must never be erased from the directory by a generic word.
    expect(classifyMemberRow({ row: member({ name: "Slack", nativeId: "u-1" }) })).toEqual({
      kind: "person",
      reasons: [],
    });
    expect(classifyMemberRow({ row: member({ handle: "incident", nativeId: "u-2" }) })).toEqual({
      kind: "person",
      reasons: [],
    });
  });

  it("NEVER reclassifies a member with a trusted personal email, even on a known-handle collision", () => {
    expect(
      classifyMemberRow({
        row: member({ email: "ada@example.com", emailTrust: "trusted", name: "Datadog", nativeId: "u-ada" }),
      }),
    ).toEqual({ kind: "person", reasons: [] });
  });

  it("classifies a real person as a person, with no reasons", () => {
    expect(
      classifyMemberRow({
        row: member({ email: "ada@example.com", emailTrust: "trusted", name: "Ada Byron", nativeId: "u-ada" }),
      }),
    ).toEqual({ kind: "person", reasons: [] });
  });
});

describe("accountKindIndex", () => {
  it("indexes a bot's native id, handle and NAME (a Slack author is a display name)", () => {
    const index = accountKindIndex({
      rows: [member({ bot: true, handle: "deploy-notifier", name: "Deploy Notifier", nativeId: "U-BOT-1" })],
    });
    expect(index.get("u-bot-1")!.kind).toBe("bot");
    expect(index.get("deploy-notifier")!.kind).toBe("bot");
    expect(index.get("deploy notifier")!.kind).toBe("bot");
  });

  it("omits a key claimed by BOTH a bot and a real person (a collision never filters a human)", () => {
    const index = accountKindIndex({
      rows: [
        member({ bot: true, name: "Robin", nativeId: "u-bot-2" }),
        member({ email: "robin@example.com", emailTrust: "trusted", name: "Robin", nativeId: "u-human-2" }),
      ],
    });
    expect(index.has("robin")).toBe(false);
    expect(index.get("u-bot-2")!.kind).toBe("bot");
  });

  it("indexes nothing for a workspace of only real people", () => {
    const index = accountKindIndex({
      rows: [member({ email: "ada@example.com", emailTrust: "trusted", name: "Ada Byron", nativeId: "u-ada" })],
    });
    expect(index.size).toBe(0);
  });
});

describe("classifyAccount", () => {
  const index = accountKindIndex({
    rows: [
      member({ bot: true, name: "Deploy Notifier", nativeId: "U-BOT-1" }),
      member({ email: "app@integration.linear.app", nativeId: "l-app-1", source: "linear" }),
    ],
  });

  it("classifies a raw, unresolved directory id by exact display-name match", () => {
    expect(classifyAccount({ id: "Deploy Notifier", index })).toEqual({ kind: "bot", reasons: ["member-profile-bot"] });
  });

  it("classifies a raw id by the structural `[bot]` suffix with no member row at all", () => {
    expect(classifyAccount({ id: "github-actions[bot]", index: new Map() })).toEqual({
      kind: "bot",
      reasons: ["login-suffix:[bot]"],
    });
  });

  it("classifies a resolved person through its identities", () => {
    expect(
      classifyAccount({
        id: "person:email:app@integration.linear.app",
        identities: [{ email: "app@integration.linear.app", nativeId: "l-app-1", source: "linear" }],
        index,
      }),
    ).toEqual({ kind: "integration", reasons: ["integration-email-domain"] });
  });

  it("defaults an unmatched account to person — an un-hydrated source never loses real people", () => {
    expect(classifyAccount({ id: "ada", index })).toEqual({ kind: "person", reasons: [] });
  });
});

describe("withAccountKinds", () => {
  it("labels every person WITHOUT changing the resolution (same ids, same order)", () => {
    const people = [
      person({ id: "person:slack:u-bot-1", name: "Deploy Notifier", nativeId: "U-BOT-1" }),
      person({ email: "ada@example.com", id: "person:email:ada@example.com", name: "Ada Byron", nativeId: "u-ada" }),
    ];
    const index = accountKindIndex({ rows: [member({ bot: true, name: "Deploy Notifier", nativeId: "U-BOT-1" })] });
    const kinded = withAccountKinds({ index, people });
    expect(kinded.map((p) => p.id)).toEqual(people.map((p) => p.id));
    expect(kinded[0]!.kind).toBe("bot");
    expect(kinded[0]!.kindReasons).toEqual(["member-profile-bot"]);
    expect(kinded[1]!.kind).toBe("person");
    expect(kinded[1]!.kindReasons).toEqual([]);
    expect(kinded[1]!.identities).toEqual(people[1]!.identities);
    expect(kinded[1]!.confidence).toBe("single-source");
  });
});

describe("external contacts", () => {
  /** A Linear row as `externalUsers` really returns it: no active, no teams, no title, empty email. */
  const externalRow = (over: Partial<MemberBronzeRow> = {}): MemberBronzeRow => ({
    fetchedAtIso: "2026-08-23T00:00:00.000Z",
    identity: { emailTrust: "missing", name: "Othercompany Buyer", nativeId: "ext-1", source: "linear" },
    profile: {},
    provenance: ["linear.externalUsers"],
    raw: {},
    source: "linear",
    sourceId: "ext-1",
    version: 1,
    warnings: [],
    ...over,
  });

  it("classifies a row whose provenance is linear.externalUsers as external", () => {
    const classified = classifyMemberRow({ row: externalRow() });

    expect(classified.kind).toBe("external");
    expect(classified.reasons).toEqual(["provenance:linear.externalUsers"]);
  });

  it("does NOT classify a workspace user as external just because they have no email", () => {
    // The distinction is the recorded provenance, never a missing field — otherwise a colleague whose email
    // is absent gets filed as a customer, which is the misreport this change exists to end.
    const classified = classifyMemberRow({
      row: externalRow({
        identity: { emailTrust: "missing", name: "Real Colleague", nativeId: "u-1", source: "linear" },
        provenance: ["linear.users"],
      }),
    });

    expect(classified.kind).toBe("person");
  });

  it("returns external BEFORE the bot heuristics run, so a customer's handle cannot read as a bot", () => {
    const classified = classifyMemberRow({
      row: externalRow({
        identity: {
          emailTrust: "missing",
          handle: "dependabot[bot]",
          name: "Othercompany",
          nativeId: "ext-2",
          source: "linear",
        },
      }),
    });

    expect(classified.kind).toBe("external");
  });
});
