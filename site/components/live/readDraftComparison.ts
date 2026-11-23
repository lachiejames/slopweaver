/**
 * The comparison half of a `slack draft list --json` row: whether Codex drafted the same message beside the
 * original (`src/outbound/slack/draftComparison.ts`), its words while the owner has chosen neither, and the owner's pick once the owner has.
 *
 * Same discipline as `./readSlackDrafts.ts`, which calls this: a present comparison that will not read refuses the
 * row, so a card never offers a choice between two drafts it could only draw one of. The words reader is passed in
 * rather than imported, so the two modules do not import each other.
 */

import { type Bag, str, strings, sub } from "../../lib/bag";
import type { DraftMention } from "./readSlackDrafts";
import type { DraftLine } from "./readSlackDraftsRuns";

/** One variant's words, read exactly as the row's own are. */
export interface DraftVariantWords {
  readonly digest: string;
  readonly lines: readonly DraftLine[];
  readonly fallback: string;
  readonly mentions: readonly DraftMention[];
  readonly advisory: readonly string[];
}

/** Every state a comparison folds to, closed: an unknown one refuses the row. */
const STATES = ["pending", "skipped", "unavailable", "refused", "ready"] as const;

/** The two drafts a pick chooses between. */
const VARIANTS = ["original", "codex"] as const;

/** Which host composed the original, as the recording read it off its own session. */
const COMPOSERS = ["claude-code", "codex", "undetected"] as const;

/** A row's comparison, as the card draws it. */
export interface DraftComparisonView {
  readonly state: (typeof STATES)[number];
  /** Why there is no Codex draft to choose: the skip reason, the unavailable reason, or the refusal. */
  readonly detail: string | undefined;
  /** The model Codex's draft was asked of, once one is ready. */
  readonly model: string | undefined;
  /** Who composed the original; absent on a row recorded before the field. */
  readonly composer: (typeof COMPOSERS)[number] | undefined;
  /** Codex's words, while they are ready and the owner has chosen neither — the B a card offers. */
  readonly codex: DraftVariantWords | undefined;
  /**
   * True when Codex's words drop the receipt the original links to, as `slack draft list --json` decided it
   * (`codexDropsReceipts`): the card says so beside B and does not offer B, which `slack draft pick` refuses.
   */
  readonly codexDropsReceipts: boolean;
  /** The original's words once a Codex pick replaced them, so the swap is never invisible. */
  readonly original: DraftVariantWords | undefined;
  readonly pick: { readonly variant: (typeof VARIANTS)[number]; readonly atIso: string } | undefined;
}

/**
 * Whether the send waits on the owner's pick: a Codex draft ready or still coming beside the original, and neither chosen. The
 * send verb refuses such a row, so the card must not call its command the one that posts it.
 *
 * @param comparison the row's comparison, absent on a row that never owed one
 * @returns true while the owner's pick is owed
 */
export function pickOwed({ comparison }: { comparison: DraftComparisonView | undefined }): boolean {
  if (comparison === undefined || comparison.pick !== undefined) {
    return false;
  }
  return comparison.state === "ready" || comparison.state === "pending";
}

/** Reads one variant's words off a bag carrying `digest`, `payload`, `mentions` and `advisory`. */
export type VariantWordsReader = (args: { bag: Bag }) => DraftVariantWords | undefined;

/** Why a pass left no Codex draft, in one line. */
function detailOf({ comparison, state }: { comparison: Bag; state: DraftComparisonView["state"] }): string | undefined {
  if (state === "skipped" || state === "unavailable") {
    return str({ bag: comparison, key: "reason" });
  }
  if (state === "refused") {
    const stage = str({ bag: comparison, key: "stage" });
    const reasons = strings({ bag: comparison, key: "reasons" });
    if (stage === undefined || reasons === undefined) {
      return undefined;
    }
    return `${stage}: ${reasons.join("; ")}`;
  }
  return undefined;
}

