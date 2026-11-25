/**
 * The ONE typed contract for everything the agent persists under `$SLOPWEAVER_HOME`. Every module that
 * needs a path inside the home imports it from here — no other file derives a home sub-path with its own
 * `join(home, …)`. That single-source rule is what lets the belief store, ledgers, identity, profile, and
 * the medallion corpus grow without callers drifting into disagreeing layouts (a guard test enforces it).
 *
 * Zero-file-config is preserved: this only computes paths off `slopweaverHome()`; it reads nothing and
 * writes nothing. Scaffolding those paths is `stateInit`; reporting them is `doctor`.
 *
 * This file is the contract's ENTRY, and `./stateHome/` holds its areas: one module per area, each declaring its
 * fields' types beside the resolver that derives them, and nothing else in the tree. The entry declares
 * {@link StateHomePaths} as every area's fields plus the home's own markers and the atlas sub-tree, and
 * {@link stateHomePaths} spreads every area's resolver into one object. The areas are `corpus.ts` (the medallion
 * store), `live.ts` (provider-current reads and per-turn records), `workstreams.ts` (knowledge, readings, the
 * owner's workstreams and the console voice), `accounts.ts` (plans, quotas and model-account records), `sessions.ts` (the
 * supervisor's sessions, the board, grants, fleet, cmux and hand steps), `ledgers.ts` (`ledgers/`),
 * `identity.ts` (who the owner is, who may reach the bot, per-install lists, secrets), `evidence.ts` (proof, pages,
 * proposals, briefs, fan-outs) and `providers.ts` (what this install keeps about the providers it drives).
 *
 * A new path is a field and a resolver line in the area it belongs to; an area nearing 300 code lines splits
 * again inside `./stateHome/`. The guard (`src/__tests__/unit/stateHome.guard.test.ts`) admits a home-path join
 * in this file and that directory only, refuses a module there this entry does not compose, and refuses an import
 * of one from anywhere else — so a consumer reaches the layout through this file and nowhere else.
 *
 *   $SLOPWEAVER_HOME/
 *   ├── .home-version.json        # layout marker (STATE_HOME_VERSION) — for future migration
 *   ├── corpus/                   # the medallion store (bronze → silver → gold + caches)
 *   │   ├── bronze/  members/  directory/  structures/  history/  silver/  gold/  .cache/  .watermark.json
 *   │   ├── attachments/     # provider file BYTES, content-addressed (corpus/contentStore.ts)
 *   │   ├── bodies/          # parsed page BODIES, same store, same addressing
 *   │   └── .subset.json     # present only when this home is a time-bounded subset
 *   ├── knowledge/lessons.jsonl   # the RETIRED register — history, imported into the memories table
 *   ├── knowledge/domains.json    # retired: imported once into `knowledge_domain`
 *   ├── ledgers/                  # append-only run logs (dev-gate, correction ledger: PR12,
 *   │                             #   turn-completions.jsonl: every controlled turn's durable outcome;
 *   │                             #   baseline-bumps/: the write-once ratchet bump records;
 *   │                             #   value-samples/: one weekly value sample per ISO week, with its answers)
 *   ├── readings/index.jsonl      # the readings ledger — the last document each verb printed, and who took it
 *   ├── workstreams/register.json # RETIRED: a tombstone directory; the owner's outcomes live in the store's `workstream` tables
 *   ├── workstreams/candidates.json  reactions.jsonl  definitions.jsonl # mined candidates, the reaction to each, what done means
 *   │               titles.jsonl  proposals.jsonl  who-first.jsonl # the owner's titles and proposals, who they talk to first
 *   │               stated-candidates.json # the outcomes the owner stated, offered beside the mined ones
 *   ├── queue/withheld.jsonl      # replies the door held rather than sent, waiting for the owner
 *   ├── queue/slack-draft-media/<sha[0:2]>/<sha256> # a parked as-me draft's attachment BYTES, content-addressed
 *   ├── queue/card-deferrals.jsonl # every "Come back to it" press on a Queue card (see queueDefer/cardDeferralStore.ts)
 *   ├── sessions/sessions.jsonl   # the supervisor's session ledger (spawned/noted/closed)
 *   ├── sessions/supervisor-chain.jsonl # every session that has held the supervisor pin, in succession
 *   ├── sessions/recovery-scratch/<attempt>/ # the empty directory one `fleet recover` session runs in, removed after it
 *   ├── supervisor-scratch/<handoff>/ # a chair's scratch; its owner-turn-*.txt files are imported to owner_turn
 *   ├── handovers/archive/        # archived board docs, plus owner-turn-*.txt records (also into owner_turn)
 *   ├── identity.json             # RETIRED identity roster: imported into the store once, then inert
 *   ├── profile.json              # the persona/profile seed
 *   ├── profile/context.json      # last-known-good always-loaded context (derived, never edited)
 *   ├── profile/loads.jsonl       # every attempted load of the owner's profile into a session, and whether it arrived
 *   ├── responders.json           # WHO may tag the bot at all — an explicit list of Slack user ids
 *   ├── trusted-askers.json       # the tag decision tree's trusted tier — Slack user ids (absent = nobody)
 *   ├── general-rulings.json      # the tag decision tree's general rulings — {kind, act, anchor} (absent = none)
 *   ├── gmail-triage-rules.json   # RETIRED — imported once into the store's singleton_register, then read by nothing
 *   ├── capability-profile.json   # private overlay of live-source capabilities (optional)
 *   ├── judgement/owner-directives.json # RETIRED — imported once into the store's owner_directive/owner_correction, then read by nothing
 *   ├── hygiene-denylist.txt      # the private, uncommitted leak denylist
 *   ├── protected-paths.json      # paths the owner protects from sessions, read-only or no-access (`slopweaver protect`)
 *   ├── push-roots.json           # each re-cut repository's one permitted root (`slopweaver github push-root`)
 *   ├── rulings.jsonl             # the owner's standing rulings by category, in the owner's words, append-only (`slopweaver ruling`)
 *   ├── memory-gate-baseline.txt # `memory gate`'s accepted corpus defects — machine-local, only shrinks
 *   ├── .git/hooks/pre-push      # the hook `memory gate --install` writes (this repo's own hooks, not ours)
 *   ├── sync-author-denylist.txt  # `<id>` or `<id> @ <channel>` no ingest or index admits (live reads never see it)
 *   ├── org-domains.txt           # the org's own email domains (optional; inferred from members when absent)
 *   ├── live/events/stream.jsonl # the SUPERVISOR STREAM — every surface's state changes, append-only
 *   ├── live/events/cursors/     # one <name>.json per named stream reader (a byte offset)
 *   ├── live/listener/           # how the standing Slack listener is run and watched (pid, heartbeat, journal)
 *   ├── live/poll-gate/          # one <session-id>.json per session — when each log/pid/task was last polled
 *   ├── live/seat-pass/          # one <session-id> per seat the seat check passed: its pid and process start
 *   ├── live/sync-runs/<source>/ # one <start>-<runId>.jsonl per refresh run: started, progress, per-container commits, finished
 *   ├── live/console-sync-failures.jsonl # one row per failed refresh the console started, read by the console-sync-failed monitor
 *   ├── console-sync-failure-append-failures.jsonl # a failed refresh whose row that ledger refused, and why — outside live/
 *   ├── live/standing/respawn-pending.json  # a loop respawn booted but not yet confirmed by its successor's own arm
 *   ├── live/github/merge-hold.json  # which PR owns the merge queue, per repository (see outbound/github/mergeHold.ts)
 *   ├── live/github/hold-ledger.jsonl # append-only held/released/stale rows — how long each hold actually stood
 *   ├── live/gmail/attachments/   # one <message-id>/ per message: bytes `gmail attachment` fetched (PRIVATE, unredacted)
 *   ├── live/gmail/board-drafts/  # one <slug>.<digest>.json receipt per board mail drafted, and its .claim while one is made
 *   ├── live/gmail/card-mail/     # one <card-slug>.json per triage card: the pinned mail it draws (PRIVATE, unredacted)
 *   ├── live/gmail/triage.json    # the latest `gmail triage --write` reading: the owner's inbox grouped by sender
 *   ├── live/gmail/triage-cards/  # one <card-slug>.json per triage card: the exact ids it showed the owner
 *   ├── live/outlook/attachments/ # one <hashed-message-id>/ per message: bytes `outlook attachment` fetched (PRIVATE)
 *   ├── live/fathom/              # the browser relay's scratch for `fathom share` page reads
 *   ├── live/hygiene/             # the daily hygiene documents the standing rows replace whole
 *   ├── live/slack/thread-files/  # attachments fetched by `slack read-thread` (PRIVATE, unredacted)
 *   ├── live/slack/channel-media/ # thumbnails `slack channel-view` fetched, content-addressed (PRIVATE, unredacted)
 *   ├── live/slack/asks.jsonl     # append-only ask-lifecycle events, keyed by (channel, messageTs)
 *   ├── live/slack/supersessions.jsonl # every correction-turn delete of the answer it superseded
 *   ├── live/slack/ignored-asks.jsonl  # the permanent ignore registry, same key
 *   ├── live/slack/owed.json      # the latest `slack owed --write` snapshot of followed threads owed a reply
 *   ├── live/slack/awaiting.json  # the latest `slack awaiting --write` worklist of threads quiet on the owner's ask
 *   ├── live/slack/finding-followups.json # the latest `slack finding-followups --write` shared findings owed a card
 *   ├── live/slack/burst-queue.jsonl   # append-only rapid-tag-burst queue, FIFO per burst target
 *   ├── live/slack/dispatches/    # one fresh-visible-session dispatch record per (channel, messageTs)
 *   ├── live/slack/turn-markers/  # durable TURN_READY/TURN_FAILED completion signal, same keying
 *   ├── live/slack/worker-sessions/ # the worker's own "which visible session am I", same keying
 *   ├── live/slack/reviews/       # one reviewer locator + code-built packet + verdict path per ask, same keying
 *   ├── live/slack/progress/     # one append-only progress log per ask — stages + every card write
 *   ├── live/slack/turn-journal/ # one append-only journal per ask — every edit to a reviewed answer, and why
 *   ├── live/slack/checkpoints/  # one dir per ask — every validated DRAFT, ordered by its own log.jsonl
 *   └── live/slack/detectives/   # one dir per ask — every detective wave `--ask` planned: briefs, reports, wave.json
 */

