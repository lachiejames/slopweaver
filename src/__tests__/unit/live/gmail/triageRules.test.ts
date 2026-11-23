/**
 * The triage policy's mechanisms — sender rows, the two structural rules and the held-out delegates — each applied
 * only when the install's policy declares it, and the groups a sender row must never cover. The code ships no policy,
 * so every row and rule here is a synthetic install's.
 *
 * Every message is synthetic: mail content never enters a fixture. A vendor's `accounts@` mail carries no list header
 * and no no-reply local part, so the synthetic install row's fixtures hold that shape as not automated at all.
 *
 * The shipped sender list's and the two shipped anchors' own cases went with them.
 * deleted-with-code: GENERIC_TRIAGE_ARCHIVE_RULES, LAST_REPLY_OWNER_ANCHOR, PASSED_INVITE_ANCHOR
 */
import { describe, expect, it } from "vitest";

import type { GmailMessage } from "../../../../live/gmail/parse.js";
import { buildGmailTriage, type GmailTriageDocument } from "../../../../live/gmail/triage.js";
import { pinnedStillInInbox, ruledTriageIds } from "../../../../live/gmail/triageActs.js";
import { renderGmailTriageText } from "../../../../live/gmail/triageRender.js";
import {
  EMPTY_TRIAGE_POLICY,
  type GmailTriageArchiveRule,
  type GmailTriagePolicy,
  triageArchiveRuleFor,
} from "../../../../live/gmail/triageRules.js";
import { EVERY_LANE_POLICY, LAST_REPLY_ANCHOR, PASSED_INVITE_ANCHOR } from "./triage/harness.js";

const READ_AT = "2026-09-30T08:00:00.000Z";

/** One synthetic inbox message. */
function message({
  id,
  from,
  subject = "a subject",
  extra = [],
}: {
  id: string;
  from: string;
  subject?: string;
  extra?: readonly { name: string; value: string }[];
}): GmailMessage {
  return {
    id,
    internalDate: String(Date.parse(READ_AT)),
    labelIds: ["INBOX", "UNREAD"],
    payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, ...extra] },
    threadId: `t-${id}`,
  };
}

/** A synthetic tracker's notification row. */
const TRACKER_ROW = {
  anchor: "knowledge:l-0000000000000201",
  key: "from:notifications@tracker.example",
  kind: "from",
  sender: "Tracker",
  why: "the tracker's own inbox carries it",
} as const satisfies GmailTriageArchiveRule;

/** A synthetic pager's row. */
const PAGER_ROW = {
  anchor: "knowledge:l-0000000000000202",
  key: "from:no-reply@pager.example",
  kind: "from",
  sender: "Pager",
  why: "the page reaches the owner in chat",
} as const satisfies GmailTriageArchiveRule;

/** A synthetic CDN row the install narrowed to its certificate renewals by subject. */
const RENEWAL_ROW = {
  anchor: "knowledge:l-0000000000000203",
  key: "from:noreply@cdn.example",
  kind: "from",
  sender: "CDN certificate renewals",
  subjectIncludes: "to renew SSL certificates",
  why: "the certificate renews itself",
} as const satisfies GmailTriageArchiveRule;

/** The install's own relay row — synthetic, never a real group. */
const INSTALL_RELAY = {
  anchor: "knowledge:l-0000000000000204",
  key: "relay:alerts@acme.com:certvendor",
  kind: "relay",
  sender: "Certvendor alerts, via the alerts group",
  subjectIncludes: "Certificate issued for",
  why: "the platform team already gets them",
} as const satisfies GmailTriageArchiveRule;

/**
 * The install's own `from:` row for a vendor's account mail, which carries no list header and no no-reply local
 * part, so no heuristic reads it as automated — synthetic, never a real vendor.
 */
const INSTALL_FROM = {
  anchor: "knowledge:l-0000000000000205",
  key: "from:accounts@vaultvendor.example",
  kind: "from",
  sender: "Vaultvendor",
  why: "account recovery is another team's",
} as const satisfies GmailTriageArchiveRule;

/** Every lane on, carrying the given sender rows. */
function policyWith({ rules }: { rules: readonly GmailTriageArchiveRule[] }): GmailTriagePolicy {
  return { ...EVERY_LANE_POLICY, rules };
}

