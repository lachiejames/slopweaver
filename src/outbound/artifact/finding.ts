/**
 * The `finding` form: ONE issue an investigation found, as a card the owner can forward into a team channel as it is.
 *
 * ## The ruling
 *
 * The `datadog-regression-hunt-daily` reply bundled five leads into one thread answer and ended by asking which
 * to share, leaving the customer-facing impact of each unclear and forcing a reader to ignore most of it before
 * sharing into a team channel. A post shows one thing, and several findings are several posts.
 *
 * So a finding is one issue per post, and the form refuses one that does not say how bad it is for the person
 * using the product (`impact`), how many of them it reached (`blastRadius`), which environment it is in (`env`),
 * when it started (`introduced`), where the team's tracker was searched (`tracking`), where earlier reports
 * were searched (`priorThread`) and what could be done about it (`options`). The priority is DERIVED from the first two by `./findingPriority.ts` and never typed,
 * and the card states it with its reason on its own line beside the other two ({@link FINDING_SIZING_LABELS}).
 *
 * ## The form is the bar
 *
 * This kind means "worth surfacing", not "a candidate that was considered". A form deriving P3 or P4 is
 * refused, and so is one naming a ticket that already tracks the issue: the bar is high priority AND not yet
 * tracked. The ticket branch stays in the input on purpose, so a tracked finding is told it is tracked rather
 * than that `ticket` is an unknown key. Where the post goes is the send's job, not the form's:
 * `../slack/findingDestination.ts` holds it to the channel and thread the owner approved on its queue card, never a DM,
 * and the run lane holds it to three distinct screenshots (`skills/automation/reference/finding-card.md`).
 *
 * ## Evidence from the system of record
 *
 * The hunt reaches past Datadog telemetry to money, security and every department, so
 * the citation is the system of record for the claim, judged by `./findingEvidence.ts` — a Datadog graph view or
 * a listed console, never a tracker — and the card's link names that source.
 *
 * ## A dollar figure, and who it reaches
 *
 * A bug in payments costing big revenue should reach the right people with its daily cost and its P1. So a finding may carry `cost`, a daily figure with how it was counted, shown on
 * the Impact line; and `escalate`, the people it tags, shown on the Priority line. Tagging is the narrow part: it
 * needs a `cost` AND a derived P0 or P1, and a P0 or P1 carrying a `cost` must tag. Who they are is the
 * composer's to name from the doc, never a constant here. The matrix is untouched by a figure: cost ranks leads
 * and heads the card, and a costly issue on few users still derives P2 and tags nobody.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";
import { findingEvidenceLabel, findingEvidenceOf } from "./findingEvidence.js";
import {
  FINDING_ENVS,
  FINDING_IMPACT_GRADES,
  type FindingUserBand,
  findingPriorityOf,
  findingPriorityReason,
  findingUserBandOf,
  isSurfaceableFindingPriority,
} from "./findingPriority.js";
import { headlineOf } from "./headline.js";
import type { Priority } from "./priority.js";
import { updateArtifactSchema } from "./schema.js";
import type { InlineRun, UpdateArtifact } from "./types.js";

/** The `kind` discriminant a finding form carries. */
export const FINDING_KIND = "finding";

/**
 * The three lines every finding card opens its index with, in the reader's question order: how many people, how badly,
 * so how urgent. A hunt post that carried none of them left the reader asking. Each is derived from a required field or from the matrix, so
 * a form cannot reach the card without all three.
 */
export const FINDING_SIZING_LABELS = ["Blast radius", "Impact", "Priority"] as const;

/** The longest title: the one issue, named. */
const FINDING_TITLE_MAX = 100;

/** The longest free-text field on an index line — what the user cannot do, when it began, where it was searched. */
export const FINDING_LINE_FIELD_MAX = 100;

/** The longest below-fold sentence — how a count was taken, why none could be, one option. */
const FINDING_DETAIL_FIELD_MAX = 180;

/** How many options a finding offers: at least one way to deal with it, at most three. */
export const FINDING_OPTIONS_MAX = 3;

/** The largest unique-user count a form may carry, so a nonsense number is refused rather than banded. */
const FINDING_USERS_MAX = 1_000_000_000;

/** The largest daily cost a form may carry, so a nonsense figure is refused rather than shown. */
const FINDING_DOLLARS_PER_DAY_MAX = 1_000_000_000;

/** The most people one finding tags. */
export const FINDING_ESCALATE_MAX = 3;

/** The priorities a finding with a dollar figure tags people at. */
const ESCALATING_PRIORITIES: ReadonlySet<Priority> = new Set<Priority>(["P0", "P1"]);