import { join } from "node:path";

import { atlasHomePaths } from "./atlasHome.js";
import { slopweaverHome } from "./homeDir.js";
import { type AccountsStateHomePaths, accountsStateHomePaths } from "./stateHome/accounts.js";
import { type CorpusStateHomePaths, corpusStateHomePaths } from "./stateHome/corpus.js";
import { type EvidenceStateHomePaths, evidenceStateHomePaths } from "./stateHome/evidence.js";
import { type IdentityStateHomePaths, identityStateHomePaths } from "./stateHome/identity.js";
import { type LedgersStateHomePaths, ledgersStateHomePaths } from "./stateHome/ledgers.js";
import { type LiveStateHomePaths, liveStateHomePaths } from "./stateHome/live.js";
import { type ProvidersStateHomePaths, providersStateHomePaths } from "./stateHome/providers.js";
import { type SessionsStateHomePaths, sessionsStateHomePaths } from "./stateHome/sessions.js";
import { type WorkstreamsStateHomePaths, workstreamsStateHomePaths } from "./stateHome/workstreams.js";

/** The on-disk layout version. Bump only with a migration; init stamps it, doctor reports it. */
export const STATE_HOME_VERSION = 1;

/**
 * One provider atlas's on-disk generation: a manifest, one file per kind, a companion directory for values
 * withheld from the committed kind files, and where a reset archives the prior generation to. Shared shape
 * across every atlas under `$home/atlas/<platform>` — Vanta is the first tenant.
 */
