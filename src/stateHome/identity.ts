/**
 * The identity area of the state-home contract: who the owner is and who may reach the bot, the judgement profile, the
 * per-install deny and exclusion lists, the hygiene inputs, the secrets store and the cassette redactor's state.
 *
 * Part of the one `$SLOPWEAVER_HOME` contract tree, composed by `../stateHome.ts`, which is the only module that
 * imports it. A new path here is a field on {@link IdentityStateHomePaths} and a line in its resolver.
 */

import { join } from "node:path";

/** The identity area's fields of {@link ../stateHome.StateHomePaths}. */
export interface IdentityStateHomePaths {
  /**
   * `$home/capability-profile.json` — a private overlay of live-source capabilities (see
   * `route/profile.ts`), keyed by installation.
   *
   * Absent is the ordinary state for an installation that has not written one: `turn brief` then plans
   * from the generic table alone. Never seeded, never templated — same posture as `responders.json`, for
   * the same reason: a fabricated default would either invent a capability nobody built or silently claim
   * none exist, and both are worse than an installation writing the file by hand when it has something to
   * add.
   */
  readonly capabilityProfileJson: string;
  /**
   * `$home/judgement` — the private judgement/voice profile a live turn loads as configuration, and the
   * mining pass's own checkpoint marker. Owner-only (`0700`/`0600`), same treatment as `live/` and `queue/`,
   * for the same reason: the profile is mined from first-person material (voice dictation transcripts, a
   * prior bot's decision history) that nothing else may read.
   */
  readonly judgement: {
    readonly root: string;
    /** `$home/judgement/profile.json` — the derived `JudgementProfile` (see `live/turn/judgementProfile.ts`). */
    readonly profileJson: string;
    /**
     * `$home/judgement/owner-directives.json` — RETIRED: the legacy owner rulings file, read only by the store's
     * one-time import (`judgement/ownerDirectiveImport.ts`); the store's `owner_directive` table is the authority.
     */
    readonly ownerDirectivesJson: string;
    /** `$home/judgement/mining-cache.json` — the accepted mining pass's contract fingerprint. */
    readonly miningCacheJson: string;
    /** `$home/judgement/mining-brief.json` — the pinned brief `route profile-answer` validates against. */
    readonly miningBriefJson: string;
    /**
     * `$home/judgement/steer-kinds.jsonl` — the steer measurements' OLD journal, import-only: the store's
     * `steer_measurement` table is their authority, and this file is read once for that import and then only to
     * check it was not changed since.
     */
    readonly steerKindsJsonl: string;
    /**
     * `$home/judgement/standing-asks.jsonl` — the standing asks' OLD journal, import-only the same way: the store's
     * `standing_ask` tables are their authority.
     */
    readonly standingAsksJsonl: string;
    /**
     * `$home/judgement/data-class-rules.json` — this installation's own data-class sorting rules, read before the
     * owner-agnostic defaults (`store/dataClassRules.ts`). Absent means defaults only; malformed fails closed.
     */
    readonly dataClassRulesJson: string;
  };
  /** `$home/identity.json` — the RETIRED identity roster: a store with no row imports it once; never written. */
  readonly identityJson: string;
  /** `$home/profile.json` — the persona/profile seed (seeded from a template). */
  readonly profileJson: string;
  /**
   * `$home/profile/context.json` — the last-known-good copy of the always-loaded context.
   *
   * DERIVED, never an authority. Supabase is the one place a fact about the owner or a person changes; this is
   * a projection of it that survives the local stack being down, so a session start is mechanically
   * enforced rather than enforced on a good day. Written by every successful live read and emitted with
   * its own age stamped on it when the store cannot be reached — see `context/cache.ts` for why it is
   * bound to the database it was captured from.
   */
  readonly profileContextJson: string;
  /**
   * `$home/profile/loads.jsonl` — one row per attempted load of the owner's profile into a session: who, when, and
   * whether it arrived. Append-only. `profile hook` and `profile context` write it; the door's profile gate and the
   * `profile-unloaded` monitor read it beside each seat's boot records (`context/loadLedger.ts`).
   */
  readonly profileLoadsJsonl: string;
  /**
   * `$home/profile/delivered/` — one marker per context (a session, or a subagent of one) whose CURRENT context holds
   * the owner's profile, written only after the profile was printed into it and voided by a compaction past it, so a context
   * without one is held until its next guarded call delivers it (`context/profileDelivery.ts`).
   */
  readonly profileDeliveredDir: string;
  /**
   * `$home/profile/first-boot/` — one empty mark per session let through on a first boot, so the door holds that
   * session once the machine is configured and it has loaded nothing (`admit/firstBootSession.ts`).
   */
  readonly profileFirstBootDir: string;
  /**
   * `$home/profile/owner-written` — the fingerprints of every store `profile set` wrote the owner's row to: the local evidence
   * that the owner's profile exists, which a selected store is not (`admit/ownerProfileWritten.ts`).
   */
  readonly profileOwnerWritten: string;
  /**
   * `$home/responders.json` — WHO may command the bot: an explicit JSON array of Slack user ids.
   *
   * Never seeded, never templated, and never has an implicit fallback. Absent means every identity is
   * refused, including the owner's own — the one gate in this repository where "not configured yet" and
   * "configured closed" are the same state on purpose.
   */
  readonly respondersJson: string;
  /**
   * `$home/trusted-askers.json` — the TRUSTED TIER of the tag decision tree: an explicit JSON array of Slack
   * user ids whose unruled asks the bot investigates rather than waiting on the owner.
   *
   * Never seeded and never templated. Absent means nobody is on the tier — not a refusal, because the tier only
   * adds a licence; an unruled ask from anyone then waits on the owner (`live/listen/trustedTier.ts`).
   */
  readonly trustedAskersJson: string;
  /**
   * `$home/general-rulings.json` — the owner's GENERAL RULINGS, step (b) of the tag decision tree: a JSON array
   * of `{ kind, act, anchor }`, each a kind of ask the owner ruled the bot acts on with no wait.
   *
   * Per install and never in the repository, because a ruling is one owner's word about their own bot. Absent
   * means no rulings, so every ask falls through to the trusted tier or waits on the owner (`live/turn/generalRulings.ts`).
   */
  readonly generalRulingsJson: string;
  /**
   * `$home/hygiene-denylist.txt` — the private, uncommitted denylist the hygiene gate reads.
   *
   * OPTIONAL, and empty is the normal state. It holds literal SECRET strings no pattern in
   * {@link ../hygiene/scan} can express; it holds no NAME, because an internal
   * identifier is not a risk in this repository (`AGENTS.md` § "no secrets, ever").
   */
  readonly hygieneDenylist: string;
  /**
   * `$home/protected-paths.json` — the paths on this machine the owner protects from agent sessions, each
   * `read-only` or `no-access` (`../protectedPaths/registry.ts`). Off-repo because which paths a person protects
   * is theirs: the codebase carries the mechanism and names no path. OPTIONAL — absent protects nothing. Only
   * `slopweaver protect` writes it, and the `PreToolUse` guard holds the file itself read-only to every tool.
   */
  readonly protectedPathsJson: string;
  /**
   * `$home/push-roots.json` — the repositories whose history was re-cut, each bound to the ONE parentless commit
   * every push to it must descend from (`../admit/pushRootRegistry.ts`). Off-repo because which repository was
   * re-cut, and at which root, is this install's own fact. OPTIONAL — absent guards nothing; present but
   * unreadable refuses every guarded push. Only `slopweaver github push-root record` writes it, owner-only.
   */
  readonly pushRootsJson: string;
  /**
   * `$home/rulings.jsonl` — the owner's standing rulings by category, each in the owner's own words with its anchor,
   * its date and the rulings it replaced (`../ruling/registry.ts`). Append-only and written only by `slopweaver
   * ruling`, under its operation lock. Off-repo because the words are the owner's: nothing of it is committed, and it
   * is not an authored-home file, so the fleet import never copies it into the store. OPTIONAL — absent is no rulings.
   */
  readonly rulingsJsonl: string;
  /**
   * `$home/hygiene-replacements.tsv` — what each of the installation's own names BECOMES when `--redact` rewrites
   * a knowledge row (`../hygiene/replacementMap.ts`). Off-repo for the reason {@link referenceMap} is; absent is
   * normal, and the hashed rules still mask whatever a missing map did not rewrite.
   */
  readonly hygieneReplacementsTsv: string;
  /**
   * `$home/hygiene/reference-map.tsv` — the installation's own names, one regular expression per row with its
   * class, that `audit references` scans an exported tree for. Off-repo for the reason the hashed rules are
   * hashed: a list of the names a scan looks for is itself a list of those names.
   */
  readonly referenceMap: string;
  /**
   * `$home/hygiene/private-terms.tsv` — the private terms every outbound write is checked for
   * (`../hygiene/privateTerms.ts`), one regular expression per row with its class. Owner-only (`0600`) and never
   * committed, for the reason {@link referenceMap} is. Never seeded: absent refuses every guarded write.
   */
  readonly privateTerms: string;
  /**
   * `$home/hygiene/private-term-proposals/` — one `slopweaver private-terms` edit each, read back before it is
   * confirmed (`../hygiene/privateTermsStore.ts`). Owner-only, because a proposal holds the whole new file.
   */
  readonly privateTermProposals: string;
  /**
   * `$home/hygiene/private-term-reviews/` — the writes a private-term match holds, their review packets, the
   * receipts that release them and the marks that spend each receipt once (`../outbound/privateTermReview/`).
   * Owner-only, because a hold keeps the exact text it held.
   */
  readonly privateTermReviews: string;
  /**
   * `$home/hygiene/indirect-reference-map.tsv` — the candidate patterns `audit references --indirect` scans an
   * exported tree for, each with its class, disposition and proposed replacement. Off-repo for the reason
   * {@link referenceMap} is: some rows are the installation's own words.
   */
  readonly indirectReferenceMap: string;
  /**
   * `$home/hygiene/indirect-reference-report.json` — the last indirect scan's every candidate place, matched term
   * and excerpt included, written `0600`. Never printed and never committed: a matched term is what it looks for.
   */
  readonly indirectReferenceReport: string;
  /**
   * `$home/memory-gate-baseline.txt` — the auto-memory defects `memory gate` has been told to accept, one
   * key per line. Machine-local and uncommitted BY CONSTRUCTION: it records defects in this install's own
   * `~/.claude/projects/<project>/memory` corpora, which live outside git entirely, so committing it would make one
   * operator's memory defects a fact every other install inherits.
   *
   * OPTIONAL — absent means nothing is accepted, which is right for a fresh home and makes every finding
   * fresh. Only `memory gate --accept` adds to it, and every run narrows it to what still fires.
   */
  readonly memoryGateBaseline: string;
  /**
   * `$home/.git/hooks/pre-push` — where `memory gate --install` writes the loud recurring run.
   *
   * This is the STATE repository's own git hook directory rather than a directory this layout owns, and it
   * is named here for the one reason this file exists: it is a path derived from the home, and a second
   * module deriving it with its own `join` is how two callers drift onto two paths.
   */
  readonly statePrePushHook: string;
  /**
   * `$home/sync-author-denylist.txt` — who no ingest and no index may admit, and where. One entry per line:
   * a bare `<id>` denies that identity everywhere, `<id> @ <channel>` denies it in that channel only, and a
   * full-line `#` is a comment (a `#` mid-line is a channel NAME, never a comment).
   *
   * OPTIONAL, and absent means "exclude nothing", which is right for a fresh home. It lives off-repo for the
   * reason {@link orgDomains} does rather than the reason {@link hygieneDenylist} does: an entry is a Slack
   * author, bot or app id naming one workspace's own accounts, so it is per-install state and a committed
   * constant would be wrong for every other install — tools in the codebase, state outside it.
   * {@link ../corpus/syncExclusion} is the mechanism, and it names no id.
   *
   * SYNC only. Nothing under `src/live/` reads it, so a bot tagged into a thread still sees every message
   * every human in that thread sees. Scoped entries exist because a bare author ban took thousands of rows of the same app's alerts in a few dozen other channels.
   */
  readonly syncAuthorDenylist: string;
  /**
   * `$home/identity-exclusion.txt` — the names no indexed answer may present as a person. One whole name
   * per line, a full-line `#` is a comment; there is no scope and no field separator, because a name that
   * is not a person is not a person anywhere.
   *
   * OPTIONAL, and absent means "exclude nobody", which is right for a fresh home. It lives off-repo for the
   * reason {@link syncAuthorDenylist} does: one install's phantom names are meaningless to every other
   * install, so it is per-install state rather than a secret — tools in the codebase, state outside it.
   * {@link ../corpus/identityExclusion} is the mechanism, and it names nobody.
   *
   * INDEX only, like its sibling. Bronze keeps every name exactly as the provider sent it; what the list
   * changes is which of them an answer can be built out of.
   */
  readonly identityExclusion: string;
  /**
   * `$home/org-domains.txt` — the operator's own email domains, one per line, `#` comments allowed.
   *
   * OPTIONAL: {@link ../silver/orgDomains.resolveOrgDomains} infers the set from member bronze and only
   * needs this file when the inference cannot find a clear plurality. It lives off-repo because one install's
   * domains are wrong for every other install's — per-install state, not a secret — so the check has to be
   * able to run without the repository containing the words it checks for.
   */
  readonly orgDomains: string;
  /**
   * Local, uncommitted state for the integration-lane cassette redactor (RECORD time only; replay/CI never
   * read these). Both necessarily hold sensitive values, so they live under the home, never in the repo.
   */
  readonly cassetteRedaction: {
    /** `$home/cassette-id-map.json` — persistent real-id → synthetic `id_N` map (stable across re-records). */
    readonly idMap: string;
    /** `$home/cassette-known-values.txt` — pre-seeded known-sensitive literals (names/domains/ids) backstop. */
    readonly knownValues: string;
  };
  /** `$home/secrets` — per-source connector tokens (Slack/Linear/Notion); never committed or synced. */
  readonly secrets: string;
  /**
   * `$home/secrets/vanta-token` — one `<digest>.json` per Vanta Manage application, holding that
   * application's live access token and its expiry so a SECOND slopweaver process reuses it instead of
   * minting one, which Vanta answers by revoking the first (`atlas/vanta/tokenCache.ts`).
   *
   * `0700`/`0600`, the same treatment a stored secret gets, and named for a digest of the client id rather
   * than the id itself, so a directory listing names no application.
   */
  readonly vantaTokenDir: string;
  /**
   * `$home/store-lock` — `store lock`'s own state: one `pending-login-<stack>` per stack holding a minted login
   * password between its mint and its write into `secrets/store-url` (`0600`, inside a `0700` directory).
   */
  readonly storeLockDir: string;
  /** `$home/store-lock/backups` — one `<instant>/` per pre-lock backup, retained so a lock can always be undone. */
  readonly storeLockBackups: string;
}

