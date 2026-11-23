/**
 * Lazy manifest for the `identity` noun — read-only cross-source person resolution. `show` (also the bare
 * default) lists/filters canonical people; `resolve` maps a name, handle, email or id to the colleague it
 * names, from the member index; `narrow` prints that whole index as a brief a haiku sub-agent judges when
 * the exact lookup missed, and checks the key it picks; `org-domains` prints the email domains that check answers against. Each
 * loads only when dispatched. `avatars` prints every member's profile picture URL off member bronze, for the
 * work console's rows. `roster` is the one writer: `show` prints the human roster the store holds and its revision,
 * `replace` swaps it whole, pinned to that revision.
 */
import { IDENTITY_ROSTER_USAGE } from "../commands/identity/rosterUsage.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const showMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver identity show --json",
  parseRejectIsIoFree: true,
  summary: "Show every canonical person: their per-source ids + how each was linked",
  usage: "usage: slopweaver identity show [<handle|id>] [--home <dir>] [--corpus <dir>] [--json]",
} as const;

const resolveMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver identity resolve @ada",
  parseRejectIsIoFree: true,
  summary: "Resolve a name, handle, email or id to the colleague it names — never to a stranger",
  usage:
    "usage: slopweaver identity resolve <name|handle|email|id> [--corpus-scan] [--home <dir>] [--corpus <dir>] [--json]",
} as const;

const narrowMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: 'slopweaver identity narrow "Tobyn Barten" --question "what did they decide about the pool"',
  parseRejectIsIoFree: true,
  summary: "Print the whole member roster as a brief for a haiku sub-agent, and check the key it picks",
  // A hand-copied duplicate of `IDENTITY_NARROW_USAGE`, because this manifest is loaded EAGERLY and the
  // command module is not (area-cli.md § Metadata is eager). `manifestUsagePairs.test.ts` compares them.
  usage:
    "usage: slopweaver identity narrow <name|handle|email|id> [--question <text>] [--asked-by <who>] [--answer <reply>] [--home <dir>] [--json]",
} as const;

const avatarsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver identity avatars --source github --json",
  parseRejectIsIoFree: true,
  summary: "Print every member's profile picture URL, keyed by the platform's own id, off member bronze",
  // A hand-copied duplicate of `IDENTITY_AVATARS_USAGE`, for the reason `narrow` gives above.
  usage:
    "usage: slopweaver identity avatars [--source github|slack|linear|notion] [--ids <id,id>] [--home <dir>] [--json]",
} as const;

const orgDomainsMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver identity org-domains --json",
  parseRejectIsIoFree: true,
  summary: "Print the org's own email domains, and how they were settled",
  usage: "usage: slopweaver identity org-domains [--home <dir>] [--json]",
} as const;

const rosterMeta = {
  createsWorkItem: false,
  diagnostic: false,
  // The roster is this install's own row in its store; nothing here reaches a provider door.
  doorRouted: false,
  // A bare `identity roster` names no action, so it is refused before anything is read.
  dryParseSafe: true,
  // `replace` writes the store's roster row — install state, the way `gmail triage-rules --set` does.
  effect: "local-state",
  example: "slopweaver identity roster replace --file ./roster.json --expect-revision 3",
  parseRejectIsIoFree: true,
  summary: "Show the identity roster the store holds, or replace it whole, pinned to the revision read",
  usage: IDENTITY_ROSTER_USAGE,
} as const;

const loadShow = () => import("../commands/identity/run.js").then((m) => m.identityShowCommand);
const loadResolve = () => import("../commands/identity/run.js").then((m) => m.identityResolveCommand);
const loadOrgDomains = () => import("../commands/identity/run.js").then((m) => m.identityOrgDomainsCommand);
const loadAvatars = () => import("../commands/identity/run.js").then((m) => m.identityAvatarsCommand);
const loadNarrow = () => import("../commands/identity/run.js").then((m) => m.identityNarrowCommand);
const loadRoster = () => import("../commands/identity/run.js").then((m) => m.identityRosterCommand);

export const identityManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadShow, meta: showMeta }),
  avatars: lazy({ load: loadAvatars, meta: avatarsMeta }),
  narrow: lazy({ load: loadNarrow, meta: narrowMeta }),
  "org-domains": lazy({ load: loadOrgDomains, meta: orgDomainsMeta }),
  resolve: lazy({ load: loadResolve, meta: resolveMeta }),
  roster: lazy({ load: loadRoster, meta: rosterMeta }),
  show: lazy({ load: loadShow, meta: showMeta }),
};
