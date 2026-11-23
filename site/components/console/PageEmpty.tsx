"use client";

/**
 * The designed empty state every console page draws for a PROVEN empty reading: what will appear here, what makes it
 * appear, and at most one action — Settings → Models while no plan is known connected, or the connect step the page
 * waits on. The Setup page lives in the Settings modal, so the button opens it there. Only a measured zero draws it: a reading still loading, failed or stale
 * keeps its spinner or staleness mark, so this never stands in for data it could not read. Which action is drawn is
 * `../../lib/pageEmpty.ts`'s decision.
 */
import type { ReactElement } from "react";

import { noPlanConnectedOf, type PageEmptyRequestedAction, pageEmptyActionOf } from "../../lib/pageEmpty";
import { type PlanLimitsView, readPlanLimits } from "../live/readPlanLimits";
import { useLive } from "../live/useLive";
import { Button } from "../ui/button";
import { ConnectIntegration } from "./ConnectIntegration";
import { useSettingsModal } from "./SettingsModal";

/** An empty list's box: the padding and muted ink a page's empty words sit in. */
export const EMPTY = "m-0 px-[1.2rem] py-[1.4rem] text-[0.85rem] text-muted-foreground";

/** Which empty state this is — the value of the `data-page-empty` mark `desktop e2e` reads. */
export type PageEmptySurface =
  | "alignment-acts"
  | "alignment-rulings"
  | "alignment-voice"
  | "automations"
  | "fleet"
  | "fleet-activity"
  | "pull-requests"
  | "queue"
  | "workstreams";

/**
 * A page's designed empty state. It reads the shared plans channel the sidebar's Settings dot already keeps polled, so
 * it adds no read of its own; while that cannot answer, the Plans button is withheld and the words stay.
 *
 * @param title what will appear here, said plainly
 * @param appearsWhen what makes it appear
 * @param action the action the page asks for; Plans is drawn only while no plan is known connected
 * @param surface the page or section, carried as the `data-page-empty` mark
 * @returns the empty state
 */
export function PageEmpty({
  title,
  appearsWhen,
  action,
  surface,
}: {
  title: string;
  appearsWhen: string;
  action: PageEmptyRequestedAction;
  surface: PageEmptySurface;
}): ReactElement {
  const settings = useSettingsModal();
  const plans = useLive<PlanLimitsView>({ read: readPlanLimits, slug: "plans" });
  const drawn = pageEmptyActionOf({ noPlanConnected: noPlanConnectedOf({ plans }), requested: action });
  return (
    <div className={EMPTY} data-page-empty={surface}>
      <p className="m-0 font-medium text-foreground">{title}</p>
      <p className="mt-1 mb-0">{appearsWhen}</p>
      {drawn.kind === "plans" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            onClick={() => {
              settings.open("models");
            }}
          >
            Connect a plan
          </Button>
          <span>Opens Settings on Models. Or look around first: every page works.</span>
        </div>
      )}
      {drawn.kind === "connect" && (
        <ConnectIntegration integration={drawn.integration} subjects={drawn.subjects} block className="mt-3" />
      )}
    </div>
  );
}
