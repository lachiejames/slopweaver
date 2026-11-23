/**
 * The `witness` form: what the bot posts into a thread it is WITNESSING, and only when it has something material
 * with proof.
 *
 * ## What it is for
 *
 * The bot reads threads where another bot was tagged, checks what that thread claims, and stays silent unless the
 * check found one of three things: the claim is contradicted (the thread says resolved, errors continue), the
 * impact is wider than the thread says (the retry fixed one customer, twenty others hit the same failure), or a
 * fact the thread needs is missing. Silence is the default outcome and is settled elsewhere; this form is the
 * only shape the other outcome can take.
 *
 * ## The form is the bar (rule 7)
 *
 * Shape is enforced by the schema, never by review, so every property of "material with proof" a machine can
 * decide is a refusal here rather than a line in a skill:
 *
 * - **Proof is required.** At least one, each an `https` URL with what it shows. Nothing to link means nothing
 *   material, and the session settles `nothing-material` instead of posting.
 * - **One finding, one sentence.** It is the TL;DR. A second sentence is a second fact the reader did not ask
 *   for, and belongs in a proof's `shows` or in `checked`.
 * - **The materiality is one of three.** It leads the below-fold claim paragraph, so the reader who expands sees
 *   which kind of point this is beside the words it is about.
 * - **The claim is quoted, never paraphrased.** It is somebody else's words, so its run carries `quoted: true`
 *   and the voice rules judge only the prose this module composes around it.
 * - **Nothing becomes a ping or a link by accident.** Every free-text field refuses raw markup, because
 *   `./typedRuns.ts` converts `<@U…>` into a real mention and `<!here>` into a real broadcast inside every
 *   text run, and a witness post tags nobody. The proof URLs are the card's only links.
 *
 * ## Every accepted field reaches the card or the validation
 *
 * `finding` is the TL;DR, each `proof` an index line ending in its citation chip, `materiality` and
 * `claim.quote` the first detail paragraph, `checked` a bulleted list below it. `claim.messageTs` is checked
 * as a Slack `ts` and carried for the caller that settles the witness record; it never renders.
 */
import { z } from "zod";

import { BULLET_ITEM_VISIBLE_MAX, BULLETS_MAX_ITEMS, TLDR_VISIBLE_MAX } from "../assistant/contentLimits.js";
import { strictForm } from "../strictForm.js";
import { headlineOf } from "./headline.js";
import { updateArtifactSchema } from "./schema.js";
import { scanRawMarkup } from "./typedRuns.js";
import type { DetailBlock, InlineRun, UpdateArtifact } from "./types.js";

/** The `kind` discriminant a witness form carries. */
export const WITNESS_KIND = "witness";

/** The three things that make a witnessed claim worth a post, and nothing else does. */
const WITNESS_MATERIALITIES = ["claim-contradicted", "wider-impact", "missing-fact"] as const;

/** Which of the three a witness post is. */
type WitnessMateriality = (typeof WITNESS_MATERIALITIES)[number];

/** The bold label each materiality leads the claim paragraph with. */
const MATERIALITY_LABELS: Readonly<Record<WitnessMateriality, string>> = {
  "claim-contradicted": "Contradicted.",
  "missing-fact": "Missing fact.",
  "wider-impact": "Wider impact.",
};

/**
 * The most proofs one post links. Each is an index line above the fold, and four already make the region a list
 * a reader scans rather than reads.
 *
 * @internal — the form's cap; read by the tests that pin it.
 */
export const WITNESS_PROOF_MAX = 4;

/**
 * The longest proof label. With {@link WITNESS_PROOF_SHOWS_MAX} it is sized so the widest proof line is 119
 * visible characters, one under the index line cap, so a proof line alone can never refuse a card.
 *
 * @internal — read by the tests that pin the widest line.
 */
export const WITNESS_PROOF_LABEL_MAX = 40;

/**
 * The longest `shows` phrase. See {@link WITNESS_PROOF_LABEL_MAX} for the arithmetic.
 *
 * @internal — read by the tests that pin the widest line.
 */
export const WITNESS_PROOF_SHOWS_MAX = 68;

/**
 * The longest quoted claim. Long enough for the sentence a thread actually said, short enough that the claim
 * paragraph stays far inside its own cap.
 *
 * @internal — read by the tests that pin it.
 */
