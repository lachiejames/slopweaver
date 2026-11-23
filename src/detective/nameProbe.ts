/**
 * The pre-planning name step: which spelling of a person's name the corpus actually holds, decided from
 * counts rather than from the spelling the asker typed. Pure — no I/O, no clock, no model.
 *
 * ## The rule this implements
 *
 * The rule answers the question the first live fan-out parked: when the person a question names is ambiguous in FREE TEXT — no
 * tag, a first name only, a possible misspelling, a nickname a thread uses — the bot-turn session runs a
 * short pre-planning step BEFORE the Haikus launch. It probes counts across name variants with the store
 * verbs, treats zero hits as the WRONG SPELLING rather than as absence and tries another, looks for
 * nicknames and alternative forms, and then sizes the leads on what those probes turn up. Good judgment,
 * no dumb rules. **Ids are never ambiguous**, so the step must not fire on one.
 *
 * ## What this module decides, and what it deliberately leaves to the session
 *
 * It decides **nothing about language**. There is no nickname table here, no edit-distance threshold, no
 * soundex, and no list of "names that look like first names" — every one of those is the dumb rule the
 * owner's ruling names, and each would misfire on the two cases that produced the ruling in the first place. The
 * variants come from the session's own judgment, read off the thread, the roster and the store; this
 * module probes what it is handed and reports what the counts say.
 *
 * It decides exactly two things, and both are the owner's words rather than a heuristic:
 *
 * - **An id is never ambiguous** ({@link looksLikeIdentifier}). The criterion is syntactic and closed —
 *   see that function — so the step cannot fire on `<@U0SYN1ABCDEF>`, an email address, a uuid, a `dd:` event
 *   or a URL. A false NEGATIVE here is harmless (the session simply gets a variant probe it did not need);
 *   a false positive would silently skip the step, which is why the criterion admits nothing fuzzy.
 * - **Zero rows at every rung is a spelling you have not found, not a person who is not there**
 *   ({@link judgeName}). That inversion is the whole ruling: the wave's own first dogfood sized every
 *   per-source slot off `barten`'s 48 `exact` rows, which are OTHER people, while the person it was sent
 *   to investigate sits under `barton` with 3,061.
 *
 * ## The two measurements that make it necessary
 *
 * Both MEASURED on a live store of a couple of million rows. The names are synthetic stand-ins for the
 * measured ones, so each command reproduces the probe's shape on any store, not these counts:
 *
 * | asked    | found under      | `exact` asked     | `exact` found | reproduce                                      |
 * | -------- | ---------------- | ----------------- | ------------- | ---------------------------------------------- |
 * | `barten` | `barton`        | dozens            | thousands     | `slopweaver store probe barten barton`        |
 * | `ada` | `aida loveless` | tens of thousands | a handful     | `slopweaver store probe ada 'aida loveless'` |
 *
 * The first is a near-miss spelling where the asked form is not empty at all — it is a DIFFERENT, larger
 * population, which is why "did it find anything" is not the test and the per-variant split is. The second
 * is a voice-to-text mangling: a meeting transcript renders Dr Ada Lovelace as "Doctor Aida Loveless", so
 * the record that answers the question carries neither the correct given name nor the correct surname, and
 * only a variant nobody would guess from the spelling reaches it.
 */
import { narrowestHit, type ProbeReport, type ProbeRow } from "../store/probe/result.js";
import { PROBE_SHAPES, type ProbeShape } from "../store/probe/shapes.js";

/**
 * How one probed form of a name came back.
 *
 * `absent` is the classification the ruling inverts: it means this SPELLING was not found, and it is never
 * evidence that the person was not found.
 *
 * @internal — a field type of {@link NameForm}; a caller reads the form, never the verdict alone.
 */
export type NameFormVerdict =
  /** Every rung of the ladder came back empty. Wrong spelling — try another form. */
  | "absent"
  /** The tsvector holds nothing but a substring rung does: the name lives inside emails, mentions or URLs. */
  | "lexeme-blind"
  /** The narrowest rung found rows. This form is a real seam. */
  | "carries";

