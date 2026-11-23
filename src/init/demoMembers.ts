/**
 * The synthetic demo MEMBER rows `slopweaver seed --demo` writes beside the demo corpus — the identity substrate
 * the offline loop resolves the corpus authors against. The native ids they carry come from `./demoFixture.ts`,
 * whose records name the same accounts.
 *
 * Pure data — no clock, no IO.
 */
import type { MemberBronzeRow } from "../corpus/members/types.js";
import { LINEAR_DAVE_ID, LINEAR_TRACKER_SYNC_ID, SLACK_DEPLOY_BOT_ID } from "./demoFixture.js";

/** The fixed capture time the demo member rows carry (no clock — and excluded from the dedup fingerprint). */
const DEMO_FETCHED_AT = "2026-06-10T00:00:00.000Z";

/**
 * The synthetic demo MEMBER rows — the identity substrate that lets the PR4.8 account-kind rules really fire
 * offline: three real people on trusted `example.com` addresses, one Slack `profile.bot` account, and one
 * Linear app account on an integration email domain. A flat, static data literal.
 */
const DEMO_MEMBERS: readonly MemberBronzeRow[] = [
  {
    fetchedAtIso: DEMO_FETCHED_AT,
    identity: {
      email: "octo-dev@example.com",
      emailNormalised: "octo-dev@example.com",
      emailTrust: "trusted",
      handle: "octo-dev",
      name: "Octo Dev",
      nativeId: "octo-dev",
      source: "github",
    },
    profile: { active: true, bot: false },
    provenance: ["demo.fixture"],
    raw: { login: "octo-dev" },
    source: "github",
    sourceId: "octo-dev",
    version: 1,
    warnings: [],
  },
  {
    fetchedAtIso: DEMO_FETCHED_AT,
    identity: {
      email: "alice@example.com",
      emailNormalised: "alice@example.com",
      emailTrust: "trusted",
      handle: "alice",
      name: "alice",
      nativeId: "UALICE",
      source: "slack",
    },
    profile: { active: true, bot: false },
    provenance: ["demo.fixture"],
    raw: { id: "UALICE" },
    source: "slack",
    sourceId: "UALICE",
    version: 1,
    warnings: [],
  },
  {
    fetchedAtIso: DEMO_FETCHED_AT,
    identity: {
      email: "dave@example.com",
      emailNormalised: "dave@example.com",
      emailTrust: "trusted",
      handle: "dave",
      name: "dave",
      nativeId: LINEAR_DAVE_ID,
      source: "linear",
    },
    profile: { active: true, bot: false },
    provenance: ["demo.fixture"],
    raw: { id: LINEAR_DAVE_ID },
    source: "linear",
    sourceId: LINEAR_DAVE_ID,
    version: 1,
    warnings: [],
  },
  {
    fetchedAtIso: DEMO_FETCHED_AT,
    identity: {
      emailTrust: "missing",
      handle: "deploy-notifier",
      name: "Deploy Notifier",
      nativeId: SLACK_DEPLOY_BOT_ID,
      source: "slack",
    },
    profile: { active: true, bot: true },
    provenance: ["demo.fixture"],
    raw: { id: SLACK_DEPLOY_BOT_ID, is_bot: true },
    source: "slack",
    sourceId: SLACK_DEPLOY_BOT_ID,
    version: 1,
    warnings: [],
  },
  {
    fetchedAtIso: DEMO_FETCHED_AT,
    identity: {
      email: "tracker-sync@oauthapp.linear.app",
      emailNormalised: "tracker-sync@oauthapp.linear.app",
      emailTrust: "weak",
      name: "Tracker Sync",
      nativeId: LINEAR_TRACKER_SYNC_ID,
      source: "linear",
    },
    profile: { active: true, bot: false },
    provenance: ["demo.fixture"],
    raw: { id: LINEAR_TRACKER_SYNC_ID },
    source: "linear",
    sourceId: LINEAR_TRACKER_SYNC_ID,
    version: 1,
    warnings: [],
  },
];

/**
 * The bundled synthetic demo member rows ({@link DEMO_MEMBERS}) — the identity substrate for the offline loop.
 *
 * @returns the demo member rows, in a stable order
 */
export function demoMembers(): readonly MemberBronzeRow[] {
  return DEMO_MEMBERS;
}