export const WITNESS_QUOTE_MAX = 280;

/**
 * The most `checked` lines, and the longest one: the layout's own bullet caps, so each line fits alone. Together
 * with the quote they can still outgrow the detail budget, which is what {@link witnessCardRefusal} names.
 *
 * @internal — read by the tests that pin the shared budget.
 */
export const WITNESS_CHECKED_MAX = BULLETS_MAX_ITEMS;

/** The longest `checked` line. */
const WITNESS_CHECKED_LINE_MAX = BULLET_ITEM_VISIBLE_MAX;

/** A Slack message `ts`: whole seconds, a dot, the fraction. */
const SLACK_MESSAGE_TS = /^\d+\.\d+$/u;

/** A `[n]` citation marker, which would read as one of this card's own chips. */
const CITATION_MARKER = /\[\d+\]/u;

/**
 * A sentence ending followed by more text: the second sentence a finding may not carry. Any character Unicode
 * calls a `Sentence_Terminal`, in any script (`. ! ? ‼ ‽ 。 ！ ？ ؟ ।`), or an ellipsis (`…`), may be followed
 * only by more endings and closing quotes or brackets up to the very end, so nothing can hide behind a quote
 * (`"Is it fixed?" Errors continue`). The one exception is an ASCII full stop between two digits (`1.5`,
 * `v1.2.3`). Anywhere else a full stop may end a sentence, welded or not (`continue.the deployment`), and no
 * lexical rule tells that from a host or file name (`example.com`), so both are refused and a name goes in a
 * proof. Several review passes each broke a narrower reading of this, and another an
 * ASCII-only one.
 */
const SECOND_SENTENCE =
  /(?!\.)[\p{STerm}…](?![\p{STerm}…\p{Pe}\p{Pf}"']*$)|(?<!\d)\.(?![\p{STerm}…\p{Pe}\p{Pf}"']*$)|\.(?!\d)(?![\p{STerm}…\p{Pe}\p{Pf}"']*$)/u;

/** A line break of any kind — `\n` alone would let a carriage return or a Unicode separator start a second line. */
const LINE_BREAK = /[\n\r\v\f\x85\p{Zl}\p{Zp}]/u;

/** A semicolon in any form: ASCII, the Greek question mark it normalises from, full-width and small. */
const SEMICOLON = /[;\u{37E}\u{FF1B}\u{FE54}]/u;

/** The refusal a free-text field carrying markup reads. */
const PLAIN_TEXT_REFUSAL =
  "must be plain text: a mention, a broadcast, an angle form, a URL and a `[n]` marker are refused, because " +
  "the card would turn one into a ping, a link or one of its own citation chips, and a witness post tags " +
  "nobody. Put a link in a `proof` entry, which is where this card's links come from.";

/**
 * A bounded free-text field that cannot become anything but text.
 *
 * The URL half asks {@link scanRawMarkup}, the scanner the conversion itself runs, rather than a second pattern
 * that could drift from it (the `./recommendations.ts` lesson).
 */
function plainText({ max }: { max: number }): z.ZodString {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => scanRawMarkup({ text: value }).length === 0 && !CITATION_MARKER.test(value), {
      error: PLAIN_TEXT_REFUSAL,
    });
}

/**
 * A proof URL: parsed, and `https` specifically, because a reader opens it from a Slack thread. A value that is
 * not a URL at all is left to `z.url()`'s own refusal, since Zod runs this check even after that one fails.
 */
const proofUrlSchema = z.url().refine((url) => !URL.canParse(url) || new URL(url).protocol === "https:", {
  error: "a proof URL must be https, because a reader opens it from the thread and an http link is refused there",
});

/** One proof: what it is, where it is, and what it shows. */
const proofSchema = strictForm({
  /** What the proof IS, as a noun phrase the line opens with in bold, `The booking error view`. */
  label: plainText({ max: WITNESS_PROOF_LABEL_MAX }),
  /** What it shows, as the phrase that follows the word "shows", `20 failed bookings after the retry`. */
  shows: plainText({ max: WITNESS_PROOF_SHOWS_MAX }),
  url: proofUrlSchema,
});