const lineField = z.string().trim().min(1).max(FINDING_LINE_FIELD_MAX);
const detailField = z.string().trim().min(1).max(FINDING_DETAIL_FIELD_MAX);

/** A MEASURED blast radius: unique users over a window, and how they were counted. */
export const measuredBlastRadiusSchema = strictForm({
  /** How the unique users were counted, so a reader can count again — `usr.id on the customer-ui parent spans`. */
  basis: detailField,
  /** How many unique users the issue reached over `window`. Users, never sessions or events. */
  users: z.number().int().min(1).max(FINDING_USERS_MAX),
  /** The window the count covers, as a reader would say it — `14 days`, `since the deploy`. */
  window: z.string().trim().min(1).max(40),
});

/** A blast radius nothing could count, and the nearest number there was. It ranks as `unknown`. */
const unmeasuredBlastRadiusSchema = strictForm({
  /** The nearest number there was — `120 failed calls` — which ranks nothing. */
  proxy: z.string().trim().min(1).max(80),
  /** Why no unique-user count exists — `these spans carry no user id and no parent trace does either`. */
  unmeasuredBecause: detailField,
});

/** A ticket already tracking it (refused), or where the tracker was searched and nothing found. */
const trackingSchema = z.union([
  strictForm({ ticket: strictForm({ id: z.string().trim().min(1).max(24), url: z.url() }) }),
  strictForm({ none: lineField }),
]);

/** What the issue costs the business each day, and how that was counted. */
const costSchema = strictForm({
  /** How the figure was counted, so a reader can count again — `failed Stripe charges x average invoice, 7 days`. */
  basis: detailField,
  /** Whole dollars lost each day, in the currency the business bills in. */
  dollarsPerDay: z.number().int().min(1).max(FINDING_DOLLARS_PER_DAY_MAX),
});

const findingFormFields = strictForm({
  blastRadius: z.union([measuredBlastRadiusSchema, unmeasuredBlastRadiusSchema]),
  /** The system-of-record view the finding rests on, which a reader opens to see it for themselves. */
  citationUrl: z.url().superRefine((url, ctx) => {
    const evidence = findingEvidenceOf({ url });
    if (evidence.kind === "refused") {
      ctx.addIssue({ code: "custom", message: evidence.reason });
    }
  }),
  cost: costSchema.optional(),
  env: z.enum(FINDING_ENVS),
  /** The people a P0 or P1 with a dollar figure tags, each an identity key a mention resolves. */
  escalate: z
    .array(z.string().trim().min(1).max(80))
    .min(1)
    .max(FINDING_ESCALATE_MAX)
    .refine((people) => new Set(people).size === people.length, { message: "escalate names a person twice" })
    .optional(),
  impact: strictForm({
    grade: z.enum(FINDING_IMPACT_GRADES),
    /** What the person using the product cannot do, in one sentence. */
    what: lineField,
  }),
  /** When it started, and how that is known — `first failing call three days ago, none in the ten days before`. */
  introduced: lineField,
  kind: z.literal(FINDING_KIND),
  /** Ways to deal with it, each one sentence. */
  options: z.array(detailField).min(1).max(FINDING_OPTIONS_MAX),
  /**
   * Where earlier reports were searched and nothing found — `no #defects or #urgent-defects thread in the last 14 days, no
   * support ticket`. Required, because a finding somebody already raised is conversation in THEIR thread, and
   * the high-stakes gate (`../slack/highStakesChannel.ts`) leans on this form being the whole defensibility block.
   */
  priorThread: strictForm({ none: lineField }),
  title: z.string().trim().min(1).max(FINDING_TITLE_MAX),
  tracking: trackingSchema,
});

/** One finding form, field-validated. */
export type FindingForm = z.infer<typeof findingFormFields>;

/** What one finding derives: the card, and the priority and band it was ranked on. */
export interface FindingDerivation {
  readonly artifact: UpdateArtifact;
  readonly priority: Priority;
  readonly userBand: FindingUserBand;
}

/** The measured user count on a form, or undefined for an unmeasured blast radius. */
function usersOf({ form }: { form: FindingForm }): number | undefined {
  if ("users" in form.blastRadius) {
    return form.blastRadius.users;
  }
  return undefined;
}

/** The priority one form derives. */
function priorityOf({ form }: { form: FindingForm }): Priority {
  return findingPriorityOf({ env: form.env, grade: form.impact.grade, users: usersOf({ form }) });
}

