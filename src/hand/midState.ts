/**
 * A seat's honest mid-investigation report, and the one criterion that decides whether it reaches the owner PUSHED.
 *
 * ## Why this exists
 *
 * The owner wants to hear early when work is neither done nor blocked: the docs were followed, the problem was
 * debugged and cross-checked with Codex, and something observed in reality does not line up with the documented
 * behaviour, with no known reason. An honest "I don't know why" is a fine report, and a fact behind a permission
 * wall is surfaced as the access to ask for and from whom. The line between a pushed floating note and a Queue
 * card the owner only reads when they go looking is URGENCY, not "a human could help":
 *
 * - a subscription nobody can say is still used, no deadline: it just goes to the queue;
 * - the same subscription renewing tomorrow for twelve thousand dollars: something might be about to break while
 *   there is still a chance to fix it — a note;
 * - a GitHub Actions runner outage, the team blocked, an access ask mid-investigation: pushed to the owner, not
 *   pulled by them — a note;
 * - every seat waiting on one decision of the owner's: fleet capacity stays maxed at all times — a note;
 * - one seat needing a design pick it could leave while it does other work: Queue, and the seat parks — EXCEPT
 *   when the owner has said they are keen to see those designs: excitement is not urgency, but a wanted
 *   floating note is still a note;
 * - a new steer while every seat is busy: no automatic pause; pausing needs the owner's explicit word.
 *
 * The criterion is risk-based: look at what could go wrong either way. Not telling the owner risks something
 * really bad and a "why didn't you tell me?"; telling them risks only a get-that-out-of-the-way, far less of a
 * problem. So when the two are close, surface: `close-call`, carrying what could go wrong unsaid. A send
 * blocked on something only the owner can do is told early, even for a low-priority item, and a floating note
 * in front of them is fine for a sign-in: `blocked-send`. The floor is to bring the owner only what is worth
 * their knowing and their attention; and a steer of theirs left undone for days is the failure they most want
 * gone, so a steer the fleet cannot act on is itself worth investigating and surfacing — a `close-call` whose
 * silence risks exactly that.
 *
 * So the urgency is a closed union a seat must pick, each note kind carrying what makes it one, and
 * {@link midStateRoute} is total over it. `none` claims silence risks nothing bad and the owner has not asked to
 * see it, and is the one kind that does not push.
 *
 * ## What it composes, and what it never does
 *
 * Every report becomes a SHAPED `handover register --finding` row: a Queue card with no run behind it
 * (`skills/handover/reference/registered-ask-queue.md`), so the investigation keeps running — `handover ask` would
 * pause it. A note route adds a `hand post` line for the chair, checked here by the real {@link buildHandStep} and
 * {@link postingRefusal} as `./adcSignin.ts` does, so the chair's post is admitted by construction. Only the chair
 * posts a note (`./seatPost.ts`); this module runs nothing and posts nothing.
 *
 * Pure: no clock, no filesystem.
 */
import { err, ok, type Result } from "#lib/result.js";

import { askShapeProblems, parseAskOptions } from "../handover/askShape.js";
import { cardAlignmentProblems } from "../handover/cardAlignment.js";
import { isSafeSlug } from "../handover/runStore.js";

import type { CheckedPostLine } from "./checkedPost.js";
import { DETAIL_LINE_CAP, DETAILS_MAX } from "./details.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import { midStateNoteCommand, midStateQueueCommand } from "./midStateCommands.js";
import type { HandContext } from "./step.js";

/** `parseFlags` reads a string flag's value opening with `--` as a missing value, so a printed line would not parse. */
const FLAG_LIKE_WHY = "opens with --, which the printed command's own flag parser reads as a missing value";

/** A named piece of access the fleet lacks, who holds it, and what it would settle. */
export interface MidStateAccess {
  /** The exact access, e.g. "read on the acme org's Actions runner settings". */
  readonly what: string;
  /** The person who can grant it or fetch the page, by name. */
  readonly holder: string;
  /** Which open question it would answer or rule out. */
  readonly wouldSettle: string;
}