/** The finding: one sentence, the one material thing, which becomes the TL;DR. */
const findingSchema = plainText({ max: TLDR_VISIBLE_MAX }).refine(
  (value) => !SECOND_SENTENCE.test(value) && !LINE_BREAK.test(value) && !SEMICOLON.test(value),
  {
    error:
      "one sentence, the one material thing. A second sentence or a semicolon is a second fact, and a witness " +
      "post carries one (rule 7). Move the rest into a proof's `shows` or into `checked`. A full stop may only end " +
      "the sentence or sit inside a number, so a host or file name goes in a proof too.",
  },
);

const witnessFormFields = strictForm({
  /** Where else was looked and found nothing worth saying, each one line. Below the fold. */
  checked: z
    .array(plainText({ max: WITNESS_CHECKED_LINE_MAX }))
    .min(1)
    .max(WITNESS_CHECKED_MAX)
    .optional(),
  /** The thread message the finding is about, and its words verbatim. */
  claim: strictForm({
    messageTs: z.string().regex(SLACK_MESSAGE_TS, "a Slack message ts is whole seconds, a dot, then the fraction"),
    quote: plainText({ max: WITNESS_QUOTE_MAX }),
  }),
  finding: findingSchema,
  kind: z.literal(WITNESS_KIND),
  materiality: z.enum(WITNESS_MATERIALITIES),
  proof: z
    .array(proofSchema)
    .min(1, "a witness post carries at least one proof. With nothing to link, settle nothing-material instead.")
    .max(WITNESS_PROOF_MAX),
});

/**
 * One witness form, field-validated.
 *
 * @internal — the parsed shape; callers outside this file parse with {@link witnessFormSchema}.
 */
export type WitnessForm = z.infer<typeof witnessFormFields>;

/** The quoted claim as the card renders it, inside quotation marks. */
function quoteText({ form }: { form: WitnessForm }): string {
  return `"${form.claim.quote}"`;
}

/** The citation id one proof's chip points at. */
function proofCitationId({ position }: { position: number }): string {
  return `proof-${String(position + 1)}`;
}

/** One proof's index line: the label in bold, what it shows, then its chip. */
function proofLine({ form, position }: { form: WitnessForm; position: number }): readonly InlineRun[] {
  const proof = form.proof[position]!;
  return [
    { bold: true, text: `${proof.label} `, type: "text" },
    { text: `shows ${proof.shows} `, type: "text" },
    { citationId: proofCitationId({ position }), type: "citation" },
  ];
}

/** The `checked` list below the fold, or nothing when the form carries none. */
function checkedDetail({ form }: { form: WitnessForm }): readonly DetailBlock[] {
  if (form.checked === undefined) {
    return [];
  }
  return [
    { runs: [{ bold: true, text: "Also checked", type: "text" }], type: "paragraph" },
    { items: form.checked.map((line) => [{ text: line, type: "text" }]), type: "bullets" },
  ];
}

/**
 * Derive the card one witness form sends. Every word is a form field or a label this module owns, and the
 * claim's words are marked `quoted` because they are the thread's, not the bot's.
 *
 * The `quoted` flag is one the layout schema refuses on a COMPOSED card, so a caller validating this card runs
 * {@link withoutWitnessQuote} first and puts the flag back with {@link withWitnessQuote} on what it accepted.
 *
 * @param form the field-validated witness form
 * @returns the card, with its quoted claim marked, not yet validated against the layout schema
 */
export function witnessToUpdate({ form }: { form: WitnessForm }): UpdateArtifact {
  const headline = headlineOf({ clauses: [form.finding] });
  return {
    citations: form.proof.map((proof, position) => ({
      id: proofCitationId({ position }),
      label: `[${String(position + 1)}]`,
      url: proof.url,
    })),
    detail: [
      {
        runs: [
          { bold: true, text: `${MATERIALITY_LABELS[form.materiality]} `, type: "text" },
          { text: "The thread said ", type: "text" },
          { quoted: true, text: quoteText({ form }), type: "text" },
        ],
        type: "paragraph",
      },
      ...checkedDetail({ form }),
    ],
    index: form.proof.map((_, position) => proofLine({ form, position })),
    kind: "update",
    media: [],
    // A finding the headline refuses is refused by the form before this is ever sent; the raw finding is what a
    // caller deriving an UNVALIDATED form reads, and never what goes out.
    tldr: headline.isOk() ? headline.value : form.finding,
  };
}

