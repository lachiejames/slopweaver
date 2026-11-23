/**
 * A message the voice put on the owner's running list during a call, as the call's file keeps it — the `offered` line the
 * page writes in the same step the offer is added (`site/components/voice/useRunningList.ts`,
 * `site/lib/runningListCopy.ts`).
 *
 * Recording only "copy offered" would lose a message the owner never copied from the call's record. So the file
 * keeps the offer WHOLE, head and fold, byte for byte. A
 * line past the list's own bound is refused (the line is skipped and counted), never cut: a cut message is a
 * different message, and the page never adds one past it. The running list keeps only the newest ten, so these
 * lines are the call's own audit of what it offered, and what a relay the owner gives next carries.
 *
 * Pure: no filesystem, no clock.
 */
import { z } from "zod";

import { RUNNING_LIST_LABEL_MAX, RUNNING_LIST_TEXT_MAX } from "./runningList.js";

/** The longest message one offer carries, head and fold together, in code points — the list's own bound. */
const COPY_OFFER_MAX_CODE_POINTS = RUNNING_LIST_TEXT_MAX;

/** The longest label, in code points. */
const COPY_OFFER_LABEL_MAX_CODE_POINTS = RUNNING_LIST_LABEL_MAX;

/** The most digits `made` carries — the page's own cap (`site/lib/runningListCopy.ts`), past any window's count. */
const COPY_OFFER_MADE_MAX_DIGITS = 20;

/** What the page's ids open with: an id is `offer-<made>`. */
const OFFER_ID_PREFIX = "offer-";

/** `made` as JSON carries a bigint: canonical decimal digits, no sign, no leading zero. */
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

/** How many code points a string holds — the unit the tool schema's `maxLength` counts. */
const codePoints = ({ value }: { value: string }): number => Array.from(value).length;

/**
 * Half of a UTF-16 pair with no other half: JSON carries one, but a clipboard write turns it into U+FFFD, so the
 * page refuses an offer holding one and the file refuses the line too.
 */
const LONE_SURROGATE = /\p{Cs}/u;

/** A string with something in it beyond whitespace, made of whole characters. */
const nonblank = z
  .string()
  .refine((value) => value.trim() !== "", { message: "blank" })
  .refine((value) => !LONE_SURROGATE.test(value), { message: "half a character" });

/** The whole message the owner copies: the head, then one newline and the fold when there is one (`copyOfferText`). */
const wholeText = ({ text, belowFold }: { text: string; belowFold: string | undefined }): string =>
  belowFold === undefined ? text : `${text}\n${belowFold}`;

const offerSchema = z
  .object({
    belowFold: nonblank.optional(),
    // The page refuses an offer whose counter is past these widths, so the file never refuses a line the page landed,
    // and an offered line has a worst case that fits one transcript batch.
    id: z
      .string()
      .min(1)
      .max(OFFER_ID_PREFIX.length + COPY_OFFER_MADE_MAX_DIGITS),
    label: nonblank
      .refine((value) => codePoints({ value }) <= COPY_OFFER_LABEL_MAX_CODE_POINTS, { message: "label too long" })
      .optional(),
    made: z.string().max(COPY_OFFER_MADE_MAX_DIGITS).regex(CANONICAL_DECIMAL),
    text: nonblank,
  })
  .refine(
    ({ belowFold, text }) => codePoints({ value: wholeText({ belowFold, text }) }) <= COPY_OFFER_MAX_CODE_POINTS,
    { message: "the message is over the list's bound" },
  );

/** An `offered` line's own fields; `callRecord.ts` adds the instant and write id every line carries. */
export const CALL_OFFER_FIELDS = { kind: z.literal("offered"), offer: offerSchema };

/** One message the voice put on the owner's running list during the call, as the call recorded it. */
export interface CallOffer {
  /** When it landed. */
  readonly atIso: string;
  readonly id: string;
  /** When it was asked, as decimal digits: the list's order, which a late voice check can make differ from the file's. */
  readonly made: string;
  /** The head: all of the message when there is no fold. */
  readonly text: string;
  /** The rest, behind "Show more", or `undefined` when the whole message showed at once. */
  readonly belowFold: string | undefined;
  readonly label: string | undefined;
}

/** The shape of one offered line, for its type. */
const offeredLine = z.object(CALL_OFFER_FIELDS).extend({ atIso: z.string() });

/** An `offered` line, parsed. */
type OfferedEntry = z.infer<typeof offeredLine>;

/**
 * Fold one offered line in, once per offer: a batch posted again writes it twice, and the first copy keeps its place,
 * so the list stays in the order the offers landed.
 *
 * @param offers the call's offers so far, updated in place
 * @param entry the offered line, already parsed
 */
export function foldOffer({ offers, entry }: { offers: CallOffer[]; entry: OfferedEntry }): void {
  const { belowFold, id, label, made, text } = entry.offer;
  if (offers.some((held) => held.id === id)) {
    return;
  }
  offers.push({ atIso: entry.atIso, belowFold, id, label, made, text });
}