/** The owner's pick, `undefined` when the owner has made none, or `"malformed"`. */
function pickOf({ item }: { item: Bag }): DraftComparisonView["pick"] | "malformed" {
  if (item["pick"] === undefined) {
    return undefined;
  }
  const pick = sub({ bag: item, key: "pick" });
  const variant = VARIANTS.find((one) => pick !== undefined && one === str({ bag: pick, key: "variant" }));
  const atIso = pick === undefined ? undefined : str({ bag: pick, key: "atIso" });
  if (variant === undefined || atIso === undefined) {
    return "malformed";
  }
  return { atIso, variant };
}

/** The inline style flags the card draws; Codex's draft carrying any other would draw unlike what Slack shows. */
const DRAWN_FLAGS = new Set(["bold", "code", "italic"]);

/**
 * Whether every inline `style` bag under `value` names only flags the card draws. The original's reader drops an
 * undrawn flag, since a correction strikes through its own words; Codex's draft refuses one instead, as `src/outbound/slack/richTextShape.ts` does when the register is read.
 */
function stylesDrawn({ value }: { value: unknown }): boolean {
  if (Array.isArray(value)) {
    return value.every((child: unknown) => stylesDrawn({ value: child }));
  }
  if (typeof value !== "object" || value === null) {
    return true;
  }
  return Object.entries(value).every(([key, child]) => {
    const styleBag = key === "style" && typeof child === "object" && child !== null;
    if (styleBag) {
      return Object.keys(child).every((flag) => DRAWN_FLAGS.has(flag));
    }
    return stylesDrawn({ value: child });
  });
}

/**
 * Read a row's comparison.
 *
 * @param item the listed row, carrying `comparison`, `pick` and `original` when it has them
 * @param draft the row's parked draft, which names its composer
 * @param wordsOf the row's own words reader
 * @returns the comparison, `undefined` on a row that never owed one, or `"malformed"`
 */
export function draftComparisonOf({
  item,
  draft,
  wordsOf,
}: {
  item: Bag;
  draft: Bag;
  wordsOf: VariantWordsReader;
}): DraftComparisonView | undefined | "malformed" {
  if (item["comparison"] === undefined) {
    return undefined;
  }
  const comparison = sub({ bag: item, key: "comparison" });
  const state = STATES.find((one) => comparison !== undefined && one === str({ bag: comparison, key: "state" }));
  const pick = pickOf({ item });
  if (comparison === undefined || state === undefined || pick === "malformed") {
    return "malformed";
  }
  const candidate = sub({ bag: comparison, key: "candidate" });
  const codex = candidate === undefined ? undefined : wordsOf({ bag: candidate });
  const originalBag = sub({ bag: item, key: "original" });
  const original = originalBag === undefined ? undefined : wordsOf({ bag: originalBag });
  const model = str({ bag: comparison, key: "requestedModel" });
  const readyUnread =
    state === "ready" && (codex === undefined || model === undefined || !stylesDrawn({ value: candidate }));
  const originalUnread = item["original"] !== undefined && original === undefined;
  // Only a ready outcome carries Codex's words and model, as the register's own reader holds it: one on any other state
  // is a shape no fold writes, and drawing it would offer a choice nothing produced.
  const misplaced = state !== "ready" && (comparison["candidate"] !== undefined || model !== undefined);
  // Present only as `true`, and only beside a B still on offer: anything else is a verdict no list printed.
  const drops = item["codexDropsReceipts"];
  const dropsUnread = drops !== undefined && (drops !== true || state !== "ready" || pick !== undefined);
  if (readyUnread || originalUnread || misplaced || dropsUnread) {
    return "malformed";
  }
  return {
    codex: pick === undefined ? codex : undefined,
    codexDropsReceipts: drops === true,
    composer: COMPOSERS.find((one) => one === str({ bag: draft, key: "composer" })),
    detail: detailOf({ comparison, state }),
    model,
    original,
    pick,
    state,
  };
}
