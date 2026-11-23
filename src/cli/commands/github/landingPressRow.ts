/**
 * The autonomy-ledger ROW one press of `slopweaver github landing --press` leaves behind, and the id it is
 * written under.
 *
 * Its own module because it is pure — a row and an id computed from what the press saw, with no GitHub and no
 * disk — while `./landingPress.ts` is the sequence that presses and then writes it. The seam is the one the
 * ledger itself draws: what a row SAYS is decided here, whether it could be written is decided there.
 */

import { createHash } from "node:crypto";

import { conflictingField } from "../../../autonomy/query.js";
import { AUTONOMY_ACTION_ID_MAX, type AutonomyActionRow } from "../../../autonomy/types.js";
import type { LandingRow } from "../../../review/landing.js";
import { type PressWaiver, waiverClause } from "./pressJudgment.js";

/**
 * One autonomy-ledger row, as `../../../autonomy/port.ts` takes one.
 *
 * @internal named so `./landingPress.ts`'s `LandingPressDeps` states what it hands its writer; a consumer
 *   passes a matching object rather than importing this.
 */
export interface PressLedgerRow {
  readonly actionId: string;
  readonly kind: string;
  readonly subject: string;
  readonly doneIso: string;
  readonly bySession: string;
  readonly why: string;
  readonly witness: string;
}

/**
 * The autonomy-ledger row one automatic press leaves behind.
 *
 * `AGENTS.md` rule 10's other half is that an act the fleet takes unasked is RECORDED: a green, approved,
 * mergeable pull request the fleet presses is an act under graduated autonomy, and the ledger's own manifest
 * carries `press-merge-when-ready` as its worked example. Without the row every press this machine makes is
 * invisible in the briefing's "done for you, without asking" section. A press nobody can see is
 * indistinguishable from a press nobody made.
 *
 * The row says which findings the press ALSO acknowledged, because the briefing's "done for
 * you, without asking" section is the one surface where the owner sees an act the fleet took on their behalf — and an
 * act that waived a standing rule, reported as though it waived nothing, is the shape of a ledger that is
 * technically complete and actually misleading.
 *
 * @param row the pressed row
 * @param bySession what identifies this session
 * @param atIso when the press was made
 * @param waivers every finding the press answered for itself, empty when it answered none
 * @returns the ledger row, under the FIRST press's id at its head
 */
export function pressAutonomyRow({
  row,
  bySession,
  atIso,
  waivers,
}: {
  row: LandingRow;
  bySession: string;
  atIso: string;
  waivers: readonly PressWaiver[];
}): PressLedgerRow {
  return {
    actionId: pressActionId({ row }),
    bySession,
    doneIso: atIso,
    kind: "press-merge-when-ready",
    subject: row.url.toLowerCase(),
    why:
      "every one of the six landing tests passed and nothing needing the owner's judgment was on it at press time" +
      waiverClause({ tense: "did", waivers }),
    witness: `slopweaver github landing --press -> enqueued ${row.repoSlug.toLowerCase()}#${String(row.number)} at head ${row.headOid.toLowerCase()}`,
  };
}

/** One half of a repository slug the id can spell verbatim: hyphen-joined lowercase alphanumerics, no dot. */
const SPELLABLE_HALF = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * The autonomy-ledger id of one press: its REPOSITORY, its number and the full HEAD it pressed.
 *
 * All three, whole, because the ledger refuses a second row under an id it already holds with different
 * fields (`ACTION_ID_CONFLICT`, `../../../autonomy/storePort.ts`). The old `<number>-enqueue` id lost the row for the
 * second press of one pull request at a new head — the queue evicted it, a rebase moved it, the next pass
 * pressed it again — and for a same-numbered pull request in the other repository. Three Codex reviews then
 * built the rest of the class: one commit pushed to two repositories, two heads sharing a 12-character
 * prefix, and two repositories whose 12-character digests were brute-forced equal. So nothing in the id is
 * shortened, and every id opens on the fixed word `enqueue-`, so no repository name can reach a prefix the
 * ledger reserves — a fourth review built `class/widgets`, whose id would have opened on the `class.` of a
 * class steer. It spells `enqueue-owner.repo-<number>-<head>` when that spelling is one-to-one — each half
 * already hyphenated lowercase alphanumerics, so the dot can only be the separator — and fits
 * `../../../autonomy/types.ts`'s 80-character bound. Anything else is `enqueue-` and the WHOLE sha-256 of the
 * lowercased repository (GitHub names are case-insensitive), number and head together, which carries no dot
 * and so never meets a spelled id. The row's subject URL and witness are lowercased too, because a hex object
 * id names one commit and a GitHub name one repository however either is cased: two spellings — a case-only
 * repository rename included — are one press, never a conflicting row. This is the FIRST press's id at a
 * head; a later press at the same head is {@link pressOccurrenceId}'s.
 *
 * The same id shape keys every other per-head act on a pull request — `github bump-drive`'s undraft and
 * description rewrite — under its own {@link LedgerActionWord}, because a bare `<number>-…` id there lost
 * rows exactly as `<number>-enqueue` did. A press from either verb is the SAME act, so both spell `enqueue`
 * and a second one at a held head is an occurrence, never a refused row.
 *
 * @param row the pressed row
 * @param word the act the id names; `enqueue` unless the act is another one
 * @returns the id, matching `../../../autonomy/types.ts`'s slug pattern and outside its reserved prefix
 */
