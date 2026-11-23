"use client";

import type { ReactElement } from "react";

import { isTickList, tickedLines, ticksKey, toggledTicks } from "../../lib/checklistTicks";
import { citedSource, opensNowhere } from "../../lib/citationDisplay";
import type { StepChecklistLine } from "../../lib/queueCard";
import { CopyBlock } from "./CopyBlock";
import { InlineText } from "./InlineText";
import { usePreference } from "./preference";

/**
 * A line's page, linked — or, for one that opens nowhere (`opensNowhere`: a board row, a retired page), its place with no link.
 *
 * @param url the page the line sends the owner to
 * @returns the address
 */
function LineAddress({ url }: { url: string }): ReactElement {
  const reference = { kind: "address", url } as const;
  if (opensNowhere({ reference })) {
    return <span className="text-[0.75rem] text-muted-foreground">{citedSource({ reference }).place}</span>;
  }
  return (
    <a className="text-[0.75rem] wrap-anywhere underline" href={url} target="_blank" rel="noreferrer">
      {url}
    </a>
  );
}

/**
 * A hand step's script: one numbered, tickable line each — the sentence, where the value it needs sits on the
 * page, the page, and its one command as a copy block of its own. Two `secrets set`
 * lines are two copy blocks, so the owner runs them one at a time.
 *
 * A tick is the owner's progress mark, kept in this browser; it settles nothing (`../../lib/checklistTicks.ts`).
 *
 * @param subject the step's id, which keys its ticks
 * @param lines the checklist, as recorded
 * @param known the pull-request URLs the row publishes
 * @returns the list
 */
export function HandChecklist({
  subject,
  lines,
  known,
}: {
  subject: string;
  lines: readonly StepChecklistLine[];
  known: readonly string[];
}): ReactElement {
  const ticks = usePreference({ accept: isTickList, fallback: "", key: ticksKey({ subject }) });
  const ticked = tickedLines({ count: lines.length, stored: ticks.value });
  return (
    <ol className="m-0 grid list-none gap-[0.7rem] p-0">
      {lines.map((line, index) => {
        const done = ticked.has(index);
        const id = `${subject}-line-${String(index)}`;
        return (
          <li key={id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-[0.55rem] gap-y-[0.35rem]">
            <input
              id={id}
              type="checkbox"
              className="mt-[0.3rem]"
              checked={done}
              onChange={() => {
                ticks.set(toggledTicks({ count: lines.length, index, stored: ticks.value }));
              }}
            />
            <div className="grid min-w-0 gap-[0.35rem]">
              <label htmlFor={id} className={done ? "text-muted-foreground line-through" : undefined}>
                <span className="mr-[0.35rem] font-mono text-[0.75rem] text-muted-foreground">{index + 1}.</span>
                <InlineText text={line.action} known={known} />
              </label>
              {line.find !== undefined && (
                <span className="text-[0.75rem] text-muted-foreground">
                  Find it under: <b className="text-foreground">{line.find.join(" › ")}</b>
                </span>
              )}
              {line.url !== undefined && <LineAddress url={line.url} />}
              {line.command !== undefined && <CopyBlock text={line.command} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
