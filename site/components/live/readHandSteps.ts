/**
 * The reader for `hand list --json`, under every rule `./read.ts` states for the console's readers — bar one it
 * states itself: a step that does not read whole is drawn as its own card naming the field, never dropping the list.
 * It left `./read.ts` when that file reached the 1000-line ceiling `oxlint` holds it to, which `./read.ts` re-exports
 * from here so no importer moved.
 */

import { isBag, str, strings } from "../../lib/bag";
import { type HandShotView, readHandShotView } from "../../lib/handShot";
import { isWorkContext, type WorkContext } from "../../lib/workContext";
import { isWebUrl } from "../../lib/workspacePlacementAddress";
import { type HandChecklistLine, readHandChecklist } from "./readChecklist";
import { type HandStepDecision, readHandDecision } from "./readHandDecision";

/** One step only the owner's own hands can take, exactly as the hand register publishes it. */
export interface HandStep {
  readonly id: string;
  readonly what: string;
  readonly postedIso: string;
  /** What stays stopped until the owner does it — the register may leave it off. */
  readonly unblocks: string | undefined;
  /** Where the owner has to go to do it. */
  readonly where: string | undefined;
  /** The one address the note opens (`hand post --url`), most often a console page. */
  readonly url: string | undefined;
  /**
   * The page the fleet already opened on the owner's screen for the step (`hand post --opened`) — a sign-in's page. The card
   * draws it as its call to action: a sign-in card carried `https://dashboard.clerk.com` here and
   * drew no link to it, because this reader dropped the field. Absent on every other step.
   */
  readonly opened: string | undefined;
  /**
   * The exact string the owner pastes (`hand post --literal`) — a command, a key, a token. The native note draws and
   * copies it, and the queue card draws it too: a step reading "paste this" with nothing to paste is a card
   * the owner cannot act on. Absent on a step with nothing to paste.
   */
  readonly literal: string | undefined;
  /**
   * Why the step has no link and nothing to paste, in the poster's words (`hand post --no-address`) — drawn on the
   * card so an addressless step is a stated choice. Absent on a step with an address and on every row before the field.
   */
  readonly unaddressed: string | undefined;
  /**
   * What happens if the owner does nothing (`hand post --if-ignored`) — the line the owner ranks the card by, drawn under its call to
   * action. Absent on a step whose poster did not say, and on every row before the field.
   */
  readonly ifIgnored: string | undefined;
  /**
   * The pull requests and tickets the step names, as addresses (`hand post --cites`) — what its card resolves
   * `#NNNNN` against. Empty on every row written before the field.
   */
  readonly cites: readonly string[];
  /** The command that settles the step, so the page never has to invent one. */
  readonly witness: string | undefined;
  /**
   * The context `hand post --context` recorded, when the poster said which one the step belongs to.
   *
   * A step about the organisation's own obligations names no repository — the whole reason this field
   * exists — so there is nothing for the prose test to find and a stated value is the only thing that can
   * place the row without guessing. Absent on every row written before the field existed.
   */
  readonly context: WorkContext | undefined;
  /** The poster said this step is a check-in (`hand post --check-in`), so it ranks last and reads as one. */
  readonly checkIn: boolean;
  /**
   * The poster's mark that this step STOPS the owner's work (`src/hand/step.ts`'s `stopsWork`, written only by a monitor whose
   * registry entry declares it), so the Queue draws it under "Stopped automations" (`../../lib/queueStopping.ts`).
   * Absent on every other step and every row before the field.
   */
  readonly stopsWork?: true;
  /** The session, run or row that posted it (`hand post --by-session`), absent on a row that carries none. */
  readonly postedBy: string | undefined;
  /**
   * The decision the step carries in its own record, when it carries one — a monitor card whose choice no ask
   * holds. The card draws it exactly as it draws a linked ask. Absent on every other step.
   */
  readonly decision: HandStepDecision | undefined;
  /**
   * Why a card that names its board row has not left on that row's evidence — the row is missing or did not
   * read whole (`hand list --json`'s `rowProblem`). Absent on every other step. The card draws it, because a
   * card that stays with no reason is the one the owner already met.
   */
  readonly rowProblem: string | undefined;
  /**
   * Why a settle left this card up after answering the owner (`hand list --json`'s `keptReason`, from `handover settle
   * --card kept`). Absent on every other step. The card draws it, because answering is not always finishing.
   */
  readonly keptReason: string | undefined;
  /**
   * The integration the step touches, named from the credential register (`hand list --json`'s `integration`) — the
   * Queue card's `integration=` tag. Absent on a step that stores no registered secret.
   */
  readonly integration: string | undefined;
  /**
   * The board row this step unblocks, as its slug (`hand post --row`). A structured join: the step is placed partly
   * by that row, as it is by an ask its link opens. Absent on a `--standalone` step and every row before the field.
   */
  readonly row: string | undefined;
  /**
   * The secrets the step has the owner store, by name (`hand list --json`'s `secrets`, the settable names its literal or
   * prose gives `secrets set`). The card draws a secure paste field for each, so the owner never runs the command the owner.
   * Empty on a step that stores none and on every row before the field.
   */
  readonly secrets: readonly string[];
  /**
   * The provider page the step happens on, with a red box around each thing to grab (`hand post --shot --box`,
   * `../../lib/handShot.ts`), or with none when it is the page the post itself opened. Absent on every other step and
   * every row before the field.
   */
  readonly shot: HandShotView | undefined;
  /**
   * The script the owner runs through, one tickable line each (`hand post --checklist`, `src/hand/checklist.ts`): every
   * command its own copy block, every value the owner fetches named by where it sits. Absent on a step with none.
   */
  readonly checklist: readonly HandChecklistLine[] | undefined;
  /**
   * The field of this step's register line that did not read, when one did not — the card then draws only its id,
   * sentence and posting, and names the field, rather than the step vanishing or blanking every other card
   * (one `file://` url once blanked both hand cards on the Queue). Absent on every whole step.
   */
  readonly unreadable?: string | undefined;
}

