/*
 * The opened card's Checked section and what the owner has said since it was asked, as `./PanelReasoning.tsx` draws them:
 * hook-free, so a test renders it to markup and counts what reaches the page before anything is opened.
 */
import type { ReactElement } from "react";

import type { CardCurrency, SaidFold, SaidRow } from "../../lib/cardCurrency";

/**
 * One thing the owner said since: where and how long ago, then their own words — the opening on the row's line and the whole of
 * them behind opening it. No instant anywhere, the hover included: the age is the time a person reads. A row the
 * reading carries no words for says where it was said.
 *
 * @param row the row
 * @returns the row
 */
function SaidSinceRow({ row }: { row: SaidRow }): ReactElement {
  if (row.said === undefined || row.lead === undefined) {
    return <p>{row.where}.</p>;
  }
  if (!row.more) {
    return (
      <p>
        {row.where}: <q className="italic">{row.lead}</q>
      </p>
    );
  }
  return (
    <details>
      <summary className="cursor-pointer">
        {row.where}: <q className="italic">{row.lead}</q>
      </summary>
      <blockquote className="m-0 mt-1 border-l-2 border-primary/40 pl-2 whitespace-pre-wrap">
        {row.said.cut === "start" && <span className="text-muted-foreground">the record kept only the end … </span>}
        {row.said.text}
        {row.said.cut === "end" && <span className="text-muted-foreground"> … the record holds the rest</span>}
      </blockquote>
    </details>
  );
}

/**
 * What the owner said since, SHUT behind its count. It takes the fold and nothing else, and draws no `open`: the list a card
 * once ran twenty screens with can reach the page only from inside this closed `<details>`.
 *
 * @param fold the said-since fold
 * @returns the fold
 */
export function SaidSince({ fold }: { fold: SaidFold }): ReactElement {
  return (
    <details data-said-since className="mb-2">
      <summary className="cursor-pointer text-[0.8rem]">{fold.summary}</summary>
      {fold.groups.map((group) => (
        <section key={group.heading} className="mt-2">
          <h5 className="m-0 mb-1 text-[0.75rem] text-muted-foreground">{group.heading}</h5>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {group.rows.map((row, at) => (
              <li key={`${row.atIso} ${String(at)}`} className="wrap-anywhere">
                <SaidSinceRow row={row} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </details>
  );
}

/**
 * The opened card's whole Checked section, SHUT behind one line: "Checked · facts checked 3.9d ago · not your steers".
 * Its lines and the fold inside it reach the page only once the owner opens it, so the block at the bottom of a Queue
 * card is tucked under a fold rather than filling the page.
 *
 * @param mark the card's currency mark
 * @returns the fold
 */
export function CheckedFold({ mark }: { mark: CardCurrency }): ReactElement {
  return (
    <details data-checked>
      <summary className="cursor-pointer text-[0.8rem] text-muted-foreground">Checked · {mark.words}</summary>
      <div className="mt-2">
        {mark.lines.map((line) => (
          <p key={line} className="text-muted-foreground wrap-anywhere">
            {line}
          </p>
        ))}
        {mark.said !== undefined && <SaidSince fold={mark.said} />}
      </div>
    </details>
  );
}
