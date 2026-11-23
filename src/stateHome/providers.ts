/**
 * The provider state area of the state-home contract: what this install keeps about the providers and processes it
 * drives — Datadog, Vanta, calendar, incidents, org health, spend, the landing lane, the queue, worktree pruning,
 * the browser record and the board's projections.
 *
 * Part of the one `$SLOPWEAVER_HOME` contract tree, composed by `../stateHome.ts`, which is the only module that
 * imports it. A new path here is a field on {@link ProvidersStateHomePaths} and a line in its resolver.
 */

import { join } from "node:path";

/**
 * Where one Datadog shape-catalogue build lands: a manifest, and the shape rows beside it.
 *
 * Two files rather than one, and the split is the `whole-file-json` rule rather than a preference. The
 * manifest is one bounded document whose size comes from the ORGANISATION — dozens of catalog entities,
 * hundreds of monitors, dozens of dashboards — so JSON is right for it. The shapes are a record STREAM whose size comes from
 * the data, so they are `.jsonl` and are read a line at a time.
 *
 * @internal
 */
export interface DatadogCataloguePaths {
  /** `$home/datadog/catalogue` — this install's catalogue root. */
  readonly root: string;
  /** `$home/datadog/catalogue/manifest.json` — the map, the services, the window and the stated residue. */
  readonly manifest: string;
  /** `$home/datadog/catalogue/rows.jsonl` — one census row per line, across every product. */
  readonly rows: string;
}

