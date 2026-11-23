/**
 * The owner's registers area of the state-home contract: the knowledge register, the readings ledger, the owner's
 * workstreams and the console voice's `talk/` state.
 *
 * Part of the one `$SLOPWEAVER_HOME` contract tree, composed by `../stateHome.ts`, which is the only module that
 * imports it. A new path here is a field on {@link WorkstreamsStateHomePaths} and a line in its resolver.
 */

import { join } from "node:path";

/** The registers area's fields of {@link ../stateHome.StateHomePaths}. */
export interface WorkstreamsStateHomePaths {
  /**
   * `$home/knowledge` — the knowledge register's directory, holding `lessons.jsonl`.
   *
   * This DISCHARGES the `beliefs/` reservation that stood here from the day this layout was written and was
   * never filled: `init` created the directory on every install and nothing ever put a byte in it. What
   * belongs in it is ONE register with `domain` as a facet,
   * so the slot is now named for what it holds. No migration ships with the rename because there is
   * nothing to migrate: an existing install's `beliefs/` is empty by construction, and an empty directory
   * left behind is inert.
   */
  readonly knowledge: string;
  /**
   * `$home/knowledge/lessons.jsonl` — the RETIRED register, one {@link ../knowledge/types.LessonRow} per line.
   *
   * The `memories` table is the register, so nothing in this tree writes this path.
   * An older checkout still does, which is why `../knowledge/lessonsDrift.ts` exists.
   */
  readonly knowledgeLessonsJsonl: string;
  /**
   * `$home/knowledge/redaction` — one `0600` archive per `knowledge redact --apply`, the register and its ledger as
   * they stood before the in-place rewrite, so a redaction never loses a row.
   */
  readonly knowledgeRedactionArchive: string;
  /**
   * `$home/knowledge/domains.json` — RETIRED: where this install's own knowledge domains lived before the
   * `knowledge_domain` table became their authority. Read once, by the one-time import
   * (`../knowledge/domainStoreRows.ts`), and never written.
   */
  readonly knowledgeDomainsJson: string;
  /**
   * `$home/readings` — the READINGS LEDGER: one verb document per file under `<producer slug>/`, and the
   * index every page reads. A SIBLING of `ledgers/` because what it holds is not a log of acts but the
   * last known state of the world as a verb printed it — `src/readings/store.ts`.
   */
  readonly readings: string;
  /** `$home/readings/index.jsonl` — one {@link ../readings/types.ReadingRecord} per line, append-only. */
  readonly readingsIndexJsonl: string;
  /**
   * `$home/workstreams/register.json` — RETIRED: where the owner's outcomes lived before the `workstream` tables became
   * their authority. Nothing reads it. The production store fences it into a directory holding a `RETIRED` marker,
   * so any older checkout's write or read fails, and refuses to open while a FILE still stands there
   * (`src/workstreams/store/retiredRegister.ts`).
   */
  readonly workstreamsRegisterJson: string;
  /**
   * `$home/workstreams/candidates.json` — the workstreams a session MINED from the owner's own words for them to react to,
   * one bounded document written whole by `workstreams candidates-put`.
   */
  readonly workstreamsCandidatesJson: string;
  /**
   * `$home/workstreams/stated-candidates.json` — the outcomes the owner STATED, offered beside the mined candidates,
   * with any exact former title a retitled one was answered under; absent is none stated
   * (`src/workstreams/candidateStore.ts`'s `readStatedCandidates`).
   */
  readonly workstreamsStatedCandidatesJson: string;
  /**
   * `$home/workstreams/reactions.jsonl` — the owner's reaction to each candidate, append-only, the latest row per candidate
   * standing; a yes row names the register entry it became (`src/workstreams/reactionStore.ts`).
   */
  readonly workstreamsReactionsJsonl: string;
  /**
   * `$home/workstreams/definitions.jsonl` — what each candidate's definition of done is, as picked from the mined
   * options or said in their own words, append-only, the latest row per candidate standing
   * (`src/workstreams/definitionStore.ts`).
   */
  readonly workstreamsDefinitionsJsonl: string;
  /**
   * `$home/workstreams/titles.jsonl` — the title the owner gives a candidate, append-only, the latest row per candidate
   * standing (`src/workstreams/titleStore.ts`).
   */
  readonly workstreamsTitlesJsonl: string;
  /**
   * `$home/workstreams/proposals.jsonl` — a workstream the owner proposes in their own words, beside or instead of a mined
   * candidate, append-only, one row per proposal (`src/workstreams/proposalStore.ts`).
   */
  readonly workstreamsProposalsJsonl: string;
  /**
   * `$home/workstreams/who-first.jsonl` — who the owner says the first conversation is with, as people, and the team that
   * owns it, append-only, the latest row per candidate standing (`src/workstreams/whoFirstStore.ts`).
   */
  readonly workstreamsWhoFirstJsonl: string;
  /**
   * `$home/talk/turns` — one `<turnId>.json` per relay the console voice MADE, created with the
   * exclusive `wx` flag. The file IS the cross-process mutex and the idempotency key at once: two relays
   * of one turn race to create it, the loser reads the winner's record rather than registering a second
   * board row, and a turn whose words changed is refused rather than reconciled — `src/talk/relayStore.ts`.
   * Beside it, `<turnId>.webp` (`0600`) is the picture of the owner's shared screen that relay carried, written
   * before the row names it and never replaced by another frame — `src/talk/relayPicture.ts`. Nothing deletes either yet.
   */
  readonly talkTurns: string;
  /**
   * `$home/talk/relays.jsonl` — one line per relay that reached the board, which `slopweaver talk log`
   * reads. A receipt names the board slug it created and never claims the supervisor saw it.
   */
  readonly talkRelaysJsonl: string;
  /**
   * `$home/talk/courier` — the hand-off from a relay whose own process cmux refused (a console started outside
   * cmux) to the pinned chair's courier, which runs inside it: `pending/<turnId>.json` written with `wx` by the
   * relay, renamed to `claimed/<turnId>.json` by the one courier that takes it, removed once the delivery is on the
   * turn. A request names a turn id and nothing else; the line is rebuilt from the turn — `src/talk/relayCourierStore.ts`.
   */
  readonly talkCourier: string;
  /**
   * `$home/talk/pack.json` — the console voice's context pack, rewritten whole by `slopweaver talk pack
   * --write` and read by `talk offer` at mint: the asks waiting on the owner with their words, the live seats, the owner's
   * last day of supervisor turns, the day's landings and where the last calls left off (`src/talk/contextPack.ts`).
   */
  readonly talkPackJson: string;
  /**
   * `$home/talk/attachments` — one `<uuid>/<name>` (`0700` directory, `0600` file) per file the owner attached in the
   * console's Messenger, written by `slopweaver talk attach` and read by the thinking model's `file_read` through the
   * path the message names (`src/talk/attachment.ts`). A copy of a file the owner already has, so scratch to the store: never
   * imported, never backed up. Nothing deletes one yet.
   */
  readonly talkAttachments: string;
  /**
   * `$home/talk/running-list.json` (`0600`) — the running list: the newest ten things the owner, the console voice and the
   * fleet left for each other, rewritten whole under `<file>.lock` by `slopweaver talk list-add` and read by
   * `talk list` (`src/talk/runningListStore.ts`).
   */
  readonly talkRunningListJson: string;
  /**
   * `$home/talk/e2e-reopen-probe.json` — present only while `slopweaver desktop e2e --call`'s `call-reopen` scenario
   * runs, until the instant it names: the one window in which a test instance's call (`talk offer --test-instance e2e`)
   * is judged a reopen of the test instance's own last call (`src/talk/e2eReopenProbe.ts`). Never read for the owner's calls.
   */
  readonly talkE2eReopenProbeJson: string;
  /**
   * `$home/talk/unread-adopt-receipts.jsonl` (`0600`) — one durable line per `slopweaver talk unread-adopt` apply: the
   * cursor it moved, the instant, the digest, the reason typed and every call's frontier before and after, so a backlog
   * marked read unprinted always says why (`src/talk/unreadAdoptReceipts.ts`). Appended only, never rewritten.
   */
  readonly talkUnreadAdoptReceiptsJsonl: string;
}