/** The priority line's value: the P-level, then the matrix cell it was read from. */
function priorityLine({ form }: { form: FindingForm }): string {
  const reason = findingPriorityReason({ env: form.env, grade: form.impact.grade, users: usersOf({ form }) });
  return `${priorityOf({ form })}, ${reason}`;
}

/** The priority line's runs: the line, then the people it tags as mentions, `for @a and @b`. */
function priorityRuns({ form }: { form: FindingForm }): readonly InlineRun[] {
  const line = priorityLine({ form });
  const people = form.escalate;
  if (people === undefined) {
    return [{ text: line, type: "text" }];
  }
  const runs: InlineRun[] = [{ text: `${line}, for `, type: "text" }];
  people.forEach((person, position) => {
    if (position > 0) {
      const joiner = position === people.length - 1 ? " and " : ", ";
      runs.push({ text: joiner, type: "text" });
    }
    runs.push({ person, type: "mention" });
  });
  return runs;
}

/** The impact line's value: the grade, the daily cost when there is one, then what the person cannot do. */
function impactLine({ form }: { form: FindingForm }): string {
  if (form.cost === undefined) {
    return `${form.impact.grade}. ${form.impact.what}`;
  }
  const dollars = form.cost.dollarsPerDay.toLocaleString("en-US");
  return `${form.impact.grade}, costing about $${dollars} a day. ${form.impact.what}`;
}

/** The three TL;DR clauses: the priority, the environment, the issue. */
function headlineClauses({ form }: { form: FindingForm }): readonly string[] {
  return [priorityOf({ form }), form.env, form.title];
}

/** One index line: a bold label, then the value. */
function labelled({ label, value }: { label: string; value: readonly InlineRun[] }): readonly InlineRun[] {
  return [{ bold: true, text: `${label} `, type: "text" }, ...value];
}

/** The blast-radius line's value, measured or not, with the chip citing the evidence view. */
function blastRadiusRuns({ form }: { form: FindingForm }): readonly InlineRun[] {
  const cite: InlineRun = { citationId: "finding", type: "citation" };
  if ("users" in form.blastRadius) {
    const { users, window } = form.blastRadius;
    const noun = users === 1 ? "user" : "users";
    return [{ text: `${String(users)} unique ${noun} in ${window} `, type: "text" }, cite];
  }
  return [{ text: `not counted. Nearest number is ${form.blastRadius.proxy} `, type: "text" }, cite];
}

/** The below-fold sentence saying how the blast radius was counted, or why it could not be. */
function basisSentence({ form }: { form: FindingForm }): string {
  if ("users" in form.blastRadius) {
    return `Counted as ${form.blastRadius.basis}.`;
  }
  return `No unique-user count, because ${form.blastRadius.unmeasuredBecause}.`;
}

/** The below-fold paragraph saying how the daily cost was counted, or nothing when the finding carries none. */
function costDetail({ form }: { form: FindingForm }): UpdateArtifact["detail"] {
  if (form.cost === undefined) {
    return [];
  }
  return [{ runs: [{ text: `Cost counted as ${form.cost.basis}.`, type: "text" }], type: "paragraph" }];
}

/** Where the tracker was searched. Only the untracked branch ever derives a card; the tracked one is refused. */
function trackingText({ form }: { form: FindingForm }): string {
  if ("none" in form.tracking) {
    return form.tracking.none;
  }
  return form.tracking.ticket.id;
}

/**
 * Derive the card one finding sends. Every word above the fold is either a form field or a label this module owns.
 *
 * @param form the field-validated finding
 * @returns the card, not yet validated against the layout schema, with the priority and band it was ranked on
 */
export function findingToUpdate({ form }: { form: FindingForm }): FindingDerivation {
  const priority = priorityOf({ form });
  const headline = headlineOf({ clauses: headlineClauses({ form }) });
  const artifact: UpdateArtifact = {
    citations: [{ id: "finding", label: "[1]", url: form.citationUrl }],
    detail: [
      { runs: [{ text: basisSentence({ form }), type: "text" }], type: "paragraph" },
      ...costDetail({ form }),
      {
        runs: [
          { bold: true, text: "Introduced ", type: "text" },
          { text: form.introduced, type: "text" },
        ],
        type: "paragraph",
      },
      { runs: [{ bold: true, text: "Options", type: "text" }], type: "paragraph" },
      { items: form.options.map((option) => [{ text: option, type: "text" }]), type: "bullets" },
    ],
    index: [
      labelled({ label: FINDING_SIZING_LABELS[0], value: blastRadiusRuns({ form }) }),
      labelled({ label: FINDING_SIZING_LABELS[1], value: [{ text: impactLine({ form }), type: "text" }] }),
      labelled({ label: FINDING_SIZING_LABELS[2], value: priorityRuns({ form }) }),
      labelled({ label: "Not tracked yet", value: [{ text: trackingText({ form }), type: "text" }] }),
      labelled({ label: "Not raised before", value: [{ text: form.priorThread.none, type: "text" }] }),
    ],
    indexStyle: "plain",
    kind: "update",
    media: [],
    primaryLink: { label: findingEvidenceLabel({ url: form.citationUrl }), url: form.citationUrl },
    // A title the headline refuses is refused by the form before this is ever sent; the joined clauses are
    // what a caller deriving an UNVALIDATED form reads, and never what goes out.
    tldr: headline.isOk() ? headline.value : headlineClauses({ form }).join(" "),
  };
  return { artifact, priority, userBand: findingUserBandOf({ users: usersOf({ form }) }) };
}

