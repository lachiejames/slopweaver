/**
 * One recorded DAY as one briefing section — the five notes a rollup is made of, and nothing else.
 *
 * Split out of `./narrative.ts` because the two answer different questions and the pair had grown past the
 * length at which a reader holds a file in their head (the `file-size-ratchet` gate's own reasoning). That
 * file decides WHICH recorded things reach the page and proves none was dropped; this one decides how a day
 * READS once they have. The seam is real rather than arbitrary: everything here takes atoms already chosen
 * and returns notes, so it can be read without holding the conservation argument in mind at all.
 *
 * ## Five notes, in a fixed order, because thirty is the ceiling
 *
 * `./caps.ts`'s `SECTION_MAX_NOTES` is thirty and a Melbourne day holds up to seventy-two recorded passes, so
 * a note per pass would refuse the page outright most afternoons. Each note is a CATEGORY instead — sources,
 * the owner's words, other landings, what was done, what was judged — and carries every atom of its category.
 * The first two are always present, because "no source was read" and "the owner said nothing" are real states the page
 * has to be able to say; the last three appear only when the day recorded one.
 *
 * ## Every fold here is QUOTED, and every headline is not
 *
 * Each of these notes carries `lane: "quoted"`, because what is behind the fold is recorded text nobody here
 * composed — the owner's own turns, another verb's own line, a work item's own title. That lane lifts the four rules
 * written for a composer (`../outbound/briefing/types.ts`). What this file COMPOSES — every headline, every
 * fold summary, the day's own summary — is gated like any other cell, so what the owner meets before opening
 * anything is still held to the plain-wording rule.
 *
 * Pure: recorded rows and already-chosen atoms in, notes out. No clock, no filesystem, no `Result` — every
 * decision that can fail was made before anything got here.
 */
import type { BriefingContent, BriefingInline, BriefingNote, BriefingSection } from "../outbound/briefing/types.js";
import type {
  FleetLanding,
  SupervisorJudgement,
  SupervisorTickAction,
  SupervisorTickRow,
} from "../supervisor/tickTypes.js";
import type { NarrativeAtomRef, PlacedLanding, PlacedTurn } from "./narrative.js";
import { narrativeSourceLines } from "./narrativeSources.js";
import { linkifyRowText, rowRefContext } from "./yourList.js";

/** One note, carried together with every atom it rendered — see the file overview on conservation. */
export interface TracedNote {
  readonly note: BriefingNote;
  readonly rendered: readonly NarrativeAtomRef[];
}

/**
 * One plain-text run.
 *
 * @returns the run, ready to sit in a cell's ordered list
 * @internal — read by this module and its own tests; the projection composes through the note builders.
 */
export function say({ text }: { text: string }): BriefingInline {
  return { kind: "text", text };
}

/**
 * A recorded turn's own instant, or the plain phrase for one the chain walk could not date.
 *
 * Its own function rather than a conditional inside the sentence: `null` here is a real reading — the turn
 * was seen but carries no instant — and a coalesce would read as a default rather than as that fact.
 *
 * @param instantIso the recorded instant, `null` when the read could not date the turn
 * @returns the phrase the item opens with
 * @internal — read by this module and its own tests.
 */
function instantOrNone({ instantIso }: { instantIso: string | null }): string {
  if (instantIso === null) {
    return "no instant recorded";
  }
  return instantIso;
}

/**
 * A number as the page prints it, so every count in a rollup is spelled the same way.
 *
 * @returns the number as text
 * @internal — read by this module, `./narrative.ts` and their own tests.
 */
export function count({ value }: { value: number }): string {
  return String(value);
}
/**
 * How one landing reads, with its own address as a LINK rather than as text shaped like a reference.
 *
 * Shared with `./narrative.ts`, which renders the newest pass's landings into `recent` while this file
 * renders every other one into the day's rollup — one spelling, so the same landing cannot read two ways
 * depending on which section a reader meets it in.
 *
 * @param landing the recorded landing, a merged pull request or a settled handover
 * @returns the runs a reader meets
 * @internal — read by this module, `./narrative.ts` and their own tests.
 */
export function landingContent({ landing }: { landing: FleetLanding }): BriefingContent {
  if (landing.kind === "pull-request") {
    return [
      { kind: "link", text: `${landing.repo}#${count({ value: landing.number })} ${landing.title}`, url: landing.url },
      say({ text: ` landed ${landing.landedAtIso}, merge ` }),
      { kind: "code", text: landing.mergeCommitSha },
    ];
  }
  return [
    say({ text: `${landing.label} (${landing.slug}) finished ${landing.landedAtIso}, witness ` }),
    { kind: "code", text: landing.witness },
  ];
}
/**
 * The SOURCES note: every one of the twelve readings the newest pass of this day took.
 *
 * The newest pass of the day rather than all of them, and the reason is the rule the arms encode: a source
 * that failed at four o'clock has failed, and showing this morning's good reading beside it would let the
 * page report a fleet nobody has looked at since. The day's read/partly-read/not-read counts go in the
 * headline so what the newest pass could not see is visible before the fold opens.
 *
 * @param ticks the day's rows, oldest first
 * @returns the note; it renders no atoms, since a source's own facts are not atoms
 */