/** A reading of the given messages, the owner's account on their own domain, every lane on unless told otherwise. */
function reading({
  messages,
  account = "owner@example.test",
  repliedThreadIds = new Set<string>(),
  inviteFileIds = new Set<string>(),
  policy = EVERY_LANE_POLICY,
}: {
  messages: readonly GmailMessage[];
  account?: string;
  repliedThreadIds?: ReadonlySet<string>;
  inviteFileIds?: ReadonlySet<string>;
  policy?: GmailTriagePolicy;
}): GmailTriageDocument {
  return buildGmailTriage({
    account,
    complete: true,
    inboxEstimate: undefined,
    inviteFileIds,
    messages,
    policy,
    readAtIso: READ_AT,
    repliedThreadIds,
  });
}

/** The owner's account, on the same domain as the synthetic alerts group the install relay row names. */
const OWN_ACCOUNT = "owner@acme.com";

/**
 * A message as the alerts Google Group relays it: the group's own internal address, the group's list headers, and
 * the original sender only in the display name.
 */
function relayedAlert({
  id,
  subject,
  original = "'Certvendor'",
}: {
  id: string;
  subject: string;
  original?: string;
}): GmailMessage {
  const relayed = message({
    extra: [
      { name: "List-Id", value: "<alerts.acme.com>" },
      { name: "List-Post", value: "<mailto:alerts@acme.com>" },
    ],
    from: `"${original} via Alerts" <alerts@acme.com>`,
    id,
  });
  const headers = relayed.payload!.headers!.map((header) =>
    header.name === "Subject" ? { name: "Subject", value: subject } : header,
  );
  return { ...relayed, payload: { headers } };
}

/** The rule key each group of a reading carries, sorted by group key; `null` for an unruled group. */
function ruleKeys({ document }: { document: GmailTriageDocument }): readonly (readonly [string, string | null])[] {
  return document.groups
    .map((group) => [group.key, group.archiveRule === undefined ? null : group.archiveRule.key] as const)
    .toSorted(([left], [right]) => left.localeCompare(right));
}

describe("an install that declared nothing", () => {
  const PASSED = "Invitation: Pairing @ Mon 28 Sept 2026 3pm - 4pm (AEST) (Owner)";
  const document = reading({
    inviteFileIds: new Set(["invite"]),
    messages: [
      message({ from: "Tracker <notifications@tracker.example>", id: "tracker-1" }),
      message({ from: "Dana Vendor <dana@vendor.example>", id: "answered" }),
      message({ from: "Dana Vendor <dana@vendor.example>", id: "invite", subject: PASSED }),
      message({ from: "Gemini <gemini-notes@google.com>", id: "notes-1" }),
      message({ from: "Fathom <no-reply@fathom.video>", id: "recap-1" }),
    ],
    policy: EMPTY_TRIAGE_POLICY,
    repliedThreadIds: new Set(["t-answered"]),
  });

  it("rules nothing and holds nothing out: every message groups by sender and is carded", () => {
    expect(ruleKeys({ document })).toEqual([
      ["from:dana@vendor.example", null],
      ["from:gemini-notes@google.com", null],
      ["from:no-reply@fathom.video", null],
      ["from:notifications@tracker.example", null],
    ]);
    expect([document.replied, document.passedInvites, document.fathom, document.meetingNotes]).toEqual([
      [],
      [],
      [],
      [],
    ]);
    expect(ruledTriageIds({ document })).toEqual({ groups: [], ids: [] });
  });

  it("keeps the answered thread and the passed invite in their sender's group", () => {
    const dana = document.groups.find((group) => group.key === "from:dana@vendor.example")!;
    expect(dana.entries.map((entry) => entry.id).toSorted()).toEqual(["answered", "invite"]);
  });
});

