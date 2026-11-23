/**
 * The constant world the `slopweaver slack draft` cases share: the drip configuration, the mention resolution and
 * the two Slack members a draft names.
 */
import type { DripConfig } from "../../../../../../cli/commands/slack/wiring.js";
import { buildMemberIdentity } from "../../../../../../corpus/members/email.js";
import type { MemberBronzeRow } from "../../../../../../corpus/members/types.js";
import type { MentionResolution } from "../../../../../../outbound/slack/mentionIndex.js";

/** The drip configuration every case reads unless it seeds another. */
export const CONFIG: DripConfig = {
  cardVisibleMax: 1000,
  exactVoiceRules: [],
  intervalMs: 0,
  maxBullets: 10,
  maxLines: 8,
  maxMessages: 8,
  messageVisibleMax: 300,
  paragraphSpacing: false,
  soleMessageVisibleMax: 1000,
};

/** The owner's exact rules banning the em dash, the one character a console call once put in their words. */
export const EM_DASH_RULED: DripConfig = { ...CONFIG, exactVoiceRules: [{ kind: "literal", value: "—" }] };

/** What mention resolution answers for a form unless a case seeds another: one person and one group. */
export const RESOLUTION: MentionResolution = {
  groupAddresses: new Map([
    [
      "@security",
      {
        group: { deleted: false, handle: "security", id: "S0SEC", memberIds: ["U0SYNADAOWN"], name: "Security" },
        handle: "security",
        kind: "addressable" as const,
      },
    ],
  ]),
  heldRequested: [],
  memberLookups: new Map(),
  resolved: new Map([["ada", { origin: "member" as const, slackId: "U0SYNADAOWN" }]]),
  roster: { addressableKeys: 3, collisions: [], derivedPeople: 2, freshness: { kind: "fresh" }, heldPeople: 0 },
};

/** One Slack member bronze row, so `--json` has a name to put beside the author's id. */
export const OWNER_ROW: MemberBronzeRow = {
  fetchedAtIso: "2026-09-01T00:00:00.000Z",
  identity: buildMemberIdentity({ handle: "ada", name: "Ada Owner", nativeId: "U0SYNADAOWN", source: "slack" }),
  profile: {},
  provenance: [],
  raw: {},
  source: "slack",
  sourceId: "U0SYNADAOWN",
  version: 1,
  warnings: [],
};

/** A colleague the untagged-name hold judges prose against. */
export const JONAH_ROW: MemberBronzeRow = {
  ...OWNER_ROW,
  identity: buildMemberIdentity({ handle: "jonah", name: "Jonah Smith", nativeId: "U0JONAH", source: "slack" }),
  sourceId: "U0JONAH",
};
