"use client";

import { type ReactElement, useState } from "react";

import { cn } from "../../lib/utils";

import { type ContextEntry, contextEntries, entryOf, type WorkContext } from "../../lib/workContext";
import { SlopweaverMark } from "../SlopweaverMark";
import { TeamMark } from "../TeamMark";
import { useTeamLabel } from "./organisationState";
import { useWorkContext } from "./workContextState";

/**
 * The trigger and every menu item: one row, the mark then the name, filling the width. Colour is not set:
 * the console's own `button` rule makes the trigger inherit it, and the menu names its items ink.
 */
const ITEM =
  "flex w-full cursor-pointer items-center gap-[0.55rem] rounded-[8px] border border-solid px-2 py-[0.4rem] text-left";

/** A context's name beside its mark, shrinking before the mark does; hidden on the icon rail. */
const TEXT =
  "min-w-0 flex-auto group-data-[sidebar=icons]/console:hidden [&_b]:block [&_b]:text-[0.84rem] [&_b]:leading-[1.2]";

/**
 * A context's own mark: the team mark for the organisation's work, the Slopweaver logo for its own repository.
 *
 * @param context the context the mark names
 * @returns the mark, decorative — the context's name sits beside it
 */
export function ContextMark({ context }: { context: WorkContext }): ReactElement {
  return (
    <span className="inline-flex flex-none overflow-hidden rounded-[6px] outline outline-border" aria-hidden="true">
      {context === "work" ? <TeamMark size={26} /> : <SlopweaverMark size={26} />}
    </span>
  );
}

/**
 * The account-style switcher at the top of the sidebar: the context the console is showing, and the two
 * to choose from, each carrying its own mark (the team's a role drawing, no organisation's logo).
 *
 * Cloudflare's shape: always visible, always naming what the owner is looking at, one click to
 * change. Collapsed to the icon rail it is the mark alone, and the menu still opens from it. No provider is
 * touched by a switch — every page keeps its readings and hides the rows that name the other context's
 * repository.
 *
 * Its root carries `data-context`, the drawn context: the sidebar mounts it on every console page, the Queue
 * included, which has no page head and so no `ContextChip`. `desktop e2e --context` waits on it.
 *
 * @returns the switcher
 */
export function ContextSwitcher(): ReactElement {
  const { context, setContext } = useWorkContext();
  const [open, setOpen] = useState(false);
  const teamLabel = useTeamLabel();
  const entry = entryOf({ context, teamLabel });
  // Hover on the work context says where its name came from.
  const hoverOf = (option: ContextEntry): string => {
    if (option.id === "work") {
      return `${option.sub} (the organisation this install works for, as \`slopweaver org set\` wrote it)`;
    }
    return option.sub;
  };
  return (
    <div className="relative m-0" data-context={context} data-open={open ? "true" : "false"}>
      <button
        type="button"
        className={cn(
          ITEM,
          "sw-glass-control hover:bg-(--c-panel) group-data-[sidebar=icons]/console:justify-center group-data-[sidebar=icons]/console:p-[0.3rem]",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${entry.label}: ${hoverOf(entry)}. Click to switch context.`}
        onClick={() => {
          setOpen((held) => !held);
        }}
      >
        <ContextMark context={context} />
        <span className={TEXT}>
          <b>{entry.label}</b>
        </span>
        <span
          className="flex-none text-[0.75rem] text-muted-foreground group-data-[sidebar=icons]/console:hidden"
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      {open ? (
        <ul
          className="absolute top-[calc(100%+0.25rem)] right-0 left-0 z-20 m-0 min-w-56 list-none rounded-[10px] border border-solid sw-glass sw-glass-panel p-[0.3rem] group-data-[sidebar=icons]/console:right-auto [&>li+li]:mt-[0.2rem]"
          aria-label="context"
        >
          {contextEntries({ teamLabel }).map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className={cn(
                  ITEM,
                  "border-transparent bg-transparent text-foreground hover:bg-(--c-panel) aria-pressed:bg-card",
                )}
                aria-pressed={option.id === context}
                title={hoverOf(option)}
                onClick={() => {
                  setContext(option.id);
                  setOpen(false);
                }}
              >
                <ContextMark context={option.id} />
                <span className={TEXT}>
                  <b>{option.label}</b>
                </span>
                {option.id === context ? <span className="text-[0.8rem] text-primary">✓</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
