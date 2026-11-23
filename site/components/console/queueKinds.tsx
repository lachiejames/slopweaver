/*
 * The queue's registers as a closed vocabulary — the eight kinds, each one's word for itself, its icon and
 * the ALLOWLIST ROW it is read from — kept apart from the card so `Queue.tsx` holds the panels and the rows.
 *
 * Each kind names a `slug`, never a verb line: the slug is the allowlist row in `site/lib/liveVerbs.ts`, so
 * this vocabulary and the fetch that fills it are one fact rather than two strings nothing compares.
 */

import type { ReactElement } from "react";
import { cn } from "../../lib/utils";

/** The eight registers, in the order the page lists them. */
export type Kind = "hand" | "ask" | "draft" | "post" | "review" | "import" | "pr" | "act";

/** Each register's word for itself, its icon letter and the allowlist row it is read from. */
export const KINDS: Record<
  Kind,
  { readonly label: string; readonly glyph: string; readonly slug: string; readonly why: string }
> = {
  act: {
    glyph: "act",
    label: "Done without asking",
    slug: "autonomy",
    why: "the autonomy ledger holds no word from you on this act; the row is unsteered until you give one",
  },
  ask: {
    glyph: "ask",
    label: "Recorded ask",
    slug: "board",
    why: "the board marks this run parked on you: its row carries a recorded question",
  },
  draft: {
    glyph: "reply",
    label: "Held reply",
    slug: "drafts",
    why: "the door held this reply rather than sending it, and the register still holds it",
  },
  hand: {
    glyph: "hands",
    label: "Your hands",
    slug: "hands",
    why: "a session recorded this as a step only your hands can take, and the register still holds it open",
  },
  post: {
    glyph: "post",
    label: "Waiting on your word",
    slug: "slack-drafts",
    why: "a session composed this under your own name and parked it; nothing has been sent, and nothing can send it but you",
  },
  review: {
    glyph: "review",
    label: "Review under your name",
    slug: "review-drafts",
    why: "a session reviewed somebody else's pull request and parked the review as draft line comments; nothing has reached GitHub, and nothing can post it but you",
  },
  import: {
    glyph: "import",
    label: "Import question",
    slug: "import-questions",
    why: "a store import staged this question and nothing it staged is applied until you answer it",
  },
  pr: {
    glyph: "PR",
    label: "Your judgment",
    slug: "landing-reading",
    why: "github landing's own dispatch verdict on this pull request is needs-owner-judgment; it refused to hand it to a session",
  },
};

/**
 * Each register's own hue, as the `--sw-kind` custom property the tile fills with and a queue row draws its stripe
 * in. A post has none: its tile has no fill, so its word takes the page's own ink rather than the tiles' white,
 * which vanishes on a light ground, and its stripe falls back to the border's tone.
 */
const KIND_HUE: Record<Kind, string> = {
  act: "[--sw-kind:oklch(0.5_0.13_185)]",
  ask: "[--sw-kind:oklch(0.5_0.15_265)]",
  draft: "[--sw-kind:oklch(0.5_0.15_330)]",
  hand: "[--sw-kind:oklch(0.5_0.14_60)]",
  post: "text-foreground",
  review: "[--sw-kind:oklch(0.5_0.12_145)]",
  import: "[--sw-kind:oklch(0.5_0.13_25)]",
  pr: "[--sw-kind:oklch(0.32_0.02_250)] border border-border",
};

/**
 * The class that sets a register's hue on an element, so a row and its tile read one map. The pull request's
 * hue is a near-black, so it carries a border to stay visible on the card.
 *
 * @returns the classes
 */
export function kindHue({ kind }: { kind: Kind }): string {
  return KIND_HUE[kind];
}

/**
 * The platform tile drawn before a row and a panel title.
 *
 * It carries the register's own WORD, not a letter. A literal question mark in a coloured square, one column left of
 * the provenance glyph's `EV`/`SW`/`CR`, reads as a broken profile picture beside a badge. A tile that says
 * `ask` cannot be mistaken for one.
 *
 * @param size `head` is the taller tile a panel's title leads with
 * @param className placement the caller owns — a row's nudge, the dimmed "more" row
 * @returns the tile
 */
export function Icon({
  kind,
  size = "row",
  className,
}: {
  kind: Kind;
  size?: "row" | "head";
  className?: string;
}): ReactElement {
  return (
    <span
      className={cn(
        "grid min-w-[2.25rem] place-items-center rounded-[7px] bg-(--sw-kind) px-[0.42rem] font-bold tracking-[0.03em] text-[oklch(0.98_0_0)] lowercase",
        size === "head" ? "h-[1.7rem] text-[0.72rem]" : "h-6 text-[0.66rem]",
        kindHue({ kind }),
        className,
      )}
      data-kind={kind}
      aria-hidden="true"
    >
      {KINDS[kind].glyph}
    </span>
  );
}