/**
 * Project `hand list --json` into the section of steps waiting on the owner.
 *
 * The payload is an ARRAY because the route parsed JSONL: the hand register prints one object per line,
 * and an empty stream is the ordinary, good state rather than a failure.
 *
 * One step that does not read whole is ITS card's problem, never the list's: it is drawn as its id, sentence and
 * posting with the field that did not read named ({@link HandStep.unreadable}), and every other card stands. MEASURED
 * a single `file://` url refused the whole reading, and both of the owner's hand cards vanished from the
 * Queue. An entry with no id, sentence or posting instant has no card to draw at all, and is passed over.
 *
 * @returns one step per open note, or `undefined` when the payload is not an array
 */
export function readHandSteps(payload: unknown): readonly HandStep[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }
  const out: HandStep[] = [];
  for (const entry of payload as readonly unknown[]) {
    const step = readHandStepEntry({ entry });
    if (step !== undefined) {
      out.push(step);
    }
  }
  return out;
}

/**
 * The card a step that did not read whole is drawn as: who it is, and which field did not read — every other field
 * blank, because a card drawing half a decision or a lost literal reads as a whole one that is merely short.
 *
 * @returns the step
 */
function unreadableHandStep({
  entry,
  id,
  what,
  postedIso,
  field,
}: {
  entry: Readonly<Record<string, unknown>>;
  id: string;
  what: string;
  postedIso: string;
  field: string;
}): HandStep {
  return {
    checkIn: false,
    checklist: undefined,
    cites: [],
    context: undefined,
    decision: undefined,
    id,
    ifIgnored: undefined,
    integration: undefined,
    keptReason: undefined,
    literal: undefined,
    opened: undefined,
    postedBy: str({ bag: entry, key: "postedBy" }),
    postedIso,
    row: undefined,
    rowProblem: undefined,
    secrets: [],
    shot: undefined,
    unaddressed: undefined,
    unblocks: undefined,
    unreadable: field,
    url: undefined,
    what,
    where: undefined,
    witness: undefined,
  };
}

/**
 * One line of `hand list --json` as a step: whole, as an {@link unreadableHandStep} naming the field that did not
 * read, or `undefined` when it carries no id, sentence or posting instant to draw a card from.
 *
 * Every per-field rule below refuses a PRESENT value of the wrong shape rather than reading it as absent: a field
 * silently lost is a card that reads as whole and says the wrong thing.
 *
 * @returns the step, or `undefined`
 */