describe("triageArchiveRuleFor", () => {
  const ALERT = "[alerts] Certificate issued for example.test";
  const rules = [TRACKER_ROW, INSTALL_RELAY];

  it("answers a from: row for a coverable group with its exact key, and nothing for one that is not coverable", () => {
    const tracker = TRACKER_ROW.key;
    expect(triageArchiveRuleFor({ coverable: true, key: tracker, rules, subjects: [] })!.sender).toBe("Tracker");
    expect(triageArchiveRuleFor({ coverable: false, key: tracker, rules, subjects: [] })).toBe(undefined);
    expect(
      triageArchiveRuleFor({ coverable: true, key: "from:NOTIFICATIONS@tracker.example", rules, subjects: [] }),
    ).toBe(undefined);
  });

  it("answers a relay row only when every subject carries its phrase, whatever coverable says", () => {
    const { key } = INSTALL_RELAY;
    expect(triageArchiveRuleFor({ coverable: false, key, rules, subjects: [ALERT, ALERT] })!.key).toBe(key);
    expect(triageArchiveRuleFor({ coverable: false, key, rules, subjects: [ALERT, "Your invoice is ready"] })).toBe(
      undefined,
    );
    expect(triageArchiveRuleFor({ coverable: false, key, rules, subjects: [ALERT, undefined] })).toBe(undefined);
    expect(triageArchiveRuleFor({ coverable: true, key, rules, subjects: [] })).toBe(undefined);
  });

  it("answers only the rows it is handed, so a row applies only once the policy was read", () => {
    const { key } = INSTALL_RELAY;
    expect(triageArchiveRuleFor({ coverable: false, key, rules: [TRACKER_ROW], subjects: [ALERT] })).toBe(undefined);
  });
});

describe("a triage reading under declared sender rows", () => {
  it("rules a declared vendor's notification mail", () => {
    const document = reading({
      messages: [
        message({ from: "Tracker <notifications@tracker.example>", id: "tracker-1" }),
        message({ from: "Tracker <notifications@tracker.example>", id: "tracker-2" }),
      ],
      policy: policyWith({ rules: [TRACKER_ROW] }),
    });
    expect(ruleKeys({ document })).toEqual([[TRACKER_ROW.key, TRACKER_ROW.key]]);
  });

  it("rules an install's declared vendor mail although no heuristic reads its address as automated", () => {
    const document = reading({
      messages: [
        message({ from: "Vaultvendor <accounts@vaultvendor.example>", id: "signin-1" }),
        message({ from: "Vaultvendor <accounts@vaultvendor.example>", id: "recovery-1" }),
      ],
      policy: policyWith({ rules: [INSTALL_FROM] }),
    });
    const group = document.groups[0]!;
    expect([group.key, group.automated, group.ruleable]).toEqual(["from:accounts@vaultvendor.example", false, false]);
    expect(group.archiveRule!.key).toBe("from:accounts@vaultvendor.example");
  });

  it("never rules a declared address the heuristic misses once one of its messages came through a discussion list", () => {
    const document = reading({
      messages: [
        message({ from: "Vaultvendor <accounts@vaultvendor.example>", id: "signin-1" }),
        message({
          extra: [{ name: "List-Post", value: "<mailto:it-help@example.org>" }],
          from: "Vaultvendor <accounts@vaultvendor.example>",
          id: "discussion",
        }),
      ],
      policy: policyWith({ rules: [INSTALL_FROM] }),
    });
    expect(ruleKeys({ document })).toEqual([["from:accounts@vaultvendor.example", null]]);
  });

  it("never rules another address at the same provider, a relay of it, or a ruled address on a discussion list", () => {
    const document = reading({
      messages: [
        message({ from: "Tracker <comments@tracker.example>", id: "other-address" }),
        message({ from: "'Tracker' via Dev Alerts <dev-alerts@example.org>", id: "relayed" }),
        message({
          extra: [
            { name: "List-Id", value: "<tracker-users.example.org>" },
            { name: "List-Post", value: "<mailto:tracker-users@example.org>" },
          ],
          from: "Tracker <notifications@tracker.example>",
          id: "discussion",
        }),
        message({ from: "Tracker <notifications@tracker.example>", id: "direct" }),
      ],
      policy: policyWith({ rules: [TRACKER_ROW] }),
    });
    // One `discussion` member makes the whole ruled-address group unruleable, so it is carded rather than archived.
    expect(ruleKeys({ document })).toEqual([
      ["from:comments@tracker.example", null],
      ["from:notifications@tracker.example", null],
      ["relay:dev-alerts@example.org:tracker", null],
    ]);
  });
});