/**
 * Resolve the registers area under one home. Pure: no I/O.
 *
 * @param home the resolved Slopweaver home
 * @returns the registers area's fields, rooted at `home`
 */
export function workstreamsStateHomePaths({ home }: { home: string }): WorkstreamsStateHomePaths {
  return {
    knowledge: join(home, "knowledge"),
    knowledgeLessonsJsonl: join(home, "knowledge", "lessons.jsonl"),
    knowledgeRedactionArchive: join(home, "knowledge", "redaction"),
    knowledgeDomainsJson: join(home, "knowledge", "domains.json"),
    readings: join(home, "readings"),
    readingsIndexJsonl: join(home, "readings", "index.jsonl"),
    workstreamsRegisterJson: join(home, "workstreams", "register.json"),
    workstreamsCandidatesJson: join(home, "workstreams", "candidates.json"),
    workstreamsStatedCandidatesJson: join(home, "workstreams", "stated-candidates.json"),
    workstreamsReactionsJsonl: join(home, "workstreams", "reactions.jsonl"),
    workstreamsDefinitionsJsonl: join(home, "workstreams", "definitions.jsonl"),
    workstreamsTitlesJsonl: join(home, "workstreams", "titles.jsonl"),
    workstreamsWhoFirstJsonl: join(home, "workstreams", "who-first.jsonl"),
    workstreamsProposalsJsonl: join(home, "workstreams", "proposals.jsonl"),
    talkTurns: join(home, "talk", "turns"),
    talkRelaysJsonl: join(home, "talk", "relays.jsonl"),
    talkCourier: join(home, "talk", "courier"),
    talkPackJson: join(home, "talk", "pack.json"),
    talkAttachments: join(home, "talk", "attachments"),
    talkRunningListJson: join(home, "talk", "running-list.json"),
    talkE2eReopenProbeJson: join(home, "talk", "e2e-reopen-probe.json"),
    talkUnreadAdoptReceiptsJsonl: join(home, "talk", "unread-adopt-receipts.jsonl"),
  };
}