function sourcesNote({ ticks }: { ticks: readonly SupervisorTickRow[] }): BriefingNote {
  const newest = ticks[ticks.length - 1]!;
  const lines = narrativeSourceLines({ sources: newest.sources });
  const tally = ({ status }: { status: string }): number => lines.filter((line) => line.status === status).length;
  return {
    detail: {
      blocks: [{ items: lines.map((line) => line.content), kind: "list", ordered: false }],
      summary: "every reading, in the order they were taken",
    },
    headline: [
      say({
        text:
          `${count({ value: tally({ status: "read" }) })} of ${count({ value: lines.length })} sources read, ` +
          `${count({ value: tally({ status: "partial" }) })} read in part, ${count({ value: tally({ status: "unavailable" }) })} not read ` +
          `at all, as of ${newest.finalisedIso}`,
      }),
    ],
    lane: "quoted",
  };
}

/**
 * The owner's-words note: every turn of the owner's this day recorded, exactly as typed.
 *
 * `lane: "quoted"` is what makes that true rather than aspirational — see the file overview. The metadata
 * around each turn is composed here and gated normally; the turn's own text is one run of the owner's own.
 *
 * @param turns every turn kept for this day, in reading order
 * @param omittedHere how many repeat observations this day's turns account for
 * @param ticks the day's rows, so the note can state how the READ itself went
 * @returns the note and the atoms it rendered
 */
function turnsNote({
  turns,
  omittedHere,
  ticks,
}: {
  turns: readonly PlacedTurn[];
  omittedHere: number;
  ticks: readonly SupervisorTickRow[];
}): TracedNote {
  const statuses = ticks.map((row) => row.ownerTurns.status);
  const tally = ({ status }: { status: string }): number => statuses.filter((one) => one === status).length;
  const diagnostics = ticks.flatMap((row) =>
    row.ownerTurns.status === "read" || row.ownerTurns.diagnostic === undefined ? [] : [row.ownerTurns.diagnostic],
  );
  const items = turns.map((placed): BriefingContent => {
    const context = rowRefContext({ repoSlug: undefined, where: placed.turn.pointer });
    const when = instantOrNone({ instantIso: placed.turn.instantIso });
    const position =
      placed.turn.transcriptLineNumber === null
        ? "no transcript position"
        : `line ${count({ value: placed.turn.transcriptLineNumber })}`;
    return [
      say({ text: `${when} · ${placed.turn.sessionId} · ${position} · via ${placed.turn.source} — ` }),
      ...linkifyRowText({ context, text: placed.turn.text }),
    ];
  });
  return {
    note: {
      detail: {
        blocks: [
          {
            items: items.length === 0 ? [[say({ text: "nothing was recorded from you this day" })]] : items,
            kind: "list",
            ordered: false,
          },
          ...(diagnostics.length === 0
            ? []
            : [
                {
                  content: [say({ text: `what the reads could not reach: ${diagnostics.join("; ")}` })],
                  kind: "para" as const,
                },
              ]),
        ],
        summary: "each one, exactly as you typed it",
      },
      headline: [
        say({
          text:
            `${count({ value: turns.length })} thing(s) you said, ` +
            `${count({ value: omittedHere })} repeat observation(s) not shown again; ` +
            `${count({ value: tally({ status: "read" }) })} read, ${count({ value: tally({ status: "partial" }) })} read in part, ` +
            `${count({ value: tally({ status: "unavailable" }) })} not read`,
        }),
      ],
      lane: "quoted",
    },
    rendered: turns.map((placed) => placed.ref),
  };
}

/**
 * The LANDINGS note, carrying every landing of this day that `recent` is not already showing.
 *
 * @param landings the day's kept landings
 * @param inRecent the atom keys `recent` already rendered
 * @returns the note and its atoms, or nothing when `recent` covers them all
 */
function landingsNote({
  landings,
  inRecent,
}: {
  landings: readonly PlacedLanding[];
  inRecent: ReadonlySet<string>;
}): readonly TracedNote[] {
  const rest = landings.filter((placed) => !inRecent.has(placed.ref.key));
  if (rest.length === 0) {
    return [];
  }
  return [
    {
      note: {
        detail: {
          blocks: [
            { items: rest.map((placed) => landingContent({ landing: placed.landing })), kind: "list", ordered: false },
          ],
          summary: "each one, with where it landed",
        },
        headline: [say({ text: `${count({ value: rest.length })} other thing(s) landed on this day` })],
        lane: "quoted",
      },
      rendered: rest.map((placed) => placed.ref),
    },
  ];
}

/** One action, paired with the atom it came from. */
export interface PlacedAction {
  readonly ref: NarrativeAtomRef;
  readonly action: SupervisorTickAction;
}

/** One judgement, paired with the atom it came from. */
export interface PlacedJudgement {
  readonly ref: NarrativeAtomRef;
  readonly judgement: SupervisorJudgement;
}