/**
 * What the probe said about one form of the name.
 *
 * @internal — every member of {@link NameFinding}; a caller reads the finding, never a bare form.
 */
export interface NameForm {
  /** The form as it was probed, verbatim. */
  readonly form: string;
  /** Whether this is the spelling the question itself used. */
  readonly asked: boolean;
  /** Rows at the stemmed-word rung — the one that was measured sizing the first wave wrong. */
  readonly exact: number;
  /** The narrowest rung that found anything, or nothing when every rung was empty. */
  readonly narrowestShape: ProbeShape | null;
  /** Rows at that rung. Zero when nothing was found. */
  readonly narrowestRows: number;
  /** What the counts say about this form. */
  readonly verdict: NameFormVerdict;
}

/** What the pre-planning step came to for one name. */
export interface NameFinding {
  /** The name as the question wrote it. */
  readonly asked: string;
  /** Every form probed, the asked one first and the rest in the order the caller proposed them. */
  readonly forms: readonly NameForm[];
  /** The forms that found rows — what the leads are sized on. Empty when none did. */
  readonly carrying: readonly NameForm[];
  /** The forms that found nothing anywhere. Each is a spelling to replace, never a person to rule out. */
  readonly absent: readonly NameForm[];
  /**
   * The form carrying the strongest claim — narrowest rung first, then rows — when that is not the asked
   * spelling. {@link compareForms} is the ordering and carries why rows alone is the wrong one.
   *
   * This is the finding a detective needs in one line: the question said one thing and the corpus holds
   * another. `null` when the asked spelling is itself the strongest, or when nothing was found at all.
   */
  readonly carriedInstead: NameForm | null;
}

/**
 * Whether a term is an IDENTIFIER, which the owner's ruling puts outside this step entirely.
 *
 * The criterion is syntactic and closed — a term is an id when it contains a `://`, contains an `@`, is
 * bracketed as a Slack mention, is prefixed `dd:`, is a uuid, is nothing but digits (optionally `#`-led),
 * or is an upper-case token of nine characters or more that CARRIES A DIGIT (a Slack/GitHub object id).
 * Nothing here reasons about language, because an id is recognised by its SHAPE and a name is not
 * recognisable at all: the moment this function starts guessing whether a lowercase word is a person, it
 * has become the dumb rule the ruling forbids.
 *
 * A term this returns `false` for is not thereby a name — it is merely not provably an id, and the session
 * decides. **That asymmetry is the whole design**: the cost of running a variant probe on something that
 * was not a name is one extra probe, and the cost of skipping it on something that was is the wave the
 * first dogfood ran. The digit requirement on the last shape is that asymmetry applied to the one rule
 * that could break it — `^[A-Z0-9]{9,}$` alone calls `MACDONALD` and `ALEKSANDRA` ids, and a name typed in
 * caps would then SILENTLY skip the step, which is exactly the failure this whole path exists to close. A
 * digitless upper-case id is possible in principle and costs one wasted probe when it happens.
 *
 * @param term the name as the question wrote it
 * @returns true when the term is an id and the ambiguity step must not fire
 */