function readHandStepEntry({ entry }: { entry: unknown }): HandStep | undefined {
  if (!isBag(entry)) {
    return undefined;
  }
  const id = str({ bag: entry, key: "id" });
  const what = str({ bag: entry, key: "what" });
  const postedIso = str({ bag: entry, key: "postedIso" });
  if (id === undefined || what === undefined || postedIso === undefined) {
    return undefined;
  }
  // A step whose poster marked it as stopping the owner's work keeps that mark however another field read, so the card the owner
  // must see first is never dropped from the top for a field it does not depend on. A check-in never
  // stops anything, and the unreadable card is drawn as no check-in, so a check-in's mark is not carried onto it.
  const marked = entry["stopsWork"] === true && entry["checkIn"] !== true;
  const unreadable = ({ field }: { field: string }): HandStep => ({
    ...unreadableHandStep({ entry, field, id, postedIso, what }),
    ...(marked ? { stopsWork: true as const } : {}),
  });
  // A PRESENT context that is not one of the two ids is a shape change, where an absent one is ordinary: the value
  // places the row in a context, and reading it as absence would put the row back on the prose guess this field
  // exists to replace.
  const stated = entry["context"];
  if (stated !== undefined && !isWorkContext(stated)) {
    return unreadable({ field: "context" });
  }
  // The same per-field rule for the check-in word: `true` or absent, and anything else is a shape change.
  const checkIn = entry["checkIn"];
  if (checkIn !== undefined && checkIn !== true) {
    return unreadable({ field: "checkIn" });
  }
  // And for the stopping mark: `true` or absent, since a present value of another shape is a line this build cannot
  // place at the top of the owner's Queue with confidence.
  const stopsWork = entry["stopsWork"];
  if (stopsWork !== undefined && stopsWork !== true) {
    return unreadable({ field: "stopsWork" });
  }
  // And for the cited addresses: a list of strings or absent, and absent reads as none cited.
  let cites: readonly string[] = [];
  if (entry["cites"] !== undefined) {
    const listed = strings({ bag: entry, key: "cites" });
    if (listed === undefined) {
      return unreadable({ field: "cites" });
    }
    cites = listed;
  }
  // And for the literal: a card that silently lost the literal is the defect this field is read to prevent.
  const literal = entry["literal"];
  if (literal !== undefined && typeof literal !== "string") {
    return unreadable({ field: "literal" });
  }
  // And for the stated no-address reason: a card that silently lost it would be a step with nothing to open and no
  // word on why, the silence the field exists to end.
  const unaddressed = entry["unaddressed"];
  if (unaddressed !== undefined && typeof unaddressed !== "string") {
    return unreadable({ field: "unaddressed" });
  }
  // And for the do-nothing line: a card that silently lost it would fall back to the unblocks line the owner could not rank
  // the card by.
  const ifIgnored = entry["ifIgnored"];
  if (ifIgnored !== undefined && typeof ifIgnored !== "string") {
    return unreadable({ field: "ifIgnored" });
  }
  // And for the carried decision: whole or absent, because a card drawing half a decision reads as a whole one.
  const carried = readHandDecision({ value: entry["decision"] });
  if (carried === undefined) {
    return unreadable({ field: "decision" });
  }
  // And for the row problem: a card that silently lost it would stay on the owner's queue saying nothing about why.
  const rowProblem = entry["rowProblem"];
  if (rowProblem !== undefined && typeof rowProblem !== "string") {
    return unreadable({ field: "rowProblem" });
  }
  const keptReason = entry["keptReason"];
  if (keptReason !== undefined && typeof keptReason !== "string") {
    return unreadable({ field: "keptReason" });
  }
  const integration = entry["integration"];
  if (integration !== undefined && typeof integration !== "string") {
    return unreadable({ field: "integration" });
  }
  // And for the row it unblocks: it places the step — a join silently lost would draw the step as a finding placed by
  // the default rule, or in the wrong workspace.
  const row = entry["row"];
  if (row !== undefined && typeof row !== "string") {
    return unreadable({ field: "row" });
  }
  // And for the two addresses it opens: both place the step, so one silently lost could hide the address
  // contradicting its stated context. `where` is prose or a link, so a string reads; `url` is a web
  // address — a `file://` one is refused at posting (`src/hand/localFileUrl.ts`) and named here on an older line.
  const where = entry["where"];
  if (where !== undefined && typeof where !== "string") {
    return unreadable({ field: "where" });
  }
  const url = entry["url"];
  if (url !== undefined && (typeof url !== "string" || !isWebUrl({ value: url }))) {
    return unreadable({ field: "url" });
  }
  // And for the page the fleet opened: the card's call to action, so one silently lost is the Clerk card again.
  const opened = entry["opened"];
  if (opened !== undefined && (typeof opened !== "string" || !isWebUrl({ value: opened }))) {
    return unreadable({ field: "opened" });
  }
  // And for the secrets it has the owner store: a card that silently lost them would send the owner back to the terminal the
  // paste field exists to keep the owner out of.
  let secrets: readonly string[] = [];
  if (entry["secrets"] !== undefined) {
    const listed = strings({ bag: entry, key: "secrets" });
    if (listed === undefined) {
      return unreadable({ field: "secrets" });
    }
    secrets = listed;
  }
  // And for the picture: a box read past its picture would point the owner at the wrong field.
  const pictured = readHandShotView({ unboxed: "admitted", value: entry["shot"] });
  if (pictured === undefined) {
    return unreadable({ field: "shot" });
  }
  // And for the checklist: every line carries a command the owner copies.
  const scripted = readHandChecklist({ value: entry["checklist"] });
  if (scripted === undefined) {
    return unreadable({ field: "checklist" });
  }
  return {
    checkIn: checkIn === true,
    checklist: scripted.checklist,
    cites,
    context: isWorkContext(stated) ? stated : undefined,
    decision: carried.decision,
    id,
    ifIgnored,
    integration,
    keptReason,
    literal,
    opened,
    postedBy: str({ bag: entry, key: "postedBy" }),
    postedIso,
    row,
    rowProblem,
    secrets,
    shot: pictured.shot,
    ...(stopsWork === true ? { stopsWork } : {}),
    unaddressed,
    unblocks: str({ bag: entry, key: "unblocks" }),
    url,
    what,
    where,
    witness: str({ bag: entry, key: "witness" }),
  };
}
