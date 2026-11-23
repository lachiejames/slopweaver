/**
 * The digest form's FIELDS: the caps, the per-field schemas and the types every digest module reads.
 *
 * Split from `./digest.ts`, which keeps the whole-form check and the derivation. The split is a layering one:
 * the whole-form check DERIVES the card to validate it, so the renderers cannot import the form from the file
 * that validates it without a cycle. Everything here is data, and nothing here derives a card.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";
import { introSchema } from "./introAndRank.js";
import { impactFieldSchema } from "./priority.js";
import { RECOMMENDATIONS_MAX, recommendationFormSchema } from "./recommendations.js";
import { ABOVE_FOLD_VISIBLE_MAX, INDEX_MAX_ITEMS, TABLE_MAX_ROWS, TLDR_VISIBLE_MAX } from "./schema.js";
import { SEVERITIES } from "./severity.js";
import { ALERT_TREND_PRIOR_WINDOWS_MAX } from "./trend.js";
import type { UpdateArtifact } from "./types.js";

/**
 * How many items may ride above the fold. Deliberately the SAME number as the index cap it derives into, named
 * separately so the relationship is visible: if the layout cap moved, this would still be the digest's own
 * statement about how many alerts a person triages at a glance.
 */
export const DIGEST_INDEXED_MAX = INDEX_MAX_ITEMS;

/**
 * The authored lead clause appended to the derived count sentence, bounded so the WHOLE TL;DR provably fits.
 *
 * The number is not taste. The derived prefix is bounded by {@link DIGEST_LABEL_MAX} + {@link DIGEST_WINDOW_MAX}
 * plus the count sentence, and `TLDR_VISIBLE_MAX` is 180; 90 leaves headroom against the worst case, so a form
 * that validates here cannot derive an over-long TL;DR. The test suite pins that arithmetic rather than
 * trusting this comment.
 */
export const DIGEST_LEAD_VISIBLE_MAX = 90;

/**
 * The lead cap on an ALERTS digest, which spends thirty-two more characters of the TL;DR before the lead begins.
 *
 * Arithmetic, in the layout's own UTF-16 units: {@link DIGEST_LABEL_MAX} 40 + a space + {@link DIGEST_WINDOW_MAX}
 * 12 + ` · ` 3 = 56; the priority token `P0 · ` 5; the severity counts at their widest for {@link TABLE_MAX_ROWS}
 * items (`8 red, 1 orange, 1 green.`) 25; the trend clause at {@link ALERT_TREND_PRIOR_WINDOWS_MAX} and the
 * clamped ratio (` >99.9× the prior 9 windows.`) 28 — 114, plus the space before the lead, leaves 65 of
 * `TLDR_VISIBLE_MAX` 180. Sixty keeps headroom against that worst case, and `digestAlerts.test.ts` pins it.
 *
 * A SEPARATE cap rather than a narrower {@link DIGEST_LEAD_VISIBLE_MAX}, because the digest form is also the
 * cycle-hygiene card and a model-authored triage card, neither of which carries the two derived tokens —
 * narrowing their cap would refuse forms that fit, for a reason that is not theirs.
 */
export const DIGEST_ALERT_LEAD_VISIBLE_MAX = 60;

/** The digest's subject label (e.g. a system name). Bounded because it prefixes the derived TL;DR. */
export const DIGEST_LABEL_MAX = 40;

/** The observation window as a human string (e.g. `24h`). Bounded for the same reason as the label. */
export const DIGEST_WINDOW_MAX = 12;

/**
 * The width one derived index line is trimmed to — TIGHTER than the layout's own `INDEX_ITEM_VISIBLE_MAX`, and
 * the difference is arithmetic rather than preference.
 *
 * The layout bounds the whole above-the-fold region at `ABOVE_FOLD_VISIBLE_MAX` (1080) as well as each line at
 * `INDEX_ITEM_VISIBLE_MAX` (120). Nine maximal lines plus a maximal TL;DR is 180 + 9x120 = 1260, which the
 * region check rejects — so a derivation that only respected the per-line cap could emit an invalid card from a
 * perfectly valid form, at the unattended hour. Trimming to `(1080 - 180) / 9 = 100` makes the worst case land
 * exactly ON the region cap instead. `digest/acceptedDerivesValid.test.ts` pins that worst case rather than
 * trusting this comment.
 */
export const DIGEST_LINE_VISIBLE_MAX = Math.floor((ABOVE_FOLD_VISIBLE_MAX - TLDR_VISIBLE_MAX) / INDEX_MAX_ITEMS);

/** A tracked ticket. `id` is what a reader clicks; the URL costs nothing against a cap. */
const digestTicketSchema = strictForm({
  id: z.string().min(1).max(40),
  url: z.url(),
});

/**
 * ONE alert in the digest.
 *
 * `severity`, `count` and `ticket` are FACTS — the composer looked them up. `title`, `trend`, `state` and
 * `substance` are PROSE, and are the only thing a model authors. Nothing here describes layout.
 */