export interface AtlasPlatformPaths {
  /** `$home/atlas/<platform>` — this platform's atlas root. */
  readonly root: string;
  /** `$home/atlas/<platform>/manifest.json` — the publication authority (written last). */
  readonly manifest: string;
  /** One file per kind this atlas tracks, keyed by kind name. */
  readonly kinds: Readonly<Record<string, string>>;
  /** `$home/atlas/<platform>/_sensitive` — gitignored-equivalent companions for withheld values. */
  readonly sensitive: string;
  /** `$home/atlas/_superseded/<platform>` — where `reset` archives the prior generation. */
  readonly superseded: string;
}

/** Every absolute path the agent persists under one `$SLOPWEAVER_HOME`. The single home-path contract. */
export interface StateHomePaths
  extends
    AccountsStateHomePaths,
    CorpusStateHomePaths,
    EvidenceStateHomePaths,
    IdentityStateHomePaths,
    LedgersStateHomePaths,
    LiveStateHomePaths,
    ProvidersStateHomePaths,
    SessionsStateHomePaths,
    WorkstreamsStateHomePaths {
  /** The resolved home root itself. */
  readonly root: string;
  /** `$home/.home-version.json` — the layout-version marker. */
  readonly homeVersion: string;
  /**
   * `$home/console-sync-failure-append-failures.jsonl` — a failed console refresh whose row
   * `live/console-sync-failures.jsonl` refused, with the error it refused with. At the home root, not under `live/`,
   * so a `live/` the console cannot write to does not lose this row too. Read by the `console-sync-failed` monitor.
   */
  readonly consoleSyncFailureAppendFailuresJsonl: string;
  /**
   * `$home/docs-site` — where the console's run records and hold directories lived before they moved under the
   * cache root (`src/cacheHome.ts`). Nothing writes here. `readCallLeases` still lists it, because a console started
   * before the move keeps writing its call lease here until `scripts/docs-site.sh` migrates it, and reading a live
   * lease as absent is the one mistake that ends a call.
   */
  readonly homeDocsSite: string;
  /**
   * `$home/exec-store` — where the content-addressed native-binary store lived before it moved under the cache
   * root (`src/cacheHome.ts`). Nothing writes here. `doctor` still reads it, because a checkout `worktree unshare`
   * privatised before the move stays hardlinked to it, and calling that checkout shared would be a false alarm.
   */
  readonly homeExecStore: string;
  /**
   * `$home/atlas` — local ground-truth maps of what a platform CONTAINS, one sub-tree per platform. Vanta
   * (`src/atlas/vanta`) is the first tenant; a future platform adds a sibling key here, never a new home
   * contract.
   */
  readonly atlas: {
    readonly root: string;
    readonly aether: AtlasPlatformPaths;
    readonly linear: AtlasPlatformPaths;
    readonly vanta: AtlasPlatformPaths;
    readonly workos: AtlasPlatformPaths;
    readonly braze: AtlasPlatformPaths;
    readonly clerk: AtlasPlatformPaths;
    readonly cloudflare: AtlasPlatformPaths;
    readonly onepassword: AtlasPlatformPaths;
    readonly slack: AtlasPlatformPaths;
    readonly crowdstrike: AtlasPlatformPaths;
    readonly github: AtlasPlatformPaths;
    readonly googleAdmin: AtlasPlatformPaths;
    readonly googleSecops: AtlasPlatformPaths;
    readonly jumpcloud: AtlasPlatformPaths;
    readonly jam: AtlasPlatformPaths;
    readonly knowbe4: AtlasPlatformPaths;
    readonly xero: AtlasPlatformPaths;
    readonly airtable: AtlasPlatformPaths;
    readonly canva: AtlasPlatformPaths;
    readonly notion: AtlasPlatformPaths;
    readonly nxCloud: AtlasPlatformPaths;
    readonly datadog: AtlasPlatformPaths;
    readonly figma: AtlasPlatformPaths;
    readonly trelica: AtlasPlatformPaths;
    readonly twilio: AtlasPlatformPaths;
    readonly hex: AtlasPlatformPaths;
    readonly graphqlHive: AtlasPlatformPaths;
    readonly microsoft365: AtlasPlatformPaths;
    readonly nightfall: AtlasPlatformPaths;
    readonly geminiAiStudio: AtlasPlatformPaths;
    readonly knock: AtlasPlatformPaths;
    readonly prismaDataPlatform: AtlasPlatformPaths;
    readonly inngest: AtlasPlatformPaths;
    readonly make: AtlasPlatformPaths;
  };
}