/**
 * How urgent the report is for the owner — the closed set the worked examples drew. Each note kind carries `noteWhat`, the one
 * sentence the note leads with, because a note is a step only the owner's hands can take, never "this is struggling".
 */
export type MidStateUrgency =
  | { readonly kind: "breaking"; readonly breaks: string; readonly by: string; readonly noteWhat: string }
  | { readonly kind: "blocked-send"; readonly send: string; readonly noteWhat: string }
  | { readonly kind: "fleet-idle"; readonly noteWhat: string }
  | { readonly kind: "keen"; readonly noteWhat: string }
  | { readonly kind: "close-call"; readonly ifSilent: string; readonly noteWhat: string }
  | { readonly kind: "none" };

/** Every urgency kind, in the order the usage text names them. */
export const MID_STATE_URGENCIES = ["breaking", "blocked-send", "fleet-idle", "keen", "close-call", "none"] as const;

/**
 * The Queue card's shape, as a seat typed it — validated by the same rules `handover register` applies.
 *
 * @internal
 */
export interface MidStateDecision {
  /** The question in full, kept for the thread and the journal. */
  readonly question: string;
  readonly problem: string;
  /** Two to four `<what the owner could do> :: <what that costs>` lines. */
  readonly optionsText: string;
  readonly lean: string;
  readonly risk: string;
  readonly blastRadius: string;
  readonly stillReal: string;
  /** What was observed — permalinks, PR refs, log lines. Each becomes one `--evidence` entry. */
  readonly evidence: readonly string[];
  /** The seat that observed it. */
  readonly observedBy: string;
}

/** One honest mid-investigation report. */
export interface MidStateReport {
  /** The board row the investigation runs under. */
  readonly row: string;
  /** The NEW Queue row's slug — distinct per report, so a second report never collides with the first. */
  readonly askSlug: string;
  readonly tried: readonly string[];
  /** The documentation followed, as addresses or titles. */
  readonly docs: readonly string[];
  /** What the docs say should happen. */
  readonly documented: string;
  /** What actually happens. */
  readonly observed: string;
  /** What the Codex cross-check concluded. */
  readonly codex: string;
  /** The honest why — "I do not know why" is a whole, accepted answer. */
  readonly why: string;
  /** A parallel escalation offered as a hedge, e.g. emailing the vendor's support now. */
  readonly hedge?: string;
  readonly access?: MidStateAccess;
  readonly urgency: MidStateUrgency;
  readonly decision: MidStateDecision;
  readonly context: HandContext;
  /** The seat sending it, as `hand post --by-session` records it. */
  readonly bySession?: string;
}

/** Where the report goes, and the sentence saying why. */
export interface MidStateRoute {
  readonly kind: "note" | "queue";
  readonly reason: string;
}

/** Everything `hand surface` prints. */
export interface MidStateSurface {
  readonly route: MidStateRoute;
  readonly report: string;
  /** The seat runs this itself: the Queue card, every route. */
  readonly queue: CheckedPostLine;
  /** The seat sends this ONE line to the chair: present only on a note route. */
  readonly note?: CheckedPostLine;
}

/**
 * The criterion, risk-based: a note when something may break while the owner's act can still change it, when a send the
 * owner approved is stopped on a step only the owner can take, when seats idle on the owner, when the owner said they are keen to see it, or when
 * silence risks something comparable to the cost of telling them; the Queue only when silence risks nothing bad and
 * the owner has not asked to see it.
 *
 * @param urgency the seat's pick from the closed set
 * @returns the route and the sentence the report prints for it
 */
export function midStateRoute({ urgency }: { urgency: MidStateUrgency }): MidStateRoute {
  switch (urgency.kind) {
    case "breaking":
      return {
        kind: "note",
        reason: `pushed as a floating note: ${urgency.breaks} by ${urgency.by}, and the owner's act can still change it`,
      };
    case "blocked-send":
      return {
        kind: "note",
        reason: `pushed as a floating note: ${urgency.send} is stopped on a step only the owner can take, told early even when low priority`,
      };
    case "fleet-idle":
      return { kind: "note", reason: "pushed as a floating note: seats sit idle until the owner answers" };
    case "keen":
      return { kind: "note", reason: "pushed as a floating note: the owner said they are keen to see this" };
    case "close-call":
      return {
        kind: "note",
        reason: `pushed as a floating note: unsaid, ${urgency.ifSilent}; when the two risks are close, surface`,
      };
    case "none":
      return {
        kind: "queue",
        reason:
          "Queue only: silence risks nothing bad — nothing breaks, no send waits on the owner, no seat idles and the owner has " +
          "not asked to see it — so the seat parks this thread and takes other steered work",
      };
    default: {
      const unreachable: never = urgency;
      return unreachable;
    }
  }
}

