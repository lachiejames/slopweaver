/**
 * The shapes an opened Queue card's properties block draws — priority, related items, workstreams, the two people
 * properties and the whole block. Split out of `./cardProperties.ts`, which computes them.
 */

import type { CardPerson } from "./personMentions";
/** A card's priority, and whether anybody chose it. */
export interface CardPriority {
  readonly band: string;
  /** `chosen` when a row states it as a judgement; `default` when it is a kind or tier default. */
  readonly source: "chosen" | "default";
  /** Where the band came from, in the words the panel prints beside it — never a row's slug. */
  readonly why: string;
}

/** One thing a card is related to. The slug is where a row's chip links, never what it reads as. */
export type RelatedItem =
  | { readonly kind: "row"; readonly slug: string; readonly label: string; readonly status: string }
  | { readonly kind: "blocked-by"; readonly slug: string; readonly label: string }
  | { readonly kind: "pr"; readonly label: string; readonly href: string };

/**
 * A workstream the card belongs to: read from the register, the register still reading or failing to read, or a
 * register that holds no workstream by this name.
 */
export type CardWorkstream =
  | { readonly kind: "loading"; readonly id: string; readonly href: string }
  | { readonly kind: "failed"; readonly id: string; readonly href: string; readonly why: string }
  | {
      readonly kind: "read";
      readonly id: string;
      readonly href: string;
      readonly name: string;
      readonly progress: string;
    }
  | { readonly kind: "unread"; readonly id: string; readonly href: string; readonly why: string };

/**
 * Who one people property lists; or that the read it comes from is in flight or failed, with the failure's reason;
 * or why the card records nobody.
 */
export type PeopleProperty =
  | { readonly kind: "listed"; readonly people: readonly CardPerson[]; readonly unresolved: readonly string[] }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly why: string }
  | { readonly kind: "unread"; readonly why: string };

/** Everything the properties block draws. */
export interface CardProperties {
  readonly status: { readonly value: string; readonly source: "row" | "record" };
  readonly priority: CardPriority;
  /** Every `workstream=` the card carries; empty draws no line. */
  readonly workstreams: readonly CardWorkstream[];
  readonly related: readonly RelatedItem[];
  /** Who this one message tags; `undefined` on a card that is no message, which draws no line. */
  readonly tagged: PeopleProperty | undefined;
  /** Who is in the thread it lands in; `undefined` on a card that lands in no thread, which draws no line. */
  readonly thread: PeopleProperty | undefined;
  /**
   * Drawn under the block while the board has not wholly answered, so the rows the card belongs to are not all known:
   * a spinner while it reads, a staleness mark with the reason when it failed or read only in part. `undefined` once
   * the board answered whole.
   */
  readonly board: { readonly kind: "reading" } | { readonly kind: "failed"; readonly why: string } | undefined;
  /**
   * Said under the block, each the data rather than a failed read: a slug naming several rows, and that who the owner is was
   * not read off any message, so they may be listed among the people.
   */
  readonly caveats: readonly string[];
}
