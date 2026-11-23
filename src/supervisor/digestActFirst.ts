/**
 * The lines `tick open` prints FIRST: each one a decision the chair owes this pass, ending in the command that
 * acts on it.
 *
 * A capture can hold every fact the chair needs while the digest prints none of them. `recipe-due.json` carries a
 * recipe with `offReason: "held"` on its failure finding, so the digest reads `due` rows and `held` ones alike.
 * `reconcile.json` carries that finding in `held` and `repolessRows`, so the digest reads more than `ready`. The
 * owner's sidebar strip (`automation freshness --json`) can say a provider is failing, so the tick reads it. And
 * the ready list must not open on rows the chair's own previous pass held on the owner's word, or every pass
 * re-reads them. MEASURED: a ready list opened on eight rows the chair's own previous pass had held on the owner's
 * word, and the owner saw Notion failing on the sidebar twelve hours after its sync broke, before the chair did.
 *
 * So three blocks, in this order:
 *
 * - **broken**: one line per automation the store holds on a failure finding, joined with whether a seat is on
 *   that finding, and when none can be, why and the fix. A row OFF on the owner's approval or disabled bears no
 *   decision this pass and stays in `automation due`.
 * - **sidebar**: every provider `automation freshness` raises, worst first, with the owner's own numbers — `./digestSidebar.ts`.
 * - **seatable**: the first ready rows a spawn can take — not held by the previous pass's `hold-rationale`
 *   judgements, not already seated — each with its spawn, then the held ones with the claim that held them.
 *
 * Every match is EXACT: a seat is a worktree basename equal to the row's slug, a hold is a judgement subject or
 * related subject of kind `handover` with the row's id. A claim's prose is never read for ids. A reading that did
 * not complete prints UNKNOWN with why, never a quiet "nothing broken". Pure.
 */
import { basename } from "node:path";

import { shellCommandLine } from "#lib/shellCommandLine.js";

import { isSafeSlug } from "../handover/runStore.js";
import {
  boardLists,
  boardRowComplete,
  exclusionLines,
  HELD_STANDINGS,
  idShared,
  namelessReady,
  type ReadLists,
  SEATED_STANDINGS,
  sortReady,
  standingText,
} from "./digestBoard.js";
import {
  capped,
  type DigestInputs,
  detail,
  field,
  jsonOf,
  listOf,
  named,
  shortened,
  stringField,
} from "./digestRead.js";

/** The model a seat on a broken automation or a ready row opens on — rule 5: Opus to investigate. */
const SEAT_MODEL = "opus";

/** How many seatable ready rows the digest names, each with its own spawn. */
const SEATABLE_NAMED = 3;

/** The live seats, by worktree basename, or the line saying the cmux reading is missing. */
type SeatRead = { readonly seated: ReadonlySet<string> } | { readonly line: string };

/**
 * The worktree basenames of every live cmux workspace — a seat on row X runs in a worktree named X
 * (`../cli/commands/handover/reconcileRun.ts`).
 *
 * @returns the basenames, or the line saying the cmux reading is missing
 */
function seatRead({ inputs }: { inputs: DigestInputs }): SeatRead {
  const read = jsonOf({ inputs, name: "cmux" });
  if ("line" in read) {
    return read;
  }
  if (!Array.isArray(read.value)) {
    return { line: "cmux: not a workspace list" };
  }
  const directories = read.value.map((one) => stringField({ key: "currentDirectory", value: one }));
  const unplaced = directories.filter((one) => one === undefined || basename(one).length === 0).length;
  if (unplaced > 0) {
    // Every workspace carries one; a seat with none, or an empty one, could be the one on the row.
    return { line: `cmux: ${String(unplaced)} workspace(s) carry no currentDirectory, so no seat can be ruled out` };
  }
  return { seated: new Set(directories.filter((one) => one !== undefined).map((one) => basename(one))) };
}

/**
 * One spawn, as a line a chair can paste. It names no `--home`: every reading `tick open` takes runs against the
 * ambient home whatever `--home` it was given, which names only the ledger they are recorded in
 * (`../cli/commands/supervisor/scratchRun.ts`), so the ambient home is the board each line was derived from.
 */
function spawnCommand({ slug }: { slug: string }): string {
  return shellCommandLine({ command: ["slopweaver", "cmux", "spawn", slug, "--model", SEAT_MODEL] });
}

/**
 * What one held recipe's finding needs: a seat is on it, it cannot be seated and why, or it waits for a seat.
 *
 * @returns the clause naming the state and the command that acts on it
 */
