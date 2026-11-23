"use client";

/**
 * The one row shape every state page draws: one line above the fold, the detail behind a disclosure the
 * reader opens. Shared by /fleet and the pull-request page, so a row on either reads the same.
 */
import type { ReactElement, ReactNode } from "react";

import { opensNowhere } from "../../lib/citationDisplay";

/**
 * The row: a faint rule under it, and its summary one flex line — tag, lead, then whatever the page adds —
 * sitting on one baseline.
 */
export const ROW =
  "border-b border-border/60 text-[0.82rem] leading-[1.5] [&>summary]:flex [&>summary]:cursor-pointer [&>summary]:items-baseline [&>summary]:gap-[0.6rem] [&>summary]:py-[0.4rem]";

/**
 * The state word before the lead. A fixed width, not a minimum: a long kind like
 * OPEN-INTERNAL-FINDING-PULL-REQUEST would otherwise push its own lead two inches right of every other row,
 * and a column that only lines up sometimes is not one. The whole word is on the element as a title.
 */
export const ROW_TAG =
  "w-44 flex-none truncate font-mono text-[0.68rem] tracking-[0.03em] text-muted-foreground uppercase";

/**
 * The lead, clipped to ONE line on purpose. A row that wraps to three stops being a row, and the whole string
 * is in the fold a click away — so nothing is lost, only deferred.
 */
export const ROW_LEAD = "truncate";

/** The owner's words under a lead: one muted italic line, clipped like the lead, the whole quote on hover and in the fold. */
export const ROW_QUOTE = "truncate text-[0.76rem] text-muted-foreground italic";

/** The fold, indented past the tag column so its lines start under the lead. */
export const ROW_FOLD = "pt-[0.35rem] pb-[0.7rem] pl-[11.6rem] text-[0.76rem]";

/** The fold's first line: the next act, in the verb's own sentence. */
export const ROW_NEXT = "mt-0 mb-[0.35rem] font-semibold";

/**
 * A labelled line in a fold, the label a fixed-width column so the values line up. Only the label: a citation chip in
 * the value is spans too, and a column's width on its icon draws a bar.
 */
export const ROW_FIELD =
  "mt-0 mb-1 text-muted-foreground [&>span:first-child]:inline-block [&>span:first-child]:min-w-[5.5rem] [&>span:first-child]:font-semibold";

/** The verb's own lines, verbatim, as a small monospace list. */
export const ROW_DETAIL = "m-0 list-disc pl-[1.1rem] font-mono text-[0.7rem] text-muted-foreground";

/** How many a heading holds, in quiet monospace beside it. */
export const COUNT = "font-mono text-[0.68rem] font-normal text-muted-foreground";

/**
 * One thing, as one line, with everything else behind a disclosure the reader opens.
 *
 * This is the page's whole shape rather than a styling choice: one line per thing above the fold with the
 * detail below is one of the four standing UI laws, and a section that renders its detail inline is the
 * wall of text those laws exist to prevent.
 *
 * @param lead the one line — what this thing is
 * @param tag the short state word drawn before the lead
 * @param quote the owner's own words behind the row, drawn verbatim as a second muted line under the lead and clipped to
 *   one line like it, so the row reads beside what the owner said; absent, the row is one line
 * @param children the fold, rendered only once the reader opens it
 * @returns the row
 */
export function Row({
  lead,
  tag,
  quote,
  children,
}: {
  lead: ReactNode;
  tag: string;
  quote?: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <details className={ROW}>
      <summary>
        {/* The tag is clipped by CSS to keep every lead on one column, so the whole word is carried as the
            title — an abbreviation a reader cannot expand is just a different way of losing it. */}
        <span className={ROW_TAG} title={tag}>
          {tag}
        </span>
        {quote === undefined ? (
          <span className={ROW_LEAD}>{lead}</span>
        ) : (
          <span className="flex min-w-0 flex-col">
            <span className={ROW_LEAD}>{lead}</span>
            <span className={ROW_QUOTE} title={quote}>
              “{quote}”
            </span>
          </span>
        )}
      </summary>
      <div className={ROW_FOLD}>{children}</div>
    </details>
  );
}

/**
 * A subject the register recorded, as a link when it recorded a URL and as its own text otherwise.
 *
 * The register holds both kinds — a pull request's URL and a bare handover slug — and neither is rewritten
 * here. Linking the one that is already an address is the only difference.
 *
 * @param subject what the act was taken on, exactly as the ledger holds it
 * @returns the lead for that act's row
 */
export function Subject({ subject }: { subject: string }): ReactElement {
  // An address under a page the console no longer has opens nowhere, so it stays its own text.
  const links = subject.startsWith("https://") && !opensNowhere({ reference: { kind: "address", url: subject } });
  if (links) {
    return (
      <a href={subject} rel="noreferrer">
        {subject.replace("https://github.com/", "")}
      </a>
    );
  }
  return <>{subject}</>;
}

/**
 * A field the register genuinely may omit, drawn as the absence it is rather than skipped.
 *
 * A skipped line reads as "there is nothing to say here", which is a different claim from "the record does
 * not carry this". Written as a function rather than `value ?? …` — the house ban on silent fallback.
 *
 * @param label what the field is
 * @param value the field, absent when the record did not carry it
 * @returns the line
 */
export function Field({ label, value }: { label: string; value: string | ReactElement | undefined }): ReactElement {
  if (value === undefined) {
    return (
      <p className={ROW_FIELD}>
        <span>{label}</span> the record does not carry this
      </p>
    );
  }
  return (
    <p className={ROW_FIELD}>
      <span>{label}</span> {value}
    </p>
  );
}