/** The provider state area's fields of {@link ../stateHome.StateHomePaths}. */
export interface ProvidersStateHomePaths {
  /** `$home/incidents` — what live-incident detection keeps between sweeps. */
  readonly incidents: string;
  /**
   * `$home/incidents/seen.jsonl` — one row per incident channel whose board row exists, so a sweep registers each
   * channel once however many sweeps see it inside its live window. Append-only.
   */
  readonly incidentsSeenJsonl: string;
  /**
   * `$home/queue` — the withheld-reply queue: drafts the door judged and did not send, waiting for the owner.
   *
   * A SIBLING of `ledgers/` rather than a file inside it, and the distinction is the point. A ledger is an
   * audit trail — write once, read to answer "what happened". This is a WORK QUEUE: it is meant to be drained,
   * each entry carries the draft itself, and an entry's state changes as somebody acts on it. Putting it under
   * `ledgers/` would invite a reader to treat a promise to a colleague as a log line.
   */
  readonly queue: string;
  /**
   * `$home/queue/slack-draft-media` — the exact bytes a parked as-me draft attaches, content-addressed by
   * SHA-256 and sharded two characters deep (`../admit/slackDraftMediaStore.ts`). Owner-only, beside the
   * register whose rows name them: an unsent attachment is as private as the unsent message it rides under.
   */
  readonly slackDraftMedia: string;
  /**
   * `$home/ruling-gates.json` — the standing ruling gates, projected out of `runs/` so the CLI dispatch
   * boundary can read them on every verb.
   *
   * A PROJECTION, never the register: the `ruling` events in `runs/*.jsonl` own the owner's word, and
   * `src/handover/rulingGateIndex.ts` carries the measurement that made a second read path necessary — the
   * journals cost 728 ms to walk and the board 6.4 seconds, against 4.1 s for the whole CLI start.
   */
  readonly rulingGatesJson: string;
  /**
   * `$home/alignment-board.json` — every board row's PLACEMENT fields, projected out of the board so the
   * console's Alignment count need not wait on the whole `handover list --json` document.
   *
   * A PROJECTION, never the register, exactly as {@link StateHomePaths.rulingGatesJson} is: the docs and
   * `runs/` own every fact in it, `handover list` rewrites it on a whole default-board composition, and
   * `handover alignment-board` rebuilds it from the board when it is missing or will not read
   * (`src/handover/alignmentBoardProjection.ts`).
   */
  readonly alignmentBoardJson: string;
  /**
   * `$home/worktree-bundles` — `worktree prune`'s own state: the salvage ledger, the scan cursors and the apply
   * memory, beside the per-repository `<branch>.bundle` files an earlier `unpushed` class wrote.
   *
   * Outside the repository on purpose: state that lived in the trees being pruned would be deleted by the same
   * disk pressure that runs the prune.
   */
  readonly worktreeBundles: string;
  /**
   * `$home/worktree-bundles/auto-trigger` — one marker file per window in which an unasked prune was launched
   * (`src/worktree/pruneTrigger.ts`), so a burst of disk reads or tool calls launches one, not one each.
   */
  readonly worktreePruneTriggerDir: string;
  /**
   * `$home/worktree-bundles/auto-prune.log` — what each unasked prune printed, headed by its cause and the free
   * disk it was launched at. The only record of a threshold launch, which bypasses the slot ledger by design.
   */
  readonly worktreePruneTriggerLog: string;
  /**
   * `$home/slices` — one `<name>.json` pin per named slice.
   *
   * Beside `runs/` rather than inside the corpus, because a slice manifest is a MEASUREMENT of the corpus
   * rather than part of it: putting it under `corpus/` would make the thing being measured contain its own
   * baseline, and a rebuild that wiped the corpus would take the evidence with it.
   */
  readonly slices: string;
  /**
   * `$home/calendar/intents` — one `<intent-id>.json` per prepared calendar write.
   *
   * The handoff between `calendar book`/`edit`/`reschedule`/`cancel`/`respond` and the `calendar commit`
   * that sends it: the preview persists the exact form and the snapshot it was planned against, so the
   * commit rebuilds the digest from what was READ rather than from what a caller repeats back. Under the
   * home for the same reason `briefs` is — the gap between the two is the owner reading a preview and
   * deciding, which is human-length, and this is the file to open when an approval will not match.
   */
  readonly calendarIntents: string;
  /**
   * `$home/datadog/catalogue` — the Datadog shape catalogue: what a log, span, session and error from each
   * service looks like, plus the service map, plus the per-service volumes the aggregate returned.
   *
   * Under the home rather than in the repository because it is one INSTALL's observation of one
   * organisation, and because it is rebuilt on a schedule: a committed copy would be stale on the day it
   * landed and would put service names in the tree, which "Tools in the codebase, state outside it" puts
   * outside it on purpose.
   *
   * Its own root rather than a corner of the atlas, because the atlas holds what Datadog's API DECLARES and
   * this holds what this organisation's telemetry actually looks like — a filled atlas would still say
   * nothing about `[sessionTypeForBooking]`.
   */
  readonly datadogCatalogue: DatadogCataloguePaths;
  /**
   * `$home/datadog/hits.jsonl` — every Datadog event this install has already pulled down, whole.
   *
   * It exists because Datadog has **no get-by-id route**. MEASURED:
   * `slopweaver datadog raw --path /api/v2/logs/events/<a real id from the list route>` returns HTTP 404
   * `{"errors":["Not found"]}`, and the search endpoints cannot filter on an event id either. So a
   * `dd:`-addressed record cannot be re-fetched the way a store row can, and the progressive-disclosure
   * ladder — `hits` narrows, `peek` windows, `open` reads whole — needs the event to still be there when the
   * next verb runs, in a different process.
   *
   * A cache of what was ALREADY read rather than a store of Datadog: nothing writes here that a verb did not
   * just fetch on the caller's own instruction, and a `peek` on an id nobody fetched says so rather than
   * inventing one.
   */
  readonly datadogHits: string;
  /**
   * `$home/vanta/changes` — one file per Vanta atlas sync, holding what that sync changed against the
   * generation it replaced. Outside `atlas/vanta/` because a publish replaces that directory whole.
   */
  readonly vantaChanges: string;
  /** `$home/vanta/changes-read.json` — the latest change file a visible session has judged. */
  readonly vantaChangesCursorJson: string;
  /** Retrieval bake-off runs: one directory per run id, holding its manifest, briefs, replies and report. */
  readonly bakeoff: string;
  /** `$home/perf/console` — `slopweaver perf console` walks, one directory per run instant, each a report.json and report.md. */
  readonly perfConsole: string;
  /**
   * `$home/backups/store` — where `store backup` stages one directory per backup (dump, storage tar,
   * manifest, upload receipt) and `last.json`, the most recent attempt's outcome. See `src/store/backup/run.ts`.
   */
  readonly storeBackups: string;
  /**
   * `$home/org-health/incidents.json` — IMPORT-ONLY, never the authority: the incident snapshot a checkout before the
   * store wrote. The `org_health_incident` row is the authority (`../orgHealth/storePort.ts`); this file is read once,
   * while no row exists, and never written.
   */
  readonly orgHealthIncidentsJson: string;
  /**
   * `$home/org-health/sightings.json` — IMPORT-ONLY: the sightings memory a checkout before the store wrote. Read
   * once, into `org_health_sighting`, and never written.
   */
  readonly orgHealthSightingsJson: string;
  /**
   * `$home/org-health/acknowledgements.jsonl` — IMPORT-ONLY: the acknowledgement ledger a checkout before the store
   * appended. Read once, into `org_health_acknowledgement` under its `legacy-v1` marker, and never written.
   */
  readonly orgHealthAcknowledgementsJsonl: string;
  /**
   * `$home/browser.json` — the RETIRED record of which of the owner's OWN Chrome profiles every browser leg uses.
   *
   * The store's `browser-profile` row is the record now (`../browser/recordedProfile.ts`), written by
   * `slopweaver browser profile --set`; a read finding no row imports this file ONCE, and from then on nothing
   * reads it. The record exists because nothing in this repository may name the profile: the owner's real work Chrome is the only browser anything here drives (`docs/browser-route.md`).
   *
   * Not a credential: it holds a directory name (`Default`, `Profile 1`) and nothing else. The session it
   * points at lives in Chrome's own profile, which this home never copies.
   */
  readonly browserJson: string;
  /**
   * `$home/chrome-pin.sh` — the shim every Playwright connect page is launched through, so it opens in the
   * recorded work profile rather than in whichever profile Chrome was last used in.
   *
   * Generated rather than authored, `0700`, and rewritten from the recorded profile on every attach: a stale pin
   * would keep steering at a profile the owner has since moved off. `src/browser/profilePin.ts` carries the
   * measurement behind it.
   */
  readonly chromePin: string;
  /**
   * `$home/gmail-triage-rules.json` — the RETIRED copy of this install's own declared `gmail triage` archive rows,
   * `{ schemaVersion: 1, rules }`. The store's `gmail-triage-rules` row holds them now (`live/gmail/triageRuleStore.ts`);
   * a read finding no row imports this file ONCE, and from then on nothing reads it.
   */
  readonly gmailTriageRulesJson: string;
  /**
   * `$home/linear-retired-teams.json` — the Linear teams this install no longer files into, refused at the
   * issue and project write verbs (`src/outbound/linear/retiredTeams.ts`). Absent retires nothing.
   */
  readonly linearRetiredTeamsJson: string;
  /**
   * `$home/spend/cards` — one directory per company card (`airwallex-<last4>/`), one snapshot file per
   * pasted card-page export, named for the day it was captured (`spend/store.ts`). Owner-only: a snapshot is
   * the organisation's own card spend.
   */
  readonly spendCards: string;
  /**
   * `$home/spend/capture` — the scratch a live `spend capture` visit of the owner's card page runs the browser relay
   * in (`atlas/kit/walkTransport.ts` makes `_walk` beneath it). Nothing here is a record; the snapshot lands
   * in {@link StateHomePaths.spendCards}.
   */
  readonly spendCapture: string;
  /**
   * `$home/spend/forwards` — one claim per receipt `spend forward` drafted to Airwallex's receipts address, named
   * for the receipt's Gmail message id, holding the pid while Gmail is called and the draft id once it is stored
   * (`cli/commands/spend/forwardClaim.ts`). What stops a daily run drafting the same receipt twice.
   */
  readonly spendForwards: string;
  /**
   * `$home/landing-coderabbit-nudges/` — one claim file per stuck CodeRabbit review `github landing --press`
   * re-requested, named for its pull request and head and created exclusively, so one head is re-requested
   * at most once even by two concurrent passes (`review/codeRabbitNudgeJournal.ts`).
   */
  readonly landingCodeRabbitNudgesDir: string;
  /**
   * `$home/landing-presses.jsonl` — IMPORT SOURCE ONLY: the press register's old file, read once into the
   * store's `landing_press` table and never written again (`src/review/pressJournalPort.ts`).
   */
  readonly landingPressesJsonl: string;
  /**
   * `$home/landing-reads.json` — IMPORT SOURCE ONLY: the landing-read cursor's old file, read once into the
   * store's `landing_read_cursor` table and never written again (`src/review/readJournalPort.ts`).
   */
  readonly landingReadsJson: string;
}

