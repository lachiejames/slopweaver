/**
 * The reader for `autonomy list --json` — the acts the fleet took on the owner's behalf without asking.
 *
 * A sibling of `./read.ts` for `./readHealth.ts`'s reason, and every rule that file's module doc states
 * governs this one: refuse rather than substitute, never DROP a row, a selection carries its own
 * denominator. Read `read.ts` first; what follows states only what is different.
 *
 * **What is different is that this register holds TWO accounts of one act**, and the page shows them in a
 * fixed order. `said` is the line written for the owner and `why` is the fleet's own note; the drawer leads with
 * the first and folds the second beneath it (`../../lib/queueCard.ts`). A row recorded before the register
 * asked for a said carries none, which is an absence the card names rather than a reading that failed — so
 * `said` is typed `| undefined` here while every field the card's claim rests on still refuses.
 */

import { type Bag, isBag, str, sub } from "../../lib/bag";

/** One act the fleet took on the owner's behalf without asking, and the owner's word on it when the owner has given one. */
export interface AutonomyRow {
  readonly actionId: string;
  readonly doneIso: string;
  readonly kind: string;
  readonly subject: string;
  readonly why: string;
  /** The line written for the owner, absent on a row recorded before `--said` existed. */
  readonly said: string | undefined;
  /** The owner's retroactive word, absent until the owner gives one — which is what `--unsteered` filters on. */
  readonly steer: string | undefined;
  /** The board row the act belongs to, absent on a row recorded without one — what its card links to. */
  readonly run: string | undefined;
  /** The proof the act happened, absent on a row recorded without one; an address in it is a link. */
  readonly witness: string | undefined;
  /**
   * The standing rule that settled it, when the owner's word on the act's whole class — not a word on this act — is the
   * steer that counts. What the queue names as the witness when a rule takes a card off the owner's list.
   */
  readonly standing: StandingRuleWitness | undefined;
  /**
   * The standing rule covering the act's kind and subject, whether or not a word on the act outranks it — what
   * keeps acts under two different rules out of one pattern (`../../lib/actGroups.ts`).
   */
  readonly rule: StandingRuleWitness | undefined;
  /**
   * The act the owner's word was given on, when `steer` is the owner's word on the newest act of this act's pattern rather than on
   * this one — what lets the queue refuse a word given on an act placed in the other workspace
   * (`../../lib/actGroups.ts` `placedAlikeSteers`).
   */
  readonly patternFrom: string | undefined;
  /**
   * The owner's word on THIS act itself — never a pattern's projection nor a class rule — with when the owner gave it. What the
   * Alignment page counts as repeat feedback on one kind (`../../lib/alignmentRules.ts`): a word inherited from
   * another act or a rule is not a second piece of feedback, so it is never this.
   */
  readonly directSteer: DirectSteer | undefined;
}

/** The owner's word on one act, read off that act's own line. */
export interface DirectSteer {
  readonly words: string;
  /** When the owner said it, or the act's own time when the line records no time for the word. */
  readonly atIso: string;
  /** Which of those `atIso` is: `steered` from `latestSteer.steeredIso`, `acted` from the act's `doneIso`. */
  readonly dateBasis: "steered" | "acted";
  /**
   * `after` for a word given on the act once it was done (`autonomy steer`), `with-act` for the `--steer` the act was
   * recorded with — which the autonomy skill reserves for an act done under a rule the owner already confirmed, so it cites
   * that ruling rather than saying anything new.
   */
  readonly given: "after" | "with-act";
}

/** One standing rule the owner has already given, as the page names it: the class, the owner's words, and where the owner said them. */
export interface StandingRuleWitness {
  readonly classId: string;
  readonly words: string;
  readonly anchor: string;
}

/*
 * Every field of a line, read only when the line carries it AS ITS OWN. A word that takes an act off the owner's list must
 * come from the register's own line, never an inherited property: `src/autonomy/query.ts` reads a steer with
 * `Object.hasOwn`, and a word the page found anywhere else would drop a card the register still calls unsteered
 * The same holds for the fields that decide an act's pattern.
 */

/** @returns the nested object, or `undefined` when `bag` does not itself carry one at `key` */
function ownSub({ bag, key }: { bag: Bag; key: string }): Bag | undefined {
  if (!Object.hasOwn(bag, key)) {
    return undefined;
  }
  return sub({ bag, key });
}

/** @returns the string, or `undefined` when `bag` does not itself carry one at `key` */
function ownStr({ bag, key }: { bag: Bag; key: string }): string | undefined {
  if (!Object.hasOwn(bag, key)) {
    return undefined;
  }
  return str({ bag, key });
}