function findingClause({ finding, inputs, seats }: { finding: string; inputs: DigestInputs; seats: SeatRead }): string {
  if ("line" in seats) {
    return `seat UNKNOWN — ${seats.line}`;
  }
  // A seat whose worktree carries the id is on THIS finding only when no other doc claims that id, so
  // the seat is called on it only once the board says the id is unambiguous.
  const seated = seats.seated.has(finding);
  const unknownLead = seated
    ? "a seat carries its id, but whether another doc claims that id too is UNKNOWN"
    : "UNSEATED, seatability UNKNOWN";
  const reconcile = jsonOf({ inputs, name: "reconcile" });
  if ("line" in reconcile) {
    return `${unknownLead} — ${reconcile.line}`;
  }
  const lists = boardLists({ value: reconcile.value });
  if ("unreadable" in lists) {
    return `${unknownLead} — ${lists.unreadable}`;
  }
  // A slug two docs claim, in any list or none, is one `handover set-repo` and `cmux spawn` both refuse —
  // and one `held` and `ready` repeat between them is that whatever `sharedSlugs` says.
  if (idShared({ id: finding, lists })) {
    return seated
      ? "a seat carries its id, but more than one doc claims it, so which doc that seat is on is UNKNOWN"
      : "UNSEATED, seatability UNKNOWN — more than one doc claims this id, so set-repo and cmux spawn both refuse it";
  }
  if (!seated) {
    return unseatedClause({ finding, inputs, lists });
  }
  // A ready row naming no id could be another doc claiming this one, the same ambiguity as a seat's id shared.
  const nameless = namelessReady({ lists });
  if (nameless > 0) {
    return `a seat carries its id, but reconcile carries ${String(nameless)} ready row(s) naming no id, so whether another doc claims it too is UNKNOWN`;
  }
  return "a seat is on it";
}

/**
 * An unseated finding reconcile calls repoless, and the set-repo then spawn that seats it. A repoless row is a
 * `RUN NOW` row `standingOf` blocks (`../handover/rowStanding.ts`), so reconcile carries it on `held` and never on
 * `ready` (`../handover/reconcile.ts`'s cover); one on `ready`, or on no `held` row, is a reading that
 * contradicts itself, and a set-repo printed on it may name a doc that already has a repo.
 *
 * @param finding the finding's row id
 * @param lists the readable reconcile lists
 * @returns the clause
 */
function repolessClause({
  finding,
  inputs,
  lists,
}: {
  finding: string;
  inputs: DigestInputs;
  lists: ReadLists;
}): string {
  const onReady = lists.ready.some((row) => stringField({ key: "id", value: row }) === finding);
  const onHeld = lists.held.some((row) => stringField({ key: "id", value: row }) === finding);
  if (onReady || !onHeld) {
    return "UNSEATED, seatability UNKNOWN — reconcile calls its row repoless but carries it on ready or on no held row";
  }
  const checkout = inputs.recipeFixCheckout;
  if (checkout.kind === "unresolved") {
    // A bare `--repo slopweaver` is refused on a machine declaring no checkout of that name.
    return `UNSEATED and UNSEATABLE, its row names no repo:, and no checkout to give it resolves — ${shortened({ text: checkout.why })}`;
  }
  const setRepo = shellCommandLine({
    command: ["slopweaver", "handover", "set-repo", finding, "--repo", checkout.path],
  });
  return `UNSEATED and UNSEATABLE, its row names no repo: — ${setRepo}, then ${spawnCommand({ slug: finding })}`;
}

/**
 * Where an unseated, unambiguous finding sits on the board, and the command that seats it when one can.
 *
 * @param finding the finding's row id
 * @param lists the readable reconcile lists
 * @returns the clause
 */
function unseatedClause({
  finding,
  inputs,
  lists,
}: {
  finding: string;
  inputs: DigestInputs;
  lists: ReadLists;
}): string {
  const running = lists.inFlight.find((row) => stringField({ key: "id", value: row }) === finding);
  // `aligned` and `misaligned` are rows reconcile places a live session on, whatever their standing,
  // so that placement is the claim, and a standing the list cannot carry is quoted as UNKNOWN, never as read.
  if (running !== undefined) {
    return `reconcile places a session on its row (${standingText({ allowed: SEATED_STANDINGS, row: running })})`;
  }
  // A ready row naming no id could be this finding's, so no lookup past here can rule one out.
  const nameless = namelessReady({ lists });
  if (nameless > 0) {
    return `UNSEATED, seatability UNKNOWN — reconcile carries ${String(nameless)} ready row(s) naming no id, any of which could be this one`;
  }
  if (lists.repolessRows.includes(finding)) {
    return repolessClause({ finding, inputs, lists });
  }
  const heldRow = lists.held.find((row) => stringField({ key: "id", value: row }) === finding);
  if (heldRow !== undefined) {
    return `UNSEATED, its row is held on the board (${standingText({ allowed: HELD_STANDINGS, row: heldRow })})`;
  }
  const readyRow = lists.ready.find((row) => stringField({ key: "id", value: row }) === finding);
  if (readyRow === undefined) {
    return "UNSEATED and on no ready, held or in-flight row, so nothing can seat it";
  }
  if (!boardRowComplete({ row: readyRow })) {
    return "UNSEATED, seatability UNKNOWN — its ready row lacks the label, priority or ready standing every ready board row carries";
  }
  return `UNSEATED — ${spawnCommand({ slug: finding })}`;
}