const digestItemSchema = strictForm({
  /**
   * The Datadog (or other) query URL backing this item's numbers. Becomes a `[n]` citation chip, which is what
   * makes the digest independently verifiable rather than merely assertive.
   */
  citationUrl: z.url().optional(),
  /**
   * The occurrence count over the digest's window.
   *
   * Bounded at the largest SAFE integer rather than left open, so a derived index line's width is provable: an
   * alerts line carries a priority and an impact cell that cannot be cut, and an unbounded number beside them is
   * the one input that could push a line past its cap with nothing left to trim.
   */
  count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  /**
   * Who should act, and what is being asked of them.
   *
   * `person` is an identity-map KEY, never a raw `Uxxx` and never `<@U…>` — the same vocabulary every other
   * mention in this repo uses, so a composer has no syntax with which to fabricate a ping. Resolution stays
   * exact-match only.
   */
  owner: strictForm({
    ask: z.string().min(1).max(120).optional(),
    person: z.string().min(1).max(60),
  }).optional(),
  /**
   * The ESTIMATED blast radius on an ALERTS digest: the probe's own query as a share of its service's telemetry,
   * carried as both counted numbers — `./priority.ts`'s {@link impactFieldSchema}, the same field the alert
   * summary's rows carry. Absent on every item nothing could measure, which reads `impact ?` and ranks in the
   * matrix's `unknown` band. Refused on a digest with no `alerts` block, where nothing would read it.
   */
  impact: impactFieldSchema.optional(),
  severity: z.enum(SEVERITIES),
  /** Where it stands — the table's `State` column (e.g. `fix on staging, awaits release`). */
  state: z.string().min(1).max(80).optional(),
  /**
   * The paragraph this item earns BELOW the fold, when it earns one. Present on the item that needs a
   * decision; absent on the three that do not, which is how the detail stays short without a length rule.
   */
  substance: z.string().min(1).max(600).optional(),
  ticket: digestTicketSchema.optional(),
  /** What is broken, as a short noun phrase — never a sentence. */
  title: z.string().min(1).max(80),
  /** Direction, as authored prose (`rising`, `easing from 403`). Free text because a real trend is nuanced. */
  trend: z.string().min(1).max(40).optional(),
});

/** One alert in the digest. */
export type DigestItem = z.infer<typeof digestItemSchema>;

/**
 * The digest form's FIELDS, before the whole-form check below is layered on.
 *
 * Split out for one reason: {@link digestFormSchema}'s refinement calls {@link digestToUpdate}, whose parameter
 * is `DigestForm`. Inferring that type from the refined schema would make the type circular, so it is inferred
 * from the base instead. The split is mechanical, not a second contract — nothing may reference this directly.
 *
 * `items` is capped at {@link TABLE_MAX_ROWS} because every item lands in the derived table, and a table is
 * bounded structurally. The first {@link DIGEST_INDEXED_MAX} by severity additionally land above the fold —
 * so a digest with more alerts than fit above the fold degrades by hiding the least severe, never by failing.
 */
export const digestFormFields = strictForm({
  /**
   * The ALERTS opt-in. Present, the card ranks by `./priority.ts`'s matrix and compares itself with the windows
   * before it, exactly as the alert-summary card does. Absent, it is the triage card it always
   * was, byte for byte.
   *
   * A block rather than an inference, because nothing else on the form says what it is: `kind: "digest"` is
   * shared with the cycle-hygiene card and model-authored triage, severity is shared too (cycle maps a Linear
   * priority onto the same three colours), and a citation proves only that there is evidence. A `P3` on a
   * ticket that has sat still for twelve days would be a priority the matrix never derived.
   */
  alerts: strictForm({
    /**
     * What the windows BEFORE this one counted: two raw numbers and never the ratio, for the reason
     * `./trend.ts`'s overview gives. Absent when no baseline was read, which omits the TL;DR clause entirely.
     */
    trend: strictForm({
      /** The baseline's total, over the same population {@link alertsCurrentTotal} sums for this window. */
      priorTotal: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      /** How many windows that total is spread over. Bounded so the derived clause's width is provable. */
      priorWindows: z.number().int().min(1).max(ALERT_TREND_PRIOR_WINDOWS_MAX),
    }).optional(),
  }).optional(),
  /** A scheduled digest's day-one opening lines, carried onto the card unchanged — `UpdateArtifact.intro`. */
  intro: introSchema.optional(),
  items: z.array(digestItemSchema).min(1).max(TABLE_MAX_ROWS),
  kind: z.literal("digest"),
  /** The subject, used to build the TL;DR (`Knock 24h · …`). */
  label: z.string().min(1).max(DIGEST_LABEL_MAX),
  /** The authored clause after the counts — the one editorial sentence in the whole card. */
  lead: z.string().min(1).max(DIGEST_LEAD_VISIBLE_MAX).optional(),
  /**
   * The act that would clear each firing item, and the opportunities nothing alerted on — rendered first below
   * the fold (`./recommendations.ts`). The verb selects these; the form only carries what it chose.
   */
  recommendations: z.array(recommendationFormSchema).max(RECOMMENDATIONS_MAX).optional(),
  /** The observation window, rendered into the TL;DR and used as the count column's header. */
  window: z.string().min(1).max(DIGEST_WINDOW_MAX),
});

/** The alert-digest form: domain facts plus bounded prose, with no layout in it. */
export type DigestForm = z.infer<typeof digestFormFields>;

/** What deriving a digest produced: the card, and what the caller should say about it on stderr. */
export interface DigestDerivation {
  readonly artifact: UpdateArtifact;
  /** Owner keys that did not resolve and rendered as visible plain text. */
  readonly unresolvedOwners: readonly string[];
  /** One line per derived sentence the card left out so the rest would fit — never a silent drop. */
  readonly warnings: readonly string[];
}