describe("an install's relay row over a reading", () => {
  const ALERT = "[alerts] Certificate issued for staging.example.test";
  const policy = policyWith({ rules: [INSTALL_RELAY] });

  it("rules the relayed alerts, though the group is internal and a discussion list", () => {
    const document = reading({
      account: OWN_ACCOUNT,
      messages: [relayedAlert({ id: "cert-1", subject: ALERT }), relayedAlert({ id: "cert-2", subject: ALERT })],
      policy,
    });
    const group = document.groups[0]!;
    expect([group.key, group.ruleable, group.archiveRule!.key]).toEqual([INSTALL_RELAY.key, false, INSTALL_RELAY.key]);
    expect(ruledTriageIds({ document })).toEqual({
      groups: [
        {
          anchor: INSTALL_RELAY.anchor,
          ids: ["cert-1", "cert-2"],
          key: INSTALL_RELAY.key,
          sender: INSTALL_RELAY.sender,
        },
      ],
      ids: ["cert-1", "cert-2"],
    });
  });

  it("cards the same alerts when the install declared no row", () => {
    const document = reading({
      account: OWN_ACCOUNT,
      messages: [relayedAlert({ id: "cert-1", subject: ALERT })],
    });
    expect(ruleKeys({ document })).toEqual([[INSTALL_RELAY.key, null]]);
  });

  it("cards the whole group once one message through it is not a certificate alert", () => {
    const document = reading({
      account: OWN_ACCOUNT,
      messages: [
        relayedAlert({ id: "cert-1", subject: ALERT }),
        relayedAlert({ id: "billing", subject: "[alerts] Your Certvendor invoice" }),
      ],
      policy,
    });
    expect(ruleKeys({ document })).toEqual([[INSTALL_RELAY.key, null]]);
  });

  it("never rules a colleague posting to the same group, whose display name keys her own group", () => {
    const document = reading({
      account: OWN_ACCOUNT,
      messages: [relayedAlert({ id: "colleague", original: "Jane Doe", subject: ALERT })],
      policy,
    });
    expect(ruleKeys({ document })).toEqual([["relay:alerts@acme.com:jane doe", null]]);
  });
});

describe("a from: row narrowed by a subject phrase", () => {
  const CDN = "CDN <noreply@cdn.example>";
  const RENEWAL = "[Action required] Validate app.example.test to renew SSL certificates";
  const policy = policyWith({ rules: [RENEWAL_ROW] });

  it("rules the address's mail when every subject carries the phrase", () => {
    const document = reading({
      messages: [
        message({ from: CDN, id: "ssl-1", subject: RENEWAL }),
        message({ from: CDN, id: "ssl-2", subject: RENEWAL }),
      ],
      policy,
    });
    expect(ruleKeys({ document })).toEqual([[RENEWAL_ROW.key, RENEWAL_ROW.key]]);
    expect(ruledTriageIds({ document })).toEqual({
      groups: [
        { anchor: RENEWAL_ROW.anchor, ids: ["ssl-1", "ssl-2"], key: RENEWAL_ROW.key, sender: RENEWAL_ROW.sender },
      ],
      ids: ["ssl-1", "ssl-2"],
    });
  });

  it("cards the whole group once it holds other mail from the same address, which the install never ruled on", () => {
    const document = reading({
      messages: [
        message({ from: CDN, id: "ssl-1", subject: RENEWAL }),
        message({ from: CDN, id: "reset", subject: "Instructions for changing your password" }),
      ],
      policy,
    });
    expect(ruleKeys({ document })).toEqual([[RENEWAL_ROW.key, null]]);
  });

  it("answers the row only for a coverable group whose every subject carries the phrase", () => {
    const { key } = RENEWAL_ROW;
    const rules = [RENEWAL_ROW];
    expect(triageArchiveRuleFor({ coverable: true, key, rules, subjects: [RENEWAL] })!.key).toBe(key);
    expect(triageArchiveRuleFor({ coverable: false, key, rules, subjects: [RENEWAL] })).toBe(undefined);
    expect(triageArchiveRuleFor({ coverable: true, key, rules, subjects: [RENEWAL, undefined] })).toBe(undefined);
    expect(triageArchiveRuleFor({ coverable: true, key, rules, subjects: [] })).toBe(undefined);
  });
});