/**
 * Every way one report field breaks its cap, as the first refusal.
 *
 * @param field the flag the value came from
 * @param value the text
 * @returns the refusal, or `undefined` when the field is one non-empty line inside the cap
 */
function textProblem({ field, value }: { field: string; value: string }): HandStepError | undefined {
  if (value.trim().length === 0) {
    return HandStepErrors.invalidField({ field, why: "is empty" });
  }
  if (value.includes("\n")) {
    return HandStepErrors.invalidField({ field, why: "is more than one line" });
  }
  if (value.startsWith("--")) {
    return HandStepErrors.invalidField({ field, why: FLAG_LIKE_WHY });
  }
  if (value.length > DETAIL_LINE_CAP) {
    return HandStepErrors.invalidField({
      field,
      why: `is ${String(value.length)} characters, past the ${String(DETAIL_LINE_CAP)} one line may carry`,
    });
  }
  return undefined;
}

/**
 * Every way a list field breaks its bounds, as the first refusal.
 *
 * @param field the repeatable flag the values came from
 * @param values the entries
 * @returns the refusal, or `undefined` when there are one to {@link DETAILS_MAX} well-formed entries
 */
function listProblem({ field, values }: { field: string; values: readonly string[] }): HandStepError | undefined {
  if (values.length === 0) {
    return HandStepErrors.invalidField({ field, why: "needs at least one entry" });
  }
  if (values.length > DETAILS_MAX) {
    return HandStepErrors.invalidField({
      field,
      why: `has ${String(values.length)} entries, past the ${String(DETAILS_MAX)} a report carries`,
    });
  }
  return values.map((value) => textProblem({ field, value })).find((problem) => problem !== undefined);
}

/**
 * The first malformed field of a report, checked in the order the report prints.
 *
 * @param report the seat's report
 * @returns the refusal, or `undefined` when every field is well-formed
 */
function reportProblem({ report }: { report: MidStateReport }): HandStepError | undefined {
  for (const [field, slug] of [
    ["row", report.row],
    ["ask-slug", report.askSlug],
  ] as const) {
    if (!isSafeSlug({ slug })) {
      return HandStepErrors.invalidField({ field, why: `"${slug}" is not a board row slug` });
    }
  }
  if (report.askSlug === report.row) {
    return HandStepErrors.invalidField({
      field: "ask-slug",
      why: "names the investigation's own row; a report is a NEW Queue row, so the investigation keeps running",
    });
  }
  const { decision, urgency } = report;
  const texts: readonly (readonly [string, string | undefined])[] = [
    ["documented", report.documented],
    ["observed", report.observed],
    ["codex", report.codex],
    ["why", report.why],
    ["hedge", report.hedge],
    ["access", report.access?.what],
    ["holder", report.access?.holder],
    ["would-settle", report.access?.wouldSettle],
    ["question", decision.question],
    ["observed-by", decision.observedBy],
    ["by-session", report.bySession],
    ["breaks", urgency.kind === "breaking" ? urgency.breaks : undefined],
    ["by", urgency.kind === "breaking" ? urgency.by : undefined],
    ["send", urgency.kind === "blocked-send" ? urgency.send : undefined],
    ["if-silent", urgency.kind === "close-call" ? urgency.ifSilent : undefined],
    ["note-what", urgency.kind === "none" ? undefined : urgency.noteWhat],
  ];
  const problems = [
    listProblem({ field: "tried", values: report.tried }),
    listProblem({ field: "doc", values: report.docs }),
    ...texts.map(([field, value]) => (value === undefined ? undefined : textProblem({ field, value }))),
    listProblem({ field: "evidence", values: decision.evidence }),
  ];
  const first = problems.find((problem) => problem !== undefined);
  if (first !== undefined) {
    return first;
  }
  const comma = decision.evidence.find((entry) => entry.includes(","));
  if (comma !== undefined) {
    return HandStepErrors.invalidField({
      field: "evidence",
      why: `"${comma}" carries a comma, and \`handover register --evidence\` splits on one — pass it as its own entry`,
    });
  }
  return shapeProblem({ decision });
}