export function pressActionId({ row, word = "enqueue" }: { row: LandingRow; word?: LedgerActionWord }): string {
  const slug = row.repoSlug.toLowerCase();
  const head = row.headOid.toLowerCase();
  const halves = slug.split("/");
  const spellable = halves.length === 2 && halves.every((half) => SPELLABLE_HALF.test(half));
  const spelled = `${word}-${halves.join(".")}-${String(row.number)}-${head}`;
  if (spellable && spelled.length <= AUTONOMY_ACTION_ID_MAX) {
    return spelled;
  }
  return `${word}-${createHash("sha256")
    .update(`${slug}\n${String(row.number)}\n${head}`)
    .digest("hex")}`;
}

/**
 * The fixed word a per-head act's id opens on. Closed, so no id can open on a prefix the ledger reserves for a
 * class steer (`class.`, `class-scoped.`), and two acts at one head never share an id.
 */
export type LedgerActionWord = "enqueue" | "undraft" | "rewrite";

/**
 * The id one press's row is written under: {@link pressActionId} for the first press at a head, and that id
 * with an occurrence ordinal for every press after it at the SAME head.
 *
 * MEASURED in `$SLOPWEAVER_HOME/landing-presses.jsonl`: one pull request was pressed twice, four minutes apart, at
 * the same head, and two others the same way, three minutes apart each. The queue had let go of the first entry and the next pass pressed again, which is
 * ordinary. A head in the id separates a re-press after a REBASE and nothing else, so the second press built
 * the first one's id with a different `doneIso` and the ledger refused it: three unasked presses the owner's
 * briefing never showed.
 *
 * So the first id that is either unheld, or held by an act identical to this one, is the answer. The second
 * half is what keeps a retried write of ONE press idempotent rather than a second row for it. A repeat spells
 * `<id>-<n>` from `2`; a spelled id ends on a whole head of 40 or 64 hex, so a short decimal last segment can
 * only be an ordinal. Past the ledger's 80-character bound it is the id's own word and the sha-256 of the id
 * and the ordinal, a two-line preimage no three-line {@link pressActionId} digest shares.
 *
 * Two sessions pressing one pull request at one head in the same instant both resolve the same ordinal, and
 * the ledger refuses the slower write. That residue is the press's reported-not-thrown path, not this one.
 *
 * @param row the press's row, carrying {@link pressActionId} as its id
 * @param held every act the ledger holds, steers excluded
 * @returns the id to write the row under
 */
export function pressOccurrenceId({ row, held }: { row: PressLedgerRow; held: readonly AutonomyActionRow[] }): string {
  // Every holder, not the last one: a ledger the write rail never let diverge can still have been edited by hand.
  const free = ({ actionId }: { actionId: string }): boolean =>
    held
      .filter((act) => act.actionId === actionId)
      .every((holder) => conflictingField({ first: holder, second: { ...row, actionId } }) === undefined);
  let ordinal = 1;
  let candidate = row.actionId;
  // Terminates: `held` is finite and every candidate is distinct, so at most `held.length` of them are taken.
  while (!free({ actionId: candidate })) {
    ordinal += 1;
    candidate = repeatActionId({ base: row.actionId, ordinal });
  }
  return candidate;
}

/**
 * The id of the `ordinal`th act at one head, the first one's id being `base`. A digest keeps `base`'s own
 * {@link LedgerActionWord} — every word is hyphen-free, so it is everything before the first hyphen — so a
 * repeated undraft never reads as a press.
 */
function repeatActionId({ base, ordinal }: { base: string; ordinal: number }): string {
  const spelled = `${base}-${String(ordinal)}`;
  if (spelled.length <= AUTONOMY_ACTION_ID_MAX) {
    return spelled;
  }
  return `${base.slice(0, base.indexOf("-"))}-${createHash("sha256")
    .update(`${base}\n${String(ordinal)}`)
    .digest("hex")}`;
}