/**
 * Whether a recipe-due row says its hold plainly, in `DueAskRow`'s own shape (`../live/automation/dueReport.ts`): a
 * record naming its recipe, whose `heldOnFinding` is absent (unheld) or a slug the run journal accepts on a row OFF
 * as `held` with a `lastRunAtIso` of a non-empty string or null, so any command printed on it is one `cmux spawn` takes.
 * Anything else — a row naming no recipe included — cannot be called unbroken, so it prints UNKNOWN rather than
 * reading as unheld.
 *
 * @returns whether the row's hold can be read
 */
function holdReadable({ row }: { row: unknown }): boolean {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return false;
  }
  const recipeId = stringField({ key: "recipeId", value: row });
  if (recipeId === undefined || recipeId === "") {
    return false;
  }
  const finding = field({ key: "heldOnFinding", value: row });
  if (finding === undefined) {
    return true;
  }
  const lastRun = field({ key: "lastRunAtIso", value: row });
  return (
    typeof finding === "string" &&
    isSafeSlug({ slug: finding }) &&
    field({ key: "offReason", value: row }) === "held" &&
    (lastRun === null || (typeof lastRun === "string" && lastRun.length > 0))
  );
}

/**
 * Every recipe more than one row names, whether or not each row's hold reads. `automation due` writes one row per
 * recipe, so two cannot both be its hold, and neither is read as one — an unreadable second row
 * included, since it could be the one carrying the recipe's real hold.
 *
 * @param rows the recipe-due reading's rows
 * @returns the repeated recipe ids
 */
function repeatedRecipes({ rows }: { rows: readonly unknown[] }): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const row of rows) {
    const recipe = stringField({ key: "recipeId", value: row });
    if (recipe === undefined || recipe === "") {
      continue;
    }
    if (seen.has(recipe)) {
      repeated.add(recipe);
    }
    seen.add(recipe);
  }
  return repeated;
}

/**
 * One line per automation the store holds on a failure finding, one UNKNOWN per row whose hold will not read or
 * recipe the reading carries twice, or one line saying none is held.
 *
 * @returns the lines
 */
export function brokenAutomationLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: "recipe-due" });
  if ("line" in read) {
    return [`broken: UNKNOWN — ${read.line}`];
  }
  const rows = listOf({ key: "rows", value: read.value });
  if (rows === undefined) {
    return ["broken: UNKNOWN — recipe-due carries no rows list"];
  }
  const repeated = repeatedRecipes({ rows });
  const unreadable = rows.filter((row) => !holdReadable({ row }));
  const held = rows.filter(
    (row) =>
      holdReadable({ row }) &&
      !repeated.has(named({ key: "recipeId", value: row })) &&
      field({ key: "heldOnFinding", value: row }) !== undefined,
  );
  const unknown = [
    ...unreadable.map((row) => {
      const recipe = stringField({ key: "recipeId", value: row });
      const name = recipe === undefined || recipe === "" ? "(no recipeId)" : recipe;
      return `broken: UNKNOWN — recipe-due row ${name} carries no readable hold`;
    }),
    ...[...repeated].map((recipe) => `broken: UNKNOWN — recipe-due carries more than one row for ${recipe}`),
  ];
  if (held.length === 0 && unknown.length === 0) {
    return ["broken: no automation is held on a failure"];
  }
  const seats = seatRead({ inputs });
  const brokenLines = held.map((row) => {
    const finding = stringField({ key: "heldOnFinding", value: row })!;
    const lastRun = stringField({ key: "lastRunAtIso", value: row });
    const since = lastRun === undefined ? "" : `, last ran ${lastRun}`;
    return (
      `BROKEN ${named({ key: "recipeId", value: row })} — OFF on finding ${finding}${since}; ` +
      findingClause({ finding, inputs, seats })
    );
  });
  return [...brokenLines, ...unknown];
}

/**
 * A ready row's priority, or `unprioritised` when the row carries none, so the line still says so.
 *
 * @returns the priority
 */