/**
 * Resolve the `judgement` sub-tree.
 *
 * @param home the Slopweaver home
 * @returns the judgement sub-tree, rooted at `home`
 */
function judgementHomePaths({ home }: { home: string }): IdentityStateHomePaths["judgement"] {
  return {
    dataClassRulesJson: join(home, "judgement", "data-class-rules.json"),
    miningBriefJson: join(home, "judgement", "mining-brief.json"),
    miningCacheJson: join(home, "judgement", "mining-cache.json"),
    ownerDirectivesJson: join(home, "judgement", "owner-directives.json"),
    profileJson: join(home, "judgement", "profile.json"),
    root: join(home, "judgement"),
    standingAsksJsonl: join(home, "judgement", "standing-asks.jsonl"),
    steerKindsJsonl: join(home, "judgement", "steer-kinds.jsonl"),
  };
}

/**
 * The two files the cassette redactor keeps across re-records — the real-id → synthetic map and the
 * known-values list, lifted out of the literal below so the literal stays a flat list of one-line entries a
 * reader can scan.
 *
 * @param home the state home
 * @returns the id-map and known-values paths
 */
function cassetteRedactionPaths({ home }: { home: string }): Pick<IdentityStateHomePaths, "cassetteRedaction"> {
  return {
    cassetteRedaction: {
      idMap: join(home, "cassette-id-map.json"),
      knownValues: join(home, "cassette-known-values.txt"),
    },
  };
}