/**
 * Read the one steer that counts off a ledger entry — the latest, else the one recorded on the act, else the owner's
 * word on the newest act of its pattern, else the owner's standing word on the act's whole kind.
 *
 * The fall-through is the whole function, and it mirrors `src/autonomy/query.ts`'s `steerOf` deliberately:
 * a `latestSteer` that carries no `steer` key does NOT mean the owner said nothing, so the act's own field is
 * still read. Returning at the first branch instead would print "the record does not carry this" over a
 * word the owner actually gave — and this is the one field on the page that reports what the owner said, so getting it
 * backwards is worse than not showing it.
 *
 * The class steer ranks last for the same reason it does in `steerOf`: a word on this one act is more
 * specific than a word on every act of its kind. It is what takes a class-settled act off the owner's check-in list
 * (`../../lib/queueRows.ts` drops every act carrying a steer), which is the whole point of recording one —
 * the owner's standing steers apply across the list and show the owner only what is left.
 *
 * Both halves are returned together, so the word and the rule it came from can never disagree: `standing` is set
 * by the class branch and by nothing else, and a word the owner gave on this one act is never attributed to a rule.
 *
 * @param entry the ledger line, whose `action` holds the act and whose `latestSteer` holds the owner's last word
 * @param rule the standing rule covering the act, which counts only when no word on the act does
 * @returns the owner's word and, when a standing rule supplied it, that rule — both `undefined` when nothing did — and the
 *   act a pattern's word was given on
 */
function steerOn({ entry, action, rule }: { entry: Bag; action: Bag; rule: StandingRuleWitness | undefined }): {
  steer: string | undefined;
  standing: StandingRuleWitness | undefined;
  patternFrom: string | undefined;
} {
  const latest = ownSub({ bag: entry, key: "latestSteer" });
  if (latest !== undefined) {
    const word = ownStr({ bag: latest, key: "steer" });
    if (word !== undefined) {
      return { patternFrom: undefined, standing: undefined, steer: word };
    }
  }
  const own = ownStr({ bag: action, key: "steer" });
  if (own !== undefined) {
    return { patternFrom: undefined, standing: undefined, steer: own };
  }
  // The owner's word on the newest act of this act's pattern, which the register's own fold projected onto it
  // (`src/autonomy/query.ts` `settlingPattern`): one grade on seven rebases settles all seven here exactly as
  // it does in `autonomy list --unsteered` and the Fleet Briefing, so no surface can still be asking. It is the owner's
  // word on an act, never a rule's, so it names no standing rule.
  const pattern = ownSub({ bag: entry, key: "patternSteer" });
  if (pattern !== undefined) {
    const word = ownStr({ bag: pattern, key: "steer" });
    const from = ownStr({ bag: pattern, key: "actionId" });
    if (word !== undefined && from !== undefined) {
      return { patternFrom: from, standing: undefined, steer: word };
    }
  }
  return { patternFrom: undefined, standing: rule, steer: rule?.words };
}

/**
 * The owner's word on this one act, from the act's own line: the latest steer when it carries a word, else the word recorded on
 * the act. The same first two branches as {@link steerOn}, without the pattern and class fall-through.
 *
 * @returns the word and when, or `undefined` when the owner has said nothing on this act
 */
function directSteerOn({
  entry,
  action,
  doneIso,
}: {
  entry: Bag;
  action: Bag;
  doneIso: string;
}): DirectSteer | undefined {
  const latest = ownSub({ bag: entry, key: "latestSteer" });
  if (latest !== undefined) {
    const words = ownStr({ bag: latest, key: "steer" });
    const at = ownStr({ bag: latest, key: "steeredIso" });
    if (words !== undefined && at !== undefined && !Number.isNaN(Date.parse(at))) {
      return { atIso: at, dateBasis: "steered", given: "after", words };
    }
    if (words !== undefined) {
      return { atIso: doneIso, dateBasis: "acted", given: "after", words };
    }
  }
  const own = ownStr({ bag: action, key: "steer" });
  if (own !== undefined) {
    return { atIso: doneIso, dateBasis: "acted", given: "with-act", words: own };
  }
  return undefined;
}

/** The class ids a standing rule is written under: `class.<id>`, or `class-scoped.<id>` when it holds a scope. */
const CLASS_PREFIX = "class.";
const SCOPED_CLASS_PREFIX = "class-scoped.";

