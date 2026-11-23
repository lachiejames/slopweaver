"use client";

/*
 * The panels `?open=` lands on when no register draws the row it names in this context — no register holds it, a
 * gate refused it, the work context hides it, or following the link means switching context. In their own file so `./QueuePanels.tsx`
 * stays under the line cap; a row the owner's words took off the list is none of these, and draws its own panel there.
 */
import { type ReactElement, useEffect } from "react";

import type { QueueRow } from "../../lib/queueRows";
import type { WithheldQueueRow } from "../../lib/queueWithholding";
import { entryOf } from "../../lib/workContext";
import { contextToOpen } from "../../lib/workspacePlacementContext";
import { SLIDE_BODY, SlideOver } from "../live/SlideOver";
import { CHIP } from "./controls";
import { useTeamLabel } from "./organisationState";
import { ReasonLines } from "./ReasonLines";
import { useWorkContext } from "./workContextState";

/**
 * The panel shown when `?open=` names a row no register currently holds.
 *
 * @returns the panel
 */
export function MissingPanel({ opened, onClose }: { opened: string; onClose: () => void }): ReactElement {
  return (
    <SlideOver label="no such row" tag={<span className={CHIP}>gone</span>} title={opened} onClose={onClose}>
      <div className={SLIDE_BODY}>
        <p className="py-4 text-muted-foreground">
          No register currently holds a row named <code>{opened}</code>. It was settled, answered, steered or swept
          since the link was made, or the link never named one.
        </p>
      </div>
    </SlideOver>
  );
}

/**
 * The panel shown when `?open=` names a card a gate refused (`../../lib/queueWithholding.ts`): never the card, whose
 * substance is what the gate would not draw, only that it is held and which check held it.
 *
 * @param row the withheld card, as the withholding names it
 * @returns the panel
 */
export function WithheldPanel({ row, onClose }: { row: WithheldQueueRow; onClose: () => void }): ReactElement {
  return (
    <SlideOver label="held off the Queue" tag={<span className={CHIP}>held</span>} title={row.title} onClose={onClose}>
      <div className={SLIDE_BODY}>
        <p className="py-4 text-muted-foreground">
          This card failed its own checks, so it is held off your Queue until the supervisor fixes it.
        </p>
        <details className="text-[0.82rem] text-muted-foreground">
          <summary className="cursor-pointer">Which check</summary>
          {/* A `<div>`, never a `<p>`: a quoted read's reason folds its full message beneath (`./ReasonLines.tsx`).
              No `known`, so the check's own sentence stays plain text as it always was, never chipped (Codex r3-01). */}
          <div className="mt-2">
            <ReasonLines reason={row.why} />
          </div>
        </details>
      </div>
    </SlideOver>
  );
}

/**
 * The panel shown when `?open=` names a row the WORK CONTEXT filter is hiding rather than one that is gone.
 *
 * @returns the panel
 */
export function HiddenPanel({ opened, onClose }: { opened: string; onClose: () => void }): ReactElement {
  return (
    <SlideOver
      label="hidden by the context"
      tag={<span className={CHIP}>hidden</span>}
      title={opened}
      onClose={onClose}
    >
      <div className={SLIDE_BODY}>
        <p className="py-4 text-muted-foreground">
          A register still holds <code>{opened}</code>, but the work context you are in hides it. Switch context at the
          top of the sidebar to open it.
        </p>
      </div>
    </SlideOver>
  );
}

/**
 * The panel a deep link lands on when the work context hides the row it names: it switches to the row's
 * context, and the row's own panel replaces this one on the next render.
 *
 * A link names one row, so following it IS choosing that row's context, rather than landing on a "switch
 * context at the top of the sidebar" note instead of the row. The residue — a row
 * no context would show, because a press here just settled it — keeps the plain hidden note.
 *
 * @param row the row a register holds under the linked key
 * @returns the switching panel, or the hidden note when there is no context to switch to
 */
export function SwitchingPanel({ row, onClose }: { row: QueueRow; onClose: () => void }): ReactElement {
  const { context, setContext } = useWorkContext();
  const teamLabel = useTeamLabel();
  const target = contextToOpen({ context, placement: row.placement });
  useEffect(() => {
    if (target !== undefined) {
      setContext(target);
    }
  }, [target, setContext]);
  if (target === undefined) {
    return <HiddenPanel opened={row.key} onClose={onClose} />;
  }
  return (
    <SlideOver
      label="switching context"
      tag={<span className={CHIP}>switching</span>}
      title={row.key}
      onClose={onClose}
    >
      <div className={SLIDE_BODY}>
        <p className="py-4 text-muted-foreground">
          <code>{row.key}</code> is a {entryOf({ context: target, teamLabel }).label} row. Switching to that context to
          open it.
        </p>
      </div>
    </SlideOver>
  );
}