/**
 * The ACTIONS note: what the passes of this day actually did, in the order they recorded it.
 *
 * Never deduplicated and never omitted, unlike a turn or a landing: two passes taking the same action on the
 * same subject is two acts, and collapsing them would report one.
 *
 * @param actions the day's actions, in reading order
 * @returns the note and its atoms, or nothing when the day recorded none
 */
function actionsNote({ actions }: { actions: readonly PlacedAction[] }): readonly TracedNote[] {
  if (actions.length === 0) {
    return [];
  }
  return [
    {
      note: {
        detail: {
          blocks: [
            {
              items: actions.map((placed): BriefingContent => [
                say({
                  text:
                    `${placed.action.kind} on ${placed.action.subject.label} (${placed.action.subject.kind} ` +
                    `${placed.action.subject.id}) — ${placed.action.outcome} at ${placed.action.recordedIso}` +
                    `${placed.action.detail === undefined ? "" : `; ${placed.action.detail}`} · witness ` +
                    `${placed.action.witness.kind} `,
                }),
                { kind: "code", text: placed.action.witness.ref },
              ]),
              kind: "list",
              ordered: false,
            },
          ],
          summary: "each one, with what it was about and how it went",
        },
        headline: [say({ text: `${count({ value: actions.length })} thing(s) done on this day` })],
        lane: "quoted",
      },
      rendered: actions.map((placed) => placed.ref),
    },
  ];
}

/**
 * The JUDGEMENTS note: every claim a pass made that no reading of a source could have produced.
 *
 * Each item OPENS with a visible label, because that is the whole point of recording them separately: a
 * cross-source inference reads exactly like a measurement once it is on the page, and the owner has to be able to
 * tell which one they are looking at without opening anything.
 *
 * @param judgements the day's judgements, in reading order
 * @returns the note and its atoms, or nothing when the day recorded none
 */
function judgementsNote({ judgements }: { judgements: readonly PlacedJudgement[] }): readonly TracedNote[] {
  if (judgements.length === 0) {
    return [];
  }
  return [
    {
      note: {
        detail: {
          blocks: [
            {
              items: judgements.map((placed): BriefingContent => [
                { kind: "strong", text: "Judgement — " },
                say({
                  text:
                    `${placed.judgement.claim} (${placed.judgement.kind} on ${placed.judgement.subject.label}, ` +
                    `${placed.judgement.subject.kind} ${placed.judgement.subject.id}); not measured because ` +
                    `${placed.judgement.whyNotDerived}; recorded ${placed.judgement.recordedIso} · witness ` +
                    `${placed.judgement.witness.kind} `,
                }),
                { kind: "code", text: placed.judgement.witness.ref },
              ]),
              kind: "list",
              ordered: false,
            },
          ],
          summary: "each one, with why it is a call rather than a reading",
        },
        headline: [
          say({
            text:
              `${count({ value: judgements.length })} call(s) made on this day that no reading produced — ` +
              "a call is a conclusion drawn across sources rather than something one of them said",
          }),
        ],
        lane: "quoted",
      },
      rendered: judgements.map((placed) => placed.ref),
    },
  ];
}

/** Everything one day's rollup is built from, after deduplication across the whole window. */
export interface DayInput {
  readonly dayKey: string;
  readonly ticks: readonly SupervisorTickRow[];
  readonly turns: readonly PlacedTurn[];
  readonly landings: readonly PlacedLanding[];
  /** Every act the day recorded, already paired with its atom by `./narrative.ts`. */
  readonly actions: readonly PlacedAction[];
  /** Every call the day recorded, already paired with its atom. */
  readonly judgements: readonly PlacedJudgement[];
  readonly turnsOmittedHere: number;
  readonly inRecent: ReadonlySet<string>;
  /** The disclosure the OLDEST visible day carries, so the page states what the window did not read. */
  readonly tail: string | undefined;
}

/**
 * One local day as exactly one section: at most five notes, in a fixed order.
 *
 * Five categorical notes rather than one per pass — see the file overview on `SECTION_MAX_NOTES`. The first
 * two are always present, because "no source was read" and "the owner said nothing" are real states the page has
 * to be able to say; the last three appear only when the day recorded one.
 *
 * @param input the day's rows and its share of the deduplicated atoms
 * @returns the section and every atom its notes rendered
 */
export function projectDay({ input }: { input: DayInput }): {
  readonly section: BriefingSection;
  readonly rendered: readonly NarrativeAtomRef[];
} {
  const turns = turnsNote({ omittedHere: input.turnsOmittedHere, ticks: input.ticks, turns: input.turns });
  const traced: readonly TracedNote[] = [
    { note: sourcesNote({ ticks: input.ticks }), rendered: [] },
    turns,
    ...landingsNote({ inRecent: input.inRecent, landings: input.landings }),
    ...actionsNote({ actions: input.actions }),
    ...judgementsNote({ judgements: input.judgements }),
  ];
  return {
    rendered: traced.flatMap((one) => one.rendered),
    section: {
      notes: traced.map((one) => one.note),
      summary:
        `${input.dayKey} — ${count({ value: input.ticks.length })} recorded pass(es)` +
        `${input.tail === undefined ? "" : `; ${input.tail}`}`,
    },
  };
}