/**
 * Resolve every persisted path under the home. Pure: no I/O, deterministic given `home`. All returned
 * paths are absolute descendants of the resolved home, so the whole layout moves with `$SLOPWEAVER_HOME`.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the full typed path contract rooted at `home`
 */
export function stateHomePaths({ home = slopweaverHome() }: { home?: string } = {}): StateHomePaths {
  return {
    ...accountsStateHomePaths({ home }),
    atlas: atlasHomePaths({ atlasRoot: join(home, "atlas") }),
    consoleSyncFailureAppendFailuresJsonl: join(home, "console-sync-failure-append-failures.jsonl"),
    ...corpusStateHomePaths({ home }),
    ...evidenceStateHomePaths({ home }),
    homeDocsSite: join(home, "docs-site"),
    homeExecStore: join(home, "exec-store"),
    homeVersion: join(home, ".home-version.json"),
    ...identityStateHomePaths({ home }),
    ...ledgersStateHomePaths({ home }),
    ...liveStateHomePaths({ home }),
    ...providersStateHomePaths({ home }),
    root: home,
    ...sessionsStateHomePaths({ home }),
    ...workstreamsStateHomePaths({ home }),
  };
}

/**
 * The path of a named secret file under `$home/secrets` (e.g. `slack-user-token`). The single place a
 * connector-token path is derived, so the home-path contract stays intact.
 *
 * @param name the secret filename (no directory)
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the absolute secret file path
 */
export function secretFilePath({ name, home = slopweaverHome() }: { name: string; home?: string }): string {
  return join(stateHomePaths({ home }).secrets, name);
}

/**
 * A path inside the home named by its home-relative form, as a backup carries it. The single place a relative
 * path read out of a backup is joined onto a home, so the home-path contract stays intact.
 *
 * @param relativePath the path under the home, as the backup recorded it
 * @returns the absolute path in the home
 */
export function homeRelativePath({ home, relativePath }: { home: string; relativePath: string }): string {
  return join(home, relativePath);
}