/**
 * The Queue card's shape problems, by the rules `handover register` itself applies.
 *
 * @param decision the seat's shape
 * @returns the refusal naming every broken rule, or `undefined` when the shape is well-formed
 */
function shapeProblem({ decision }: { decision: MidStateDecision }): HandStepError | undefined {
  const flagLike = (
    [
      ["problem", decision.problem],
      ["options", decision.optionsText.trim()],
      ["lean", decision.lean],
      ["risk", decision.risk],
      ["blast-radius", decision.blastRadius],
      ["still-real", decision.stillReal],
    ] as const
  ).find(([, value]) => value.startsWith("--"));
  if (flagLike !== undefined) {
    return HandStepErrors.invalidField({ field: flagLike[0], why: FLAG_LIKE_WHY });
  }
  const parsed = parseAskOptions({ text: decision.optionsText });
  const problems = [
    ...parsed.problems,
    ...askShapeProblems({
      shape: {
        lean: decision.lean,
        options: parsed.options,
        problem: decision.problem,
        stakes: { blastRadius: decision.blastRadius, risk: decision.risk, stillReal: decision.stillReal },
      },
    }),
  ];
  if (problems.length > 0) {
    return HandStepErrors.invalidField({ field: "the Queue card's shape", why: problems.join("; ") });
  }
  const unaligned = cardAlignmentProblems({ question: decision.question });
  if (unaligned.length === 0) {
    return undefined;
  }
  return HandStepErrors.invalidField({ field: "question", why: unaligned.join("; ") });
}

/**
 * The honest report, in the fixed order the owner reads it: what was tried, against what the docs say, what is still
 * unknown, what is offered in parallel, what access would settle it, and where it went.
 *
 * @param report the seat's report
 * @returns the markdown block the seat writes to its row and sends the chair
 */
export function midStateReportMarkdown({ report }: { report: MidStateReport }): string {
  const route = midStateRoute({ urgency: report.urgency });
  const lines = [
    `## Mid-investigation: ${report.row}`,
    "",
    "- **Tried:**",
    ...report.tried.map((entry) => `  - ${entry}`),
    "- **Docs followed:**",
    ...report.docs.map((entry) => `  - ${entry}`),
    `- **The docs say:** ${report.documented}`,
    `- **What happens instead:** ${report.observed}`,
    `- **Codex cross-check:** ${report.codex}`,
    `- **Why:** ${report.why}`,
    ...(report.hedge === undefined ? [] : [`- **In parallel:** ${report.hedge}`]),
    ...(report.access === undefined
      ? []
      : [
          `- **Access that would settle it:** ${report.access.what}, held by ${report.access.holder} — ` +
            report.access.wouldSettle,
        ]),
    `- **Route:** ${route.reason}`,
  ];
  return lines.join("\n");
}

/**
 * Check a report and compose everything `hand surface` prints: the route, the report, the Queue command, and on a
 * note route the chair's checked `hand post` line.
 *
 * @param report the seat's report
 * @returns the surface, or the first field or posting rule it breaks
 */
export function buildMidStateSurface({ report }: { report: MidStateReport }): Result<MidStateSurface, HandStepError> {
  const problem = reportProblem({ report });
  if (problem !== undefined) {
    return err(problem);
  }
  const route = midStateRoute({ urgency: report.urgency });
  const surface = { queue: midStateQueueCommand({ report }), report: midStateReportMarkdown({ report }), route };
  const { urgency } = report;
  if (urgency.kind === "none") {
    return ok(surface);
  }
  return midStateNoteCommand({ report, urgency }).map((note) => ({ ...surface, note }));
}