/**
 * Resolve the provider state area under one home. Pure: no I/O.
 *
 * @param home the resolved Slopweaver home
 * @returns the provider state area's fields, rooted at `home`
 */
export function providersStateHomePaths({ home }: { home: string }): ProvidersStateHomePaths {
  return {
    calendarIntents: join(home, "calendar", "intents"),
    datadogCatalogue: {
      manifest: join(home, "datadog", "catalogue", "manifest.json"),
      root: join(home, "datadog", "catalogue"),
      rows: join(home, "datadog", "catalogue", "rows.jsonl"),
    },
    datadogHits: join(home, "datadog", "hits.jsonl"),
    vantaChanges: join(home, "vanta", "changes"),
    vantaChangesCursorJson: join(home, "vanta", "changes-read.json"),
    bakeoff: join(home, "bakeoff"),
    perfConsole: join(home, "perf", "console"),
    storeBackups: join(home, "backups", "store"),
    browserJson: join(home, "browser.json"),
    chromePin: join(home, "chrome-pin.sh"),
    linearRetiredTeamsJson: join(home, "linear-retired-teams.json"),
    incidents: join(home, "incidents"),
    incidentsSeenJsonl: join(home, "incidents", "seen.jsonl"),
    orgHealthIncidentsJson: join(home, "org-health", "incidents.json"),
    orgHealthSightingsJson: join(home, "org-health", "sightings.json"),
    orgHealthAcknowledgementsJsonl: join(home, "org-health", "acknowledgements.jsonl"),
    queue: join(home, "queue"),
    slackDraftMedia: join(home, "queue", "slack-draft-media"),
    gmailTriageRulesJson: join(home, "gmail-triage-rules.json"),
    rulingGatesJson: join(home, "ruling-gates.json"),
    alignmentBoardJson: join(home, "alignment-board.json"),
    worktreeBundles: join(home, "worktree-bundles"),
    worktreePruneTriggerDir: join(home, "worktree-bundles", "auto-trigger"),
    worktreePruneTriggerLog: join(home, "worktree-bundles", "auto-prune.log"),
    spendCapture: join(home, "spend", "capture"),
    spendCards: join(home, "spend", "cards"),
    spendForwards: join(home, "spend", "forwards"),
    landingCodeRabbitNudgesDir: join(home, "landing-coderabbit-nudges"),
    landingPressesJsonl: join(home, "landing-presses.jsonl"),
    landingReadsJson: join(home, "landing-reads.json"),
    slices: join(home, "slices"),
  };
}