/**
 * The standing rule that settles one act, re-checked here rather than trusted from the ledger's own fold.
 *
 * A class settles only a kind it names, and a scoped class only a subject starting with its scope — so an entry
 * whose class does not list this act's kind, or was scoped to another place, can never take an act the owner still has
 * to judge off the owner's list. It fails CLOSED: a scoped id with no readable scope, or a scope on
 * an unscoped id, settles nothing rather than everything.
 */
function standingOn({ entry, action }: { entry: Bag; action: Bag }): StandingRuleWitness | undefined {
  const row = ownSub({ bag: entry, key: "classSteer" });
  if (row === undefined) {
    return undefined;
  }
  const id = ownStr({ bag: row, key: "actionId" });
  const kinds = ownStr({ bag: row, key: "kinds" });
  const words = ownStr({ bag: row, key: "steer" });
  const anchor = ownStr({ bag: row, key: "anchor" });
  const kind = ownStr({ bag: action, key: "kind" });
  const subject = ownStr({ bag: action, key: "subject" });
  const named =
    id !== undefined &&
    kinds !== undefined &&
    words !== undefined &&
    anchor !== undefined &&
    kind !== undefined &&
    subject !== undefined &&
    kinds.split(",").includes(kind);
  if (!named) {
    return undefined;
  }
  const scope = ownStr({ bag: row, key: "subjectPrefix" });
  if (id.startsWith(SCOPED_CLASS_PREFIX)) {
    return scope !== undefined && subject.startsWith(scope)
      ? { anchor, classId: id.slice(SCOPED_CLASS_PREFIX.length), words }
      : undefined;
  }
  if (id.startsWith(CLASS_PREFIX) && !Object.hasOwn(row, "subjectPrefix")) {
    return { anchor, classId: id.slice(CLASS_PREFIX.length), words };
  }
  return undefined;
}

/**
 * Project `autonomy list --json` into the done-without-asking section.
 *
 * The payload is an ARRAY because the route parsed JSONL, and the register prints one line per act on
 * purpose: it grows for as long as the installation runs, so no verb may stringify the whole of it.
 *
 * The register's order is REFUSED rather than trusted when it is not newest first: the newest act of a pattern is
 * the one the owner's word settles it by (`../../lib/actGroups.ts`), so a payload listing an older act first would let a
 * word only on that act take a card off the page the register still asks about.
 * The check is to the millisecond. Rows sharing one millisecond are taken in the order given: the register breaks
 * that tie by id, and the page
 * trusts it there rather than restate the register's sub-millisecond and id comparison, because this payload is
 * only ever the register's own output.
 *
 * @returns every act newest first, in the register's own order, or `undefined` when a row is unreadable or the
 * rows are out of that order
 */
export function readAutonomy(payload: unknown): readonly AutonomyRow[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }
  const out: AutonomyRow[] = [];
  let newerMs = Number.POSITIVE_INFINITY;
  for (const entry of payload as readonly unknown[]) {
    if (!isBag(entry)) {
      return undefined;
    }
    // Own reads for the act too: its kind, subject and `said` decide which pattern it joins, so an inherited one
    // would fold a card the register draws apart.
    const action = ownSub({ bag: entry, key: "action" });
    if (action === undefined) {
      return undefined;
    }
    const actionId = ownStr({ bag: action, key: "actionId" });
    const doneIso = ownStr({ bag: action, key: "doneIso" });
    const kind = ownStr({ bag: action, key: "kind" });
    const subject = ownStr({ bag: action, key: "subject" });
    const why = ownStr({ bag: action, key: "why" });
    if (
      actionId === undefined ||
      doneIso === undefined ||
      kind === undefined ||
      subject === undefined ||
      why === undefined
    ) {
      return undefined;
    }
    const doneMs = Date.parse(doneIso);
    if (Number.isNaN(doneMs) || doneMs > newerMs) {
      return undefined;
    }
    newerMs = doneMs;
    // The run joins the act to the board row that places it, so one present and unreadable refuses the reading
    // rather than reading as absent and dropping that join silently.
    const run = action["run"];
    if (run != null && typeof run !== "string") {
      return undefined;
    }
    const rule = standingOn({ action, entry });
    const { steer, standing, patternFrom } = steerOn({ action, entry, rule });
    out.push({
      actionId,
      directSteer: directSteerOn({ action, doneIso, entry }),
      doneIso,
      kind,
      patternFrom,
      rule,
      run: ownStr({ bag: action, key: "run" }),
      said: ownStr({ bag: action, key: "said" }),
      standing,
      steer,
      subject,
      why,
      witness: ownStr({ bag: action, key: "witness" }),
    });
  }
  return out;
}