function priorityOf({ row }: { row: unknown }): string {
  const priority = stringField({ key: "priority", value: row });
  if (priority === undefined) {
    return "unprioritised";
  }
  return priority;
}

/**
 * The first ready rows a spawn can actually take, each with its spawn, then each ready row the previous pass
 * held with the claim that held it. Leaving a held row out of the seatable list exempts it from nothing: the
 * hold is that pass's judgement, and `tick close` judges this pass afresh.
 *
 * @returns the lines
 */
export function seatableLines({ inputs }: { inputs: DigestInputs }): readonly string[] {
  const read = jsonOf({ inputs, name: "reconcile" });
  if ("line" in read) {
    return [`seatable: UNKNOWN — ${read.line}`];
  }
  const ready = listOf({ key: "ready", value: read.value });
  if (ready === undefined) {
    return ["seatable: UNKNOWN — reconcile carries no ready list"];
  }
  if (ready.length === 0) {
    return ["seatable: NONE of 0 ready row(s)"];
  }
  const board = boardLists({ value: read.value });
  if ("unreadable" in board) {
    return [
      `seatable: UNKNOWN — ${board.unreadable}, so none of ${String(ready.length)} ready row(s) can be called unambiguous`,
    ];
  }
  const sort = sortReady({ lists: board });
  const tail = [...exclusionLines({ sort }), ...priorHeldLines({ identified: sort.identified, inputs })];
  const seats = seatRead({ inputs });
  const unknown = seatUnknownLines({ inputs, readyCount: ready.length, seats });
  if (unknown.length > 0 || "line" in seats) {
    return [...unknown, ...tail];
  }
  const excluded = new Set([...sort.shared, ...sort.repoless, ...sort.placed]);
  const seatable = sort.identified.filter(
    ({ id }) => !priorHeldIds({ inputs }).has(id) && !seats.seated.has(id) && !excluded.has(id),
  );
  const offered = seatable
    .slice(0, SEATABLE_NAMED)
    .map(
      ({ id, row }) =>
        `seatable: ${priorityOf({ row })} ${id} — ${detail({ key: "label", value: row, whenAbsent: "(no label)" })} — ` +
        spawnCommand({ slug: id }),
    );
  const count = seatable.length === 0 ? "NONE" : String(seatable.length);
  return [`seatable: ${count} of ${String(ready.length)} ready row(s)`, ...offered, ...tail];
}

/**
 * The ids the previous pass held, none when it held nothing or its holds were not read.
 *
 * @returns the ids
 */
function priorHeldIds({ inputs }: { inputs: DigestInputs }): ReadonlySet<string> {
  return inputs.priorHolds.kind === "read" ? new Set(inputs.priorHolds.held.keys()) : new Set();
}

/**
 * Each ready row the previous pass held, with the claim that held it, capped.
 *
 * @param identified the ready rows carrying an id
 * @returns the lines
 */
function priorHeldLines({
  identified,
  inputs,
}: {
  identified: readonly { readonly id: string; readonly row: unknown }[];
  inputs: DigestInputs;
}): readonly string[] {
  const { priorHolds } = inputs;
  if (priorHolds.kind !== "read") {
    return [];
  }
  const lines = identified.flatMap(({ id, row }) => {
    const claim = priorHolds.held.get(id);
    return claim === undefined
      ? []
      : [`held by tick ${String(priorHolds.tick)}: ${priorityOf({ row })} ${id} — ${shortened({ text: claim })}`];
  });
  return capped({ lines, prefix: "held" });
}

/**
 * With no seat reading, or no reading of the previous pass's holds, a row a seat is already on,
 * or one that pass held, would be printed with a spawn beside it — so each says UNKNOWN instead.
 *
 * @param readyCount how many ready rows reconcile listed
 * @returns the UNKNOWN lines, none when both were read
 */
function seatUnknownLines({
  inputs,
  readyCount,
  seats,
}: {
  inputs: DigestInputs;
  readyCount: number;
  seats: SeatRead;
}): readonly string[] {
  const { priorHolds } = inputs;
  const count = String(readyCount);
  const unseated =
    "line" in seats
      ? [`seatable: UNKNOWN — ${seats.line}, so none of ${count} ready row(s) can be called unseated`]
      : [];
  const unheld =
    priorHolds.kind === "unreadable"
      ? [
          `seatable: UNKNOWN — tick ${String(priorHolds.tick)}'s holds could not be read ` +
            `(${shortened({ text: priorHolds.why })}), so none of ${count} ready row(s) can be called unheld`,
        ]
      : [];
  return [...unseated, ...unheld];
}
