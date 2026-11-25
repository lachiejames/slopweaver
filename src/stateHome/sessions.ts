/**
 * The sessions area of the state-home contract: the supervisor's session ledger and pin, the board and its run
 * journals, the grant journals, the fleet's import-only files, cmux's records and the hand-step register.
 *
 * Part of the one `$SLOPWEAVER_HOME` contract tree, composed by `../stateHome.ts`, which is the only module that
 * imports it. A new path here is a field on {@link SessionsStateHomePaths} and a line in its resolver.
 */

import { join } from "node:path";

/** The sessions area's fields of {@link ../stateHome.StateHomePaths}. */
export interface SessionsStateHomePaths {
  /**
   * `$home/hand-steps` — the HAND-STEP register and the floating note it draws.
   *
   * Its own directory rather than a file under `ledgers/`: the register is one file, but the note is an
   * application bundle written beside it, and a bundle is not a ledger.
   */
  readonly handSteps: string;
  /** `$home/hand-steps/steps.jsonl` — one posted or settled row per line, append-only. */
  readonly handStepsJsonl: string;
  /** `$home/hand-steps/pushed.jsonl` — one row per notification sent, so nothing is ever pushed twice. */
  readonly handPushedJsonl: string;
  /**
   * `$home/hand-steps/shots` — the provider-page screenshot a step's card draws its red boxes on, named by its
   * SHA-256 and sharded two characters deep (`../hand/shotStore.ts`). Owner-only; the console serves it by hash.
   */
  readonly handShots: string;
  /**
   * `$home/hand-steps/notes` — one generated application bundle per raise, at `<token>/note.app`.
   *
   * Never one shared `note.app`: two raises close together rewrote it before either launched process had
   * read its program, so both could draw the SAME step with the same token. A bundle
   * is written once and never rewritten; `../hand/note/raise.ts` sweeps the old ones.
   */
  readonly handNoteApps: string;
  /** `$home/hand-steps/dismiss` — the directory a running note polls; a marker in it closes that note. */
  readonly handNoteDismiss: string;
  /**
   * `$home/hand-steps/fleet-health-shown.json` — what the last `fleet-unhealthy` note showed: its rows, the
   * listener, and when it went up. The pass diffs against it so a note says what CHANGED and one with no change is
   * never posted (`../monitor/fleetHealthDelta.ts`); `monitor check --fire` writes it after a post and removes it
   * when the fleet reads clear.
   */
  readonly fleetHealthShownJson: string;
  /**
   * `$home/hooks/cmux-notification-filter.sh` — the cmux notification hook `monitor filter install` emits.
   *
   * Under the state home rather than in cmux's own `hooks/` tree, because Slopweaver owns it and rewrites it
   * whenever the filter changes; a script living in cmux's tree reads as one a person edited by hand, which
   * is the thing rule 3 is protecting against. A one-line shim at the path cmux's config already names
   * `exec`s this, so the config itself — a hundred lines of the owner's own commentary — is never rewritten.
   */
  readonly cmuxNotificationFilterSh: string;
  /**
   * `$home/hooks/cmux-notification-decisions.jsonl` — one compact line per notification the filter judged.
   *
   * What makes the filter falsifiable. Without it, "the banners stopped" and "the hook is broken and cmux is
   * failing open" look identical from here, and the second is the one a silent lane hides.
   */
  readonly cmuxNotificationDecisionsJsonl: string;
  /**
   * `$home/handovers` — the orchestration docs, one markdown file each with YAML front-matter.
   *
   * A SIBLING of `orchestration/`, never inside it, and the separation is load-bearing rather than tidy.
   * The Codex tripwire treats any read of the orchestration tree as a pass having lost the task — there is
   * nothing in another pass's directory but old verdicts — so a doc living there would make every pass abort
   * on reading its own brief. `docs/constraints/coupled-claims.md` records the pair.
   */
  readonly handovers: string;
  /**
   * `$home/fleet/config.json` — IMPORT-ONLY, never the authority: the capacity setting a checkout before the store
   * wrote. The `fleet_config` row is the authority (`src/fleet/storePort.ts`); this file is read once, while no row
   * exists, and never written.
   */
  readonly fleetConfigJson: string;
  /**
   * `$home/fleet/resume.jsonl` — IMPORT-ONLY: the recovery journal a checkout before the store appended. Read once,
   * into `fleet_journal_event` under journal `resume`, and never written.
   */
  readonly fleetResumeJsonl: string;
  /**
   * `$home/fleet/cmux-revive.jsonl` — IMPORT-ONLY: the cmux revive journal a checkout before the store appended.
   * Read once, into `fleet_journal_event` under journal `cmux-revive`, and never written.
   */
  readonly cmuxReviveJsonl: string;
  /**
   * `$home/handovers/archive` — board documents moved off the live board, and the `owner-turn-*.txt`
   * records a seat archived beside them. One of the two roots the owner-turn walk reads
   * (`src/store/fleet/ownerTurnFiles.ts`).
   */
  readonly handoverArchive: string;
  /**
   * `$home/supervisor-scratch` — one directory per supervisor handoff, holding that chair's working files.
   * The scratch tier with ONE carve-out: its `owner-turn-*.txt` files are the owner's words verbatim, which
   * a loss audit found in no backup, so `store import-fleet --only owner-turns` reads them into
   * `owner_turn`. Nothing else under it is imported.
   */
  readonly supervisorScratch: string;
  /**
   * `$home/runs` — one append-only `<slug>.jsonl` journal per orchestration-doc run.
   *
   * A SIBLING of `handovers/` rather than a file inside each doc, for the reason the board itself is a scan
   * rather than an index: a doc is hand-edited in a text editor, and state written back into it would be lost
   * or conflicted the first time that happened. It is also outside `orchestration/`, because the Codex
   * tripwire treats any read of that tree as a pass having lost its task.
   *
   * This is the durable tier of the execution design. A compaction erases the context window; it cannot touch
   * this.
   */
  readonly runs: string;
  readonly orchestration: string;
  /**
   * `$home/cmux-event-cursor.json` — the RETIRED file that once held the highest cmux event sequence number a
   * supervisor had folded. An import address only: nothing writes it.
   *
   * The cursor now lives in the store's `cmux_event_state`, committed with the fold it is a cursor for
   * (`cmux/eventState/`). The first read on a home with no row imports this file once, beside the fold file
   * below; the row is the authority from then on and the file is never read again.
   */
  readonly cmuxEventCursorJson: string;
  /**
   * `$home/cmux-session-activity.json` — the RETIRED file that once held the fold `cmux/sessionActivity.ts`
   * built, keyed by workspace id. An import address only: nothing writes it.
   *
   * Imported once, together with the cursor file above, into the `session-watch` row of `cmux_event_state`.
   * The two are one fact — a cursor without its fold skips events, a fold without its cursor replays them —
   * so an import finding only one of the pair refuses rather than guessing which half to trust.
   */
  readonly cmuxSessionActivityJson: string;
  /**
   * `$home/cmux-relays` — one file per `cmux send` relay too long to paste, written and read back byte for byte
   * before the session is sent one line naming it. Kept after the send: a queued recipient reads it later.
   * `cmux/relayFile.ts` carries why a long paste is never trusted.
   */
  readonly cmuxRelays: string;
  /**
   * `$home/sessions` — the supervisor's session ledger: which chats it knows about, spawned via `cmux spawn`
   * or registered by hand, and what it has learned about each. A SIBLING of `queue/`, same owner-only
   * treatment (`0700`/`0600`), for the same reason: a session's notes are free text a supervisor wrote down,
   * which can hold anything the door ledger deliberately never records.
   */
  readonly sessions: string;
  /**
   * `$home/sessions/recovery-scratch` — the empty directory each throwaway session of `slopweaver fleet recover` runs
   * in, one `<attempt id>/fleet-recovery` per session, removed once its session is proven gone
   * (`fleet/recoveryScratch.ts`).
   */
  readonly recoveryScratch: string;
  /**
   * `$home/sessions/supervisor-pin.json` — which visible session (a Claude Code session or a Codex thread) holds the supervisor pin, as
   * `cmux pin`/`cmux takeover` last recorded it. Read by the `PreToolUse` depth guard, which cannot afford a
   * cmux socket round-trip per tool call; see `sessions/supervisorPin.ts` for why the socket stays the
   * authority and this is only a record of the last move.
   */
  readonly supervisorPinJson: string;
  /** Which sessions have declared they may not spawn a sub-agent — `sessions/agent-tool-bans.json`. */
  readonly agentToolBansJson: string;
  /**
   * `$home/sessions/supervisor-chain.jsonl` — every session that has HELD the supervisor pin, appended each
   * time a Slopweaver verb moves it. The pin record beside it is replaced on every takeover, which is
   * correct for routing and useless for an audit: without this journal the intake check can only
   * ever see the session it is running in (`supervisor/chain.ts` carries the measurement).
   */
  readonly supervisorChainJsonl: string;
  /**
   * `$home/sessions/hatch-grants.jsonl` — the journalled escape hatches for the OUTBOUND register rows
   * (journalled on outbound only). Its own file rather than a shared one: one journal
   * opening two unrelated blocks is
   * the ambient grant both shapes exist to avoid.
   */
  readonly hatchGrantsJsonl: string;
  /**
   * `$home/sessions/reach-grants.jsonl` — every recorded decision to reach a production-facing system with
   * a raw command. Keyed on the TOOL rather than on the caller, and deliberately a separate journal from
   * `hatchGrantsJsonl` (`admit/reachGrant.ts`): one grant that opened both would be the ambient override
   * both files exist to avoid.
   */
  readonly reachGrantsJsonl: string;
  /**
   * `$home/sessions/voice-brief-receipts` — one file per visible session that has had the owner's complete voice brief
   * printed into its context, naming the digest of the brief it saw and never a word of it
   * (`outbound/voice/briefReceipt.ts`). An as-me Slack draft or send from a session holding no receipt for the
   * CURRENT brief is refused, and the refusal prints the brief.
   */
  readonly voiceBriefReceipts: string;
  /**
   * `$home/grants` — the directory of the LEGACY grant journal below, and read by nothing else. The journal is
   * the store's `grant_row` table (`grants/port.ts`).
   */
  readonly grants: string;
  /**
   * `$home/grants/journal.jsonl` — the LEGACY source of `store import-fleet --only grants`, and read by nothing
   * else: every grant row, performance and typed refusal written before the store became their authority. Once
   * imported it may be removed.
   */
  readonly grantJournalJsonl: string;
  /**
   * `$home/sessions/intake-marks.jsonl` — every owner turn in the supervisor that became something OTHER
   * than a board row: a page card, an answer, or a turn that asked for nothing. Append-only and attributable
   * (`supervisor/intake.ts`), because the alternative — a turn witnessed by a chat reply — is the exact
   * failure the intake check exists to make visible.
   */
  readonly intakeMarksJsonl: string;
  /**
   * `$home/skill-reminders.json` — which `CLAUDE_CODE_SESSION_ID`s have already been reminded, this
   * session, that a governed CLI verb has an owning skill whose contract they should load first (see
   * `cli/skillReminder.ts`). Deliberately its OWN file rather than a row inside `sessions/sessions.jsonl` —
   * that ledger is the supervisor's own free-text notes about a chat, and this is a single advisory
   * dedup marker with a completely different lifecycle (bounded, self-pruning, never read as a note).
   */
  readonly skillRemindersJson: string;
  /**
   * `$home/stale-seat-notices.json` — the RETIRED marker of which sessions were already told this seat is behind
   * the trunk with no overlap on the verb they ran (`cli/staleSeat.ts`). The store's `stale-seat-notices` row is
   * the marker now (`cli/staleSeatNotices.ts`); a read finding no row imports this file ONCE. It was never shared
   * with {@link StateHomePaths.skillRemindersJson}: the two share a SHAPE and nothing else, and a bounded register
   * that evicted the other one's sessions would make each advisory depend on how often the other fired.
   */
  readonly staleSeatNoticesJson: string;
}