describe("an invite whose meeting has already happened, under a passed-invite rule", () => {
  const ORGANISER = "Dana Organiser <dana@vendor.example>";
  const PASSED = "Invitation: Pairing @ Mon 28 Sept 2026 3pm - 4pm (AEST) (Owner)";
  const COMING = "Updated invitation: Pairing @ Thu 1 Oct 2026 3pm - 4pm (AEST) (Owner)";

  it("is held out of its organiser's group one message at a time, and handed to --ruled under the rule's anchor", () => {
    const document = reading({
      inviteFileIds: new Set(["passed", "coming"]),
      messages: [
        message({ from: ORGANISER, id: "passed", subject: PASSED }),
        message({ from: ORGANISER, id: "coming", subject: COMING }),
        message({ from: ORGANISER, id: "question", subject: "Quick question about the contract" }),
      ],
    });
    expect(document.groups.map((group) => [group.key, group.entries.map((entry) => entry.id)])).toEqual([
      ["from:dana@vendor.example", ["coming", "question"]],
    ]);
    expect(document.passedInvites).toEqual([
      { id: "passed", overAfterIso: "2026-09-29T12:00:00.000Z", sender: "Dana Organiser", subject: PASSED },
    ]);
    expect(ruledTriageIds({ document })).toEqual({
      groups: [
        {
          anchor: PASSED_INVITE_ANCHOR,
          ids: ["passed"],
          key: "invite:passed",
          sender: "Dana Organiser's invite, its meeting passed",
        },
      ],
      ids: ["passed"],
    });
    expect(pinnedStillInInbox({ document, pinned: ["passed", "coming", "gone"] })).toEqual(["passed", "coming"]);
  });

  it("stays in its organiser's group when the install switched only last-reply on", () => {
    const document = reading({
      inviteFileIds: new Set(["passed"]),
      messages: [message({ from: ORGANISER, id: "passed", subject: PASSED })],
      policy: { ...EMPTY_TRIAGE_POLICY, structuralRules: [EVERY_LANE_POLICY.structuralRules[0]!] },
    });
    expect([document.passedInvites, ruleKeys({ document })]).toEqual([[], [["from:dana@vendor.example", null]]]);
  });

  it("is held out even from a colleague on the owner's own domain, and prints in the ruled section", () => {
    const document = reading({
      account: OWN_ACCOUNT,
      inviteFileIds: new Set(["passed"]),
      messages: [message({ from: "Seth Colleague <seth@acme.com>", id: "passed", subject: PASSED })],
    });
    expect([document.groups, document.passedInvites.map((invite) => invite.id)]).toEqual([[], ["passed"]]);
    expect(renderGmailTriageText({ carded: new Map(), document, only: undefined }).split("\n").slice(-1)).toEqual([
      `  1  Seth Colleague · key invite:passed · the meeting has passed: "${PASSED}"`,
    ]);
  });

  it("never takes a meeting-notes mail, which stays held for clear-meeting-notes", () => {
    const notes = message({ from: "Gemini <gemini-notes@google.com>", id: "notes-1", subject: PASSED });
    const document = reading({ inviteFileIds: new Set(["notes-1"]), messages: [notes] });
    expect([document.meetingNotes, document.passedInvites]).toEqual([["notes-1"], []]);
  });

  it("never takes a mail merely titled like an invite, which Gmail's invite-file search did not name", () => {
    const document = reading({
      inviteFileIds: new Set(["real"]),
      messages: [
        message({ from: ORGANISER, id: "lookalike", subject: PASSED }),
        message({ from: ORGANISER, id: "real", subject: PASSED }),
      ],
    });
    expect(document.passedInvites.map((invite) => invite.id)).toEqual(["real"]);
    expect(document.groups.map((group) => [group.key, group.entries.map((entry) => entry.id)])).toEqual([
      ["from:dana@vendor.example", ["lookalike"]],
    ]);
  });
});