/** One run with the derivation-only `quoted` flag removed; every other run passes through untouched. */
function withoutQuoted({ run }: { run: InlineRun }): InlineRun {
  if (run.type !== "text" || run.quoted === undefined) {
    return run;
  }
  const { quoted: _quoted, ...rest } = run;
  return rest;
}

/**
 * The derived card with its `quoted` flag removed, so the strict layout schema can validate its caps. The width
 * arithmetic is unchanged: a quoted run costs its text like any other.
 *
 * @param artifact the card {@link witnessToUpdate} derived
 * @returns the same card, with no run carrying `quoted`
 */
export function withoutWitnessQuote({ artifact }: { artifact: UpdateArtifact }): UpdateArtifact {
  return {
    ...artifact,
    detail: artifact.detail.map((block) =>
      block.type === "paragraph" ? { ...block, runs: block.runs.map((run) => withoutQuoted({ run })) } : block,
    ),
  };
}

/**
 * The VALIDATED card with the claim marked `quoted` again, so the send door's voice rules skip the thread's words
 * exactly as the derivation meant them to. A paragraph text run is re-marked when it is the quoted claim, whole
 * and not bold, which is the run {@link witnessToUpdate} built.
 *
 * @param artifact the card the layout schema accepted
 * @param form the witness form it was derived from
 * @returns the same card, with the claim's run marked `quoted`
 */
export function withWitnessQuote({ artifact, form }: { artifact: UpdateArtifact; form: WitnessForm }): UpdateArtifact {
  const quote = quoteText({ form });
  const mark = ({ run }: { run: InlineRun }): InlineRun =>
    run.type === "text" && run.bold !== true && run.text === quote ? { ...run, quoted: true } : run;
  return {
    ...artifact,
    detail: artifact.detail.map((block) =>
      block.type === "paragraph" ? { ...block, runs: block.runs.map((run) => mark({ run })) } : block,
    ),
  };
}

/** The refusal two proofs naming one URL earn, or nothing when every URL is distinct. */
function duplicateProofRefusal({ form }: { form: WitnessForm }): string | undefined {
  const urls = form.proof.map((proof) => proof.url);
  if (new Set(urls).size === urls.length) {
    return undefined;
  }
  return "proof: two proofs name one URL, and one URL proves one thing. Merge them into one proof.";
}

/**
 * Why the card a witness form derives is refused, or nothing when it is accepted. Derives with the real
 * {@link witnessToUpdate} and validates with the real layout schema, so it holds for every cap the layout has.
 *
 * @param form the field-validated witness form
 * @returns the refusal naming the fields that build each region, or undefined when the card is accepted
 */
function witnessCardRefusal({ form }: { form: WitnessForm }): string | undefined {
  const headline = headlineOf({ clauses: [form.finding] });
  if (headline.isErr()) {
    return `finding: ${headline.error.join(" ")}`;
  }
  const derived = updateArtifactSchema.safeParse(withoutWitnessQuote({ artifact: witnessToUpdate({ form }) }));
  if (derived.success) {
    return undefined;
  }
  return (
    "these fields each sit inside their own limits, but the card they derive does not. Below the fold, " +
    "`claim.quote` and every `checked` line share one detail budget. Shorten the quote or a `checked` line, or " +
    `drop one. What the layout refused: ${z.prettifyError(derived.error)}`
  );
}

/**
 * The witness form: field caps, distinct proofs, and {@link witnessCardRefusal} over the card they derive.
 *
 * The form-level checks run only over a form whose fields all passed. Zod runs an object refinement after a
 * CONTINUABLE field issue too, and a card derived from a field that already failed would repeat that field's
 * refusal as a second, misleading one about the layout.
 */
export const witnessFormSchema = witnessFormFields.superRefine(
  (form, ctx) => {
    for (const refusal of [duplicateProofRefusal({ form }), witnessCardRefusal({ form })]) {
      if (refusal !== undefined) {
        ctx.addIssue({ code: "custom", message: refusal, path: [] });
      }
    }
  },
  { when: (payload) => payload.issues.length === 0 },
);