export function looksLikeIdentifier({ term }: { term: string }): boolean {
  const trimmed = term.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const shapes = [
    /:\/\//u, // any URL
    /@/u, // an email address, or a bare `@handle`
    /^<[@#!][^>]+>$/u, // a Slack mention, channel link or special mention
    /^dd:/u, // a Datadog event id, which the record verbs route on
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu, // a record uuid
    /^#?\d+$/u, // an issue, pull request or ticket number
    /^(?=[A-Z0-9]*\d)[A-Z0-9]{9,}$/u, // a Slack user, channel or file id — upper case AND carrying a digit
  ];
  return shapes.some((shape) => shape.test(trimmed));
}

/** What the name step will probe, and why it will not probe anything when it will not. */
export interface NameStepPlan {
  /** Every form to probe, the asked spelling first, deduplicated. Empty when the step does not run. */
  readonly forms: readonly string[];
  /** Why the step did not run, for a reader, or nothing when it did or was never asked for. */
  readonly skipped: string | null;
}

/**
 * Decide what the pre-planning name step probes, before any of it reaches the store.
 *
 * The ONE thing it refuses is an id, and it says so rather than silently doing nothing: an id is never
 * ambiguous, so probing variants of one would spend the step's whole budget proving
 * that `<@U0SYN1ABCDEF>` is not spelled three other ways.
 *
 * @param name the person the question names, as it wrote them, or nothing when no name step was asked for
 * @param variants the other forms the session's judgment proposed
 * @returns what to probe, or why nothing will be
 */
export function planNameForms({ name, variants }: { name: string | null; variants: readonly string[] }): NameStepPlan {
  if (name === null) {
    return { forms: [], skipped: null };
  }
  if (looksLikeIdentifier({ term: name })) {
    return {
      forms: [],
      skipped: `"${name}" is an id, and ids are never ambiguous — no variant probe was run. Probe it directly.`,
    };
  }
  const seen = new Set<string>();
  const forms: string[] = [];
  for (const raw of [name, ...variants]) {
    const form = raw.trim();
    if (form.length > 0 && !seen.has(form)) {
      seen.add(form);
      forms.push(form);
    }
  }
  return { forms, skipped: null };
}

/**
 * Classify one form's ladder.
 *
 * @param row that form's probe ladder
 * @param asked whether this form is the spelling the question used
 * @returns the form, classified
 */
function classifyForm({ row, asked }: { row: ProbeRow; asked: boolean }): NameForm {
  const narrowest = narrowestHit({ row });
  const exactCell = row.cells.find((cell) => cell.shape === "exact");
  const exact = exactCell === undefined ? 0 : exactCell.rows;
  if (narrowest === null) {
    return { asked, exact, form: row.subject, narrowestRows: 0, narrowestShape: null, verdict: "absent" };
  }
  const blind = exact === 0;
  return {
    asked,
    exact,
    form: row.subject,
    narrowestRows: narrowest.rows,
    narrowestShape: narrowest.shape,
    verdict: blind ? "lexeme-blind" : "carries",
  };
}

/**
 * Read a probe of a name's variants and say which spelling the corpus actually holds.
 *
 * The forms are taken from the probe REPORT rather than from a separate list, so a caller cannot report a
 * verdict on a form that was never probed. A form named in `forms` that the probe does not carry is
 * skipped rather than invented; a probe row for a subject the caller did not name is ignored, which is
 * what lets one probe serve both the question's own keywords and the name step.
 *
 * @param asked the name as the question wrote it
 * @param forms every form probed, including the asked one, in the order to report them
 * @param probe the ladder for all of them
 * @returns the finding, with the empty forms named as spellings rather than as absences
 */
export function judgeName({
  asked,
  forms,
  probe,
}: {
  asked: string;
  forms: readonly string[];
  probe: ProbeReport;
}): NameFinding {
  const bySubject = new Map(probe.rows.map((row) => [row.subject, row]));
  const classified = forms.flatMap((form) => {
    const row = bySubject.get(form);
    if (row === undefined) {
      return [];
    }
    return [classifyForm({ asked: form === asked, row })];
  });
  const carrying = classified.filter((form) => form.verdict !== "absent");
  const askedForm = classified.find((form) => form.asked);
  const strongest = carrying.toSorted((left, right) => compareForms({ left, right }))[0];
  const askedIsStrongest = strongest === undefined || strongest.form === askedForm?.form;
  return {
    absent: classified.filter((form) => form.verdict === "absent"),
    asked,
    carriedInstead: askedIsStrongest ? null : strongest,
    carrying,
    forms: classified,
  };
}

/**
 * How narrow a form's own best rung is, as a position in the ladder. A form with no rung at all sorts last.
 *
 * @param shape the narrowest rung that found rows, or nothing when none did
 * @returns the rung's position, narrowest lowest
 */
function rungIndex({ shape }: { shape: ProbeShape | null }): number {
  if (shape === null) {
    return PROBE_SHAPES.length;
  }
  return PROBE_SHAPES.indexOf(shape);
}

/**
 * Which of two forms is the stronger claim about where the person lives: NARROWEST RUNG FIRST, then rows.
 *
 * Rows alone is the reading this started with and it is wrong, because two forms' `narrowestRows` are
 * counted at DIFFERENT rungs. On a keyword carrying no punctuation the widest rungs nearly reduce to
 * containment — `barten` measures `exact` 48 against `wild-both` 3,142 — so a rows-only comparison would
 * take a correct `exact` 3,061 and announce that the corpus "holds this person under" the near-miss
 * spelling whose only advantage is a substring match. A form that only wins at a wider rung has not won:
 * it has matched more text.
 *
 * **A TIE goes to the asked spelling**, and that too is a measured correction rather than a nicety. The
 * store's matching is case-insensitive, so `--name MACDONALD --variant macdonald` measures 56 rows at
 * `exact` on both, and a name-ordered tiebreak then printed "The corpus holds this person under macdonald,
 * not under MACDONALD" — a substitution that substitutes nothing, in the voice of a finding. The asked
 * spelling is only ever displaced by a form that actually beat it.
 *
 * @param left one carrying form
 * @param right the other
 * @returns the comparison, strongest first
 */
function compareForms({ left, right }: { left: NameForm; right: NameForm }): number {
  const leftRung = rungIndex({ shape: left.narrowestShape });
  const rightRung = rungIndex({ shape: right.narrowestShape });
  if (leftRung !== rightRung) {
    return leftRung - rightRung;
  }
  if (left.narrowestRows !== right.narrowestRows) {
    return right.narrowestRows - left.narrowestRows;
  }
  if (left.asked !== right.asked) {
    return left.asked ? -1 : 1;
  }
  return left.form.localeCompare(right.form);
}

/**
 * The name step's own lines, read by the session that plans the wave AND by every detective in it.
 *
 * One renderer for both readers on purpose: the finding a detective most needs is the one the planner most
 * needs, and two wordings of "the population is under a different spelling" is how one of them ends up
 * saying something weaker than the other.
 *
 * @param finding what the variant probe came to
 * @returns the lines, or nothing at all when no name step ran
 */
export function nameFindingLines({ finding }: { finding: NameFinding | null }): readonly string[] {
  if (finding === null) {
    return [];
  }
  const rows = finding.forms.map((form) => {
    const where =
      form.narrowestShape === null ? "nothing at any rung" : `${String(form.narrowestRows)} at ${form.narrowestShape}`;
    const mark = form.asked ? " (as asked)" : "";
    return `  - "${form.form}"${mark}: ${where}, exact ${String(form.exact)} — ${form.verdict}`;
  });
  return [
    `## The name "${finding.asked}" was probed across ${String(finding.forms.length)} form(s) before this wave was sized`,
    "",
    ...rows,
    "",
    ...verdictLines({ finding }),
  ];
}

/**
 * The sentences that tell a reader what to DO about the forms above.
 *
 * @param finding what the variant probe came to
 * @returns one to three lines, never an empty list
 */
function verdictLines({ finding }: { finding: NameFinding }): readonly string[] {
  if (finding.carrying.length === 0) {
    return [
      "**Every form probed came back empty at every rung. That is a spelling nobody has found yet, NOT a",
      "person who is not there**. Propose another form before you believe an absence:",
      "a surname on its own, the other spelling of a near-miss, a nickname the thread uses, and the shape a",
      "voice-to-text transcript would have made of it — `ada` was rendered `aida loveless` in this very",
      "corpus. `store groups --facet author` on a form that DOES carry is how a nickname gets found.",
    ];
  }
  const instead = finding.carriedInstead;
  if (instead === null) {
    return [
      "The spelling the question used is the one the corpus holds. No other form probed beat it at a rung",
      "as narrow, so the leads below are sized on the asked spelling and a variant is not where it hides.",
    ];
  }
  return [
    `**The corpus holds this person under "${instead.form}", not under "${finding.asked}".** ${String(instead.narrowestRows)} row(s) at`,
    `${String(instead.narrowestShape)} against the asked spelling's own count above, so the leads below are sized on what the`,
    "probes turned up rather than on what the asker typed. Rows matching the asked spelling may well be",
    "OTHER PEOPLE — say so in your report rather than folding them in.",
  ];
}