/**
 * Every refusal the bar earns one field-valid finding: tracked already, or deriving below P2.
 *
 * @param form the field-validated finding
 * @returns one message per refusal, empty when the finding is worth a post
 */
function findingBarRefusals({ form }: { form: FindingForm }): readonly string[] {
  const refusals: string[] = [];
  if ("ticket" in form.tracking) {
    refusals.push(
      `tracking: the team already tracks this in ${form.tracking.ticket.id}, and only an issue nobody is tracking ` +
        "is worth a post. Leave it out and name it among what was checked.",
    );
  }
  const priority = priorityOf({ form });
  if (!isSurfaceableFindingPriority({ priority })) {
    const band = findingUserBandOf({ users: usersOf({ form }) });
    refusals.push(
      `impact: ${form.impact.grade} impact on a ${band} blast radius in ${form.env} derives ${priority}, and only ` +
        "P0, P1 or P2 is worth a post. Leave it out and name it among what was checked.",
    );
  }
  return [...refusals, ...escalationRefusals({ form, priority })];
}

/**
 * Every refusal the escalation rule earns: a tag needs a dollar figure and a P0 or P1, and a P0 or P1 with a
 * dollar figure needs a tag.
 *
 * @param form the field-validated finding
 * @param priority the priority it derives
 * @returns one message per refusal, empty when the tags match the figure and the priority
 */
function escalationRefusals({ form, priority }: { form: FindingForm; priority: Priority }): readonly string[] {
  const escalates = ESCALATING_PRIORITIES.has(priority);
  if (form.escalate !== undefined && form.cost === undefined) {
    return [
      "escalate: only a finding carrying a `cost` tags anyone, because a dollar figure is what earns the tag. " +
        "Add the daily cost with its basis, or drop `escalate`.",
    ];
  }
  if (form.escalate !== undefined && !escalates) {
    return [
      `escalate: this finding derives ${priority}, and only a P0 or P1 with a dollar figure tags anyone. ` +
        "Drop `escalate`.",
    ];
  }
  if (form.escalate === undefined && form.cost !== undefined && escalates) {
    return [
      `escalate: a ${priority} carrying a dollar figure tags the people the hunt names for one. Add \`escalate\`.`,
    ];
  }
  return [];
}

/**
 * Why the card a finding derives is refused, or nothing when it is accepted. Derives with the real
 * {@link findingToUpdate} and validates with the real layout schema, so it holds for every cap the layout has.
 *
 * @param form the field-validated finding
 * @returns the refusal naming the fields that build each region, or undefined when the card is accepted
 */
function findingCardRefusal({ form }: { form: FindingForm }): string | undefined {
  const headline = headlineOf({ clauses: headlineClauses({ form }) });
  if (headline.isErr()) {
    return `title: ${headline.error.join(" ")}`;
  }
  const derived = updateArtifactSchema.safeParse(findingToUpdate({ form }).artifact);
  if (derived.success) {
    return undefined;
  }
  return (
    "these fields each sit inside their own limits, but the card they derive does not. Above the fold, " +
    "`title`, `impact.what`, `cost`, the blast radius, `tracking.none`, `priorThread.none` and `escalate` share one " +
    "region cap with the derived priority line. Shorten " +
    `one of those. What the layout refused: ${z.prettifyError(derived.error)}`
  );
}

/** The finding form: field caps, the surfacing bar, and {@link findingCardRefusal} over the card they derive. */
export const findingFormSchema = findingFormFields.superRefine((form, ctx) => {
  for (const message of findingBarRefusals({ form })) {
    ctx.addIssue({ code: "custom", message, path: [] });
  }
  const refusal = findingCardRefusal({ form });
  if (refusal !== undefined) {
    ctx.addIssue({ code: "custom", message: refusal, path: [] });
  }
});