/**
 * The journalled-grant directory and the journal inside it, which are always read together.
 *
 * @param home the Slopweaver home
 * @returns the grant directory and its append-only journal
 */
function grantPaths({ home }: { home: string }): Pick<SessionsStateHomePaths, "grantJournalJsonl" | "grants"> {
  return { grantJournalJsonl: join(home, "grants", "journal.jsonl"), grants: join(home, "grants") };
}

/**
 * Resolve the sessions area under one home. Pure: no I/O.
 *
 * @param home the resolved Slopweaver home
 * @returns the sessions area's fields, rooted at `home`
 */
export function sessionsStateHomePaths({ home }: { home: string }): SessionsStateHomePaths {
  return {
    cmuxEventCursorJson: join(home, "cmux-event-cursor.json"),
    cmuxSessionActivityJson: join(home, "cmux-session-activity.json"),
    cmuxRelays: join(home, "cmux-relays"),
    handovers: join(home, "handovers"),
    fleetConfigJson: join(home, "fleet", "config.json"),
    fleetResumeJsonl: join(home, "fleet", "resume.jsonl"),
    cmuxReviveJsonl: join(home, "fleet", "cmux-revive.jsonl"),
    handoverArchive: join(home, "handovers", "archive"),
    supervisorScratch: join(home, "supervisor-scratch"),
    handSteps: join(home, "hand-steps"),
    handStepsJsonl: join(home, "hand-steps", "steps.jsonl"),
    handPushedJsonl: join(home, "hand-steps", "pushed.jsonl"),
    handShots: join(home, "hand-steps", "shots"),
    handNoteApps: join(home, "hand-steps", "notes"),
    handNoteDismiss: join(home, "hand-steps", "dismiss"),
    fleetHealthShownJson: join(home, "hand-steps", "fleet-health-shown.json"),
    cmuxNotificationFilterSh: join(home, "hooks", "cmux-notification-filter.sh"),
    cmuxNotificationDecisionsJsonl: join(home, "hooks", "cmux-notification-decisions.jsonl"),
    orchestration: join(home, "orchestration"),
    runs: join(home, "runs"),
    ...grantPaths({ home }),
    sessions: join(home, "sessions"),
    recoveryScratch: join(home, "sessions", "recovery-scratch"),
    agentToolBansJson: join(home, "sessions", "agent-tool-bans.json"),
    supervisorPinJson: join(home, "sessions", "supervisor-pin.json"),
    supervisorChainJsonl: join(home, "sessions", "supervisor-chain.jsonl"),
    hatchGrantsJsonl: join(home, "sessions", "hatch-grants.jsonl"),
    reachGrantsJsonl: join(home, "sessions", "reach-grants.jsonl"),
    voiceBriefReceipts: join(home, "sessions", "voice-brief-receipts"),
    intakeMarksJsonl: join(home, "sessions", "intake-marks.jsonl"),
    skillRemindersJson: join(home, "skill-reminders.json"),
    staleSeatNoticesJson: join(home, "stale-seat-notices.json"),
  };
}
