/**
 * The ledgers area of the state-home contract: `$home/ledgers` and every append-only audit trail inside it.
 *
 * Part of the one `$SLOPWEAVER_HOME` contract tree, composed by `../stateHome.ts`, which is the only module that
 * imports it. A new ledger is a field on {@link LedgersStateHomePaths} and a line in its resolver.
 */

import { join } from "node:path";

/** The ledgers area's fields of {@link ../stateHome.StateHomePaths}. */
export interface LedgersStateHomePaths {
  /** `$home/ledgers` — append-only run logs (dev-gate log/diff; correction ledger reserved for PR12). */
  readonly ledgers: string;
  /**
   * `$home/ledgers/autonomy.jsonl` — the LEGACY source of `store import-fleet --only autonomy`, and read by
   * nothing else bar `autonomy adopt`, which repairs it before that import: every act a session took under
   * graduated autonomy and the owner's steers on them, written before the store's `autonomy_event` table became
   * their authority (`autonomy/port.ts`). Once imported it may be removed.
   */
  readonly autonomyLedgerJsonl: string;
  /**
   * `$home/ledgers/gold-debt.jsonl` — the GOLD-DEBT LEDGER: every pull request that merged below gold, what
   * gold proof would have been, and how the debt was eventually settled, one
   * {@link ../goldDebt/types.GoldDebtRecord} per line.
   *
   * Beside `autonomy.jsonl` inside `ledgers/` rather than a sibling of it, for the same reason: this IS an
   * audit trail — write once, read to answer "what is still owed and why" — rather than a work queue to be
   * drained. A merge below gold leaves gold OWED
   * rather than waived.
   */
  readonly goldDebtLedgerJsonl: string;
  /**
   * `$home/ledgers/sweep.jsonl` — the SWEEP LEDGER: every act `slopweaver sweep apply` performed on a board
   * row, carrying the verdict, the witness that condemned it and the row's whole prior text, one
   * {@link ../sweep/journalRow.SweepJournalRow} per line.
   *
   * Inside `ledgers/` beside `autonomy.jsonl` and `gold-debt.jsonl`, for the same reason both of those are:
   * write once, read to answer what was already done. It carries a second duty they do not, and it is the
   * whole rail behind the sweep's delete-by-default — `sweep restore` replays a row's `priorText`, so
   * a wrong deletion is undone rather than argued about. Its limit is stated in `../sweep/journalRow.ts`: it
   * lives under a state home that is not backed up, and making that durable is the other half of moving the home into the store.
   */
  readonly sweepLedgerJsonl: string;
  /**
   * `$home/ledgers/handover-wake.jsonl` — the WAKE JOURNAL: every reseat `handover wake` attempted, the park it
   * acted on and what it observed, then how it ended, one {@link ../handover/wakeJournal.WakeJournalRow} per line.
   * Every wake on the machine reads it, so the tick's wake and a later one never act twice on one condition.
   */
  readonly handoverWakeJournalJsonl: string;
  /**
   * `$home/ledgers/handover-wake-turns.json` — a snapshot, rewritten whole, of when `handover wake` last read each
   * waking park's checks and last asked `handover finish` about it. What lets a run that cannot reach every park
   * take the least recently served first, so the same few never take every read or ask. A file of its own rather
   * than a wake-journal kind, so an older checkout's strict wake-journal reader never meets a row it cannot decode.
   */
  readonly handoverWakeTurnsJson: string;
  /**
   * `$home/ledgers/home-reclaim.jsonl` — the RECLAIM LEDGER: every run of `slopweaver home reclaim --apply`,
   * carrying which declared root it entered, how much it took, whether its post-apply witness held and the
   * session that ran it, one {@link ../home/reclaim/journalRow.ReclaimJournalRow} per line.
   *
   * Inside `ledgers/` beside `sweep.jsonl` for the same reason that one is, and it carries the same rail
   * with one difference that matters: a reclaim is NOT reversible the way `sweep restore` is, because the
   * bytes are gone. What the ledger buys instead is that a wrong deletion is FINDABLE — the root, the act
   * and the session are on the record, so a reader who was not there can name what a run did without
   * having to trust the run that took it. That is not hypothetical: one row is
   * how the reclaim that deleted live supervisor-chair state was anchored (`../home/reclaim/roots.ts`).
   */
  readonly homeReclaimLedgerJsonl: string;
  /**
   * `$home/ledgers/pr-checks-read.jsonl` — the CHECKS-READ REGISTER: every pull request this install
   * raised, and every read of one's checks that discharged the obligation to look, one
   * { ../outbound/github/checksReadLedger.ChecksReadRecord} per line.
   *
   * Inside `ledgers/` beside `autonomy.jsonl` and `gold-debt.jsonl`, for the same reason both of those are:
   * it is an audit trail written once and read to answer a question about what already happened — here,
   * "did the session that raised this ever go back and look". It exists because a pull request's
   * reds were once fixed only after the owner spotted them themselves.
   */
  readonly prChecksReadJsonl: string;
  /**
   * `$home/ledgers/walkthrough-threads.jsonl` — the WALKTHROUGH-THREAD REGISTER: every review thread of the owner's a
   * landing verb resolved, and every one it reopened over a colleague's reply, one
   * {@link ../outbound/github/walkthroughLedger.WalkthroughLedgerRow} per line. What lets the landing tell its
   * own resolve from the owner's.
   */
  readonly walkthroughThreadsJsonl: string;
  /**
   * `$home/ledgers/reviewers.jsonl` — the REVIEWER REGISTER: every review ask `github landing --record-reading`
   * saw, deduplicated on pull request and message, and every approve or decline the owner gave a suggested reviewer,
   * one {@link ../review/reviewerRegister.ReviewerRow} per line. An audit trail like its neighbours; what the
   * pull-request page's suggested reviewer reads instead of folding the whole readings ledger.
   */
  readonly reviewerRegisterJsonl: string;
  /**
   * `$home/ledgers/sign-in-probes.jsonl` — every `browser sign-in` look at a Datadog or GitHub session in the owner's
   * Chrome and what it found, one {@link ../browser/signInProbeStore.SignInProbeRow} per line. What the card gate
   * (`../handover/fleetSignInGate.ts`) reads before a card may ask the owner to sign in to either.
   */
  readonly signInProbesJsonl: string;
  /**
   * `$home/ledgers/slack-send-failures.jsonl` — every as-me Slack post or reply that did NOT go out, with the
   * channel, the thread and the gate's or Slack's own words, one
   * {@link ../outbound/slack/sendFailureJournal.SlackSendFailure} per line and never the message itself. What the
   * console voice's `slack_send_outcome` reads to say a send failed and why (`../talk/slackSendOutcome.ts`).
   */
  readonly slackSendFailuresJsonl: string;
  /**
   * `$home/ledgers/landing-press-reseals.jsonl` — every `github press-reseal --apply` that re-keyed the press
   * register: its reason, instant, repositories, the previewed `sourceSha256` and every old-to-new key pair, one
   * {@link ../review/pressReseal.PressResealReceipt} per line, `0600` inside a `0700` directory. The store's
   * table keeps no history of a key it rewrote, so this line is the only record the old key ever existed.
   */
  readonly landingPressResealsJsonl: string;
  /**
   * `$home/ledgers/baseline-bumps` — the BUMP RECORDS: one write-once `<digest>.json` per ratchet bump a session
   * declared with `dev baseline-bump`, read by the two landing verbs to decide which loosenings a pull request
   * may carry and which Codex witness each owes (`../codex/bumpRecordStore.ts`). In the home rather than the tree
   * by the owner's ruling: the rules and counts stay in the code, the history of allowed exceptions belongs to the
   * installation, so a fork starts with the rules and none of that history.
   */
  readonly baselineBumps: string;
  /**
   * `$home/ledgers/value-samples` — the WEEKLY VALUE SAMPLES: one `<sample id>.json` per ISO week, the five asks
   * `value sample` drew with each one's cost and outcome, and the owner's used, not-used or not-yet answer per ask
   * once `value answer` records it (`../value/store.ts`). Written once per week and re-read on a retry, so a
   * second firing in the same week shows the same five rather than drawing again.
   */
  readonly valueSamples: string;
  /**
   * `$home/laps` — every `github lap` run's logs and receipt, `<owner>-<repo>/<number>/<started>/`, which
   * `--land-only` reads back (`../cli/commands/github/lapReceipts.ts`). A sibling of `ledgers/`, not inside it: a
   * run directory per lap rather than one journal, but in this area because it is the same kind of record.
   */
  readonly laps: string;
  /**
   * `$home/laps/lock.json` — the machine's one lap lock, taken by exclusive create and released only by the lap
   * whose nonce it carries (`../cli/commands/github/lapLock.ts`).
   */
  readonly lapLockJson: string;
  /**
   * `$home/laps/seat.json` — the designated lap seat: the one handover run whose session may run `github lap`
   * while a chair's rota stands, written by `github lap-seat set` (`../cli/commands/github/lapSeatStore.ts`).
   */
  readonly lapSeatJson: string;
}