describe("a thread the owner answered last, under a last-reply rule", () => {
  it("is held out of its sender's group, handed to --ruled under the rule's anchor, and still counted in the inbox", () => {
    const vendor = message({ from: "Dana Vendor <dana@vendor.example>", id: "vendor-1" });
    const other = message({ from: "Dana Vendor <dana@vendor.example>", id: "vendor-2" });
    const document = reading({ messages: [vendor, other], repliedThreadIds: new Set(["t-vendor-1"]) });
    expect(document.groups.map((group) => [group.key, group.entries.map((entry) => entry.id)])).toEqual([
      ["from:dana@vendor.example", ["vendor-2"]],
    ]);
    expect(document.replied).toEqual([{ ids: ["vendor-1"], sender: "Dana Vendor", threadId: "t-vendor-1" }]);
    expect(ruledTriageIds({ document })).toEqual({
      groups: [
        {
          anchor: LAST_REPLY_ANCHOR,
          ids: ["vendor-1"],
          key: "thread:t-vendor-1",
          sender: "Dana Vendor, answered last by the owner",
        },
      ],
      ids: ["vendor-1"],
    });
    expect(pinnedStillInInbox({ document, pinned: ["vendor-1", "vendor-2", "gone"] })).toEqual([
      "vendor-1",
      "vendor-2",
    ]);
  });

  it("stays in its sender's group when the install switched only passed-invite on", () => {
    const document = reading({
      messages: [message({ from: "Dana Vendor <dana@vendor.example>", id: "vendor-1" })],
      policy: { ...EMPTY_TRIAGE_POLICY, structuralRules: [EVERY_LANE_POLICY.structuralRules[1]!] },
      repliedThreadIds: new Set(["t-vendor-1"]),
    });
    expect([document.replied, ruleKeys({ document })]).toEqual([[], [["from:dana@vendor.example", null]]]);
  });

  it("never takes a meeting-notes mail, which stays held for clear-meeting-notes to prove its transcript first", () => {
    const notes = message({ from: "Gemini <gemini-notes@google.com>", id: "notes-1" });
    const document = reading({ messages: [notes], repliedThreadIds: new Set(["t-notes-1"]) });
    expect([document.meetingNotes, document.replied, ruledTriageIds({ document }).ids]).toEqual([["notes-1"], [], []]);
  });
});

describe("ruledTriageIds", () => {
  const document = reading({
    messages: [
      message({ from: "Tracker <notifications@tracker.example>", id: "tracker-1" }),
      message({ from: "Tracker <notifications@tracker.example>", id: "tracker-2" }),
      message({ from: "Pager <no-reply@pager.example>", id: "page-1" }),
      message({ from: "Jane Doe <jane@vendor.example>", id: "person-1" }),
    ],
    policy: policyWith({ rules: [TRACKER_ROW, PAGER_ROW] }),
  });

  it("hands over every ruled id, grouped by rule, and never a message no rule covers", () => {
    const ruled = ruledTriageIds({ document });
    expect(ruled.groups.map((group) => [group.key, group.ids])).toEqual([
      [TRACKER_ROW.key, ["tracker-1", "tracker-2"]],
      [PAGER_ROW.key, ["page-1"]],
    ]);
    expect(ruled.ids).toEqual(["tracker-1", "tracker-2", "page-1"]);
  });

  it("is empty over a reading no rule covers", () => {
    const unruled = reading({ messages: [message({ from: "Jane Doe <jane@vendor.example>", id: "person-1" })] });
    expect(ruledTriageIds({ document: unruled })).toEqual({ groups: [], ids: [] });
  });

  it("renders ruled groups apart from the card candidates, so a seat reading the text never cards one", () => {
    const lines = renderGmailTriageText({ carded: new Map(), document, only: undefined }).split("\n");
    const section = lines.indexOf(
      "archived under a standing rule, never carded — `gmail triage --ruled` prints their ids:",
    );
    expect(section).toBeGreaterThan(0);
    expect(
      lines.slice(0, section).filter((line) => [TRACKER_ROW, PAGER_ROW].some((rule) => line.includes(rule.key))),
    ).toEqual([]);
    expect(lines.slice(section + 1)).toEqual([
      `  2  Tracker <notifications@tracker.example> · key ${TRACKER_ROW.key} · ruled ${TRACKER_ROW.anchor}`,
      `  1  Pager <no-reply@pager.example> · key ${PAGER_ROW.key} · ruled ${PAGER_ROW.anchor}`,
    ]);
  });
});