/**
 * Resolve the identity area under one home. Pure: no I/O.
 *
 * @param home the resolved Slopweaver home
 * @returns the identity area's fields, rooted at `home`
 */
export function identityStateHomePaths({ home }: { home: string }): IdentityStateHomePaths {
  return {
    capabilityProfileJson: join(home, "capability-profile.json"),
    ...cassetteRedactionPaths({ home }),
    hygieneDenylist: join(home, "hygiene-denylist.txt"),
    hygieneReplacementsTsv: join(home, "hygiene-replacements.tsv"),
    privateTerms: join(home, "hygiene", "private-terms.tsv"),
    privateTermProposals: join(home, "hygiene", "private-term-proposals"),
    privateTermReviews: join(home, "hygiene", "private-term-reviews"),
    referenceMap: join(home, "hygiene", "reference-map.tsv"),
    indirectReferenceMap: join(home, "hygiene", "indirect-reference-map.tsv"),
    indirectReferenceReport: join(home, "hygiene", "indirect-reference-report.json"),
    memoryGateBaseline: join(home, "memory-gate-baseline.txt"),
    statePrePushHook: join(home, ".git", "hooks", "pre-push"),
    syncAuthorDenylist: join(home, "sync-author-denylist.txt"),
    identityExclusion: join(home, "identity-exclusion.txt"),
    orgDomains: join(home, "org-domains.txt"),
    identityJson: join(home, "identity.json"),
    judgement: judgementHomePaths({ home }),
    profileJson: join(home, "profile.json"),
    protectedPathsJson: join(home, "protected-paths.json"),
    pushRootsJson: join(home, "push-roots.json"),
    rulingsJsonl: join(home, "rulings.jsonl"),
    profileContextJson: join(home, "profile", "context.json"),
    profileLoadsJsonl: join(home, "profile", "loads.jsonl"),
    profileDeliveredDir: join(home, "profile", "delivered"),
    profileFirstBootDir: join(home, "profile", "first-boot"),
    profileOwnerWritten: join(home, "profile", "owner-written"),
    respondersJson: join(home, "responders.json"),
    trustedAskersJson: join(home, "trusted-askers.json"),
    generalRulingsJson: join(home, "general-rulings.json"),
    secrets: join(home, "secrets"),
    storeLockBackups: join(home, "store-lock", "backups"),
    storeLockDir: join(home, "store-lock"),
    vantaTokenDir: join(home, "secrets", "vanta-token"),
  };
}