/**
 * Resolve the ledgers area under one home. Pure: no I/O.
 *
 * @param home the resolved Slopweaver home
 * @returns the ledgers area's fields, rooted at `home`
 */
export function ledgersStateHomePaths({ home }: { home: string }): LedgersStateHomePaths {
  return {
    ledgers: join(home, "ledgers"),
    autonomyLedgerJsonl: join(home, "ledgers", "autonomy.jsonl"),
    goldDebtLedgerJsonl: join(home, "ledgers", "gold-debt.jsonl"),
    homeReclaimLedgerJsonl: join(home, "ledgers", "home-reclaim.jsonl"),
    sweepLedgerJsonl: join(home, "ledgers", "sweep.jsonl"),
    handoverWakeJournalJsonl: join(home, "ledgers", "handover-wake.jsonl"),
    handoverWakeTurnsJson: join(home, "ledgers", "handover-wake-turns.json"),
    prChecksReadJsonl: join(home, "ledgers", "pr-checks-read.jsonl"),
    walkthroughThreadsJsonl: join(home, "ledgers", "walkthrough-threads.jsonl"),
    reviewerRegisterJsonl: join(home, "ledgers", "reviewers.jsonl"),
    signInProbesJsonl: join(home, "ledgers", "sign-in-probes.jsonl"),
    slackSendFailuresJsonl: join(home, "ledgers", "slack-send-failures.jsonl"),
    landingPressResealsJsonl: join(home, "ledgers", "landing-press-reseals.jsonl"),
    baselineBumps: join(home, "ledgers", "baseline-bumps"),
    valueSamples: join(home, "ledgers", "value-samples"),
    laps: join(home, "laps"),
    lapLockJson: join(home, "laps", "lock.json"),
    lapSeatJson: join(home, "laps", "seat.json"),
  };
}
