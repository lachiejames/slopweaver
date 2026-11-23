/**
 * One workstream's slide-over: the body beside the side column of priority, initiative, people, relations and links.
 */
import { type ReactElement, type ReactNode } from "react";

import type { SlackPeople } from "../../lib/slackPeople";
import { cn } from "../../lib/utils";
import {
  type LinkView,
  linkChipText,
  linkChipTitle,
  type MilestoneNodeView,
  type WorkstreamsView,
  type WorkstreamView,
} from "../../lib/workstreamTiles";
import { CHIP } from "../console/controls";
import { SLIDE_BODY, SLIDE_EMPTY, SLIDE_SECTION, SlideOver } from "./SlideOver";
import { Related, Stakeholders } from "./WorkstreamPeople";
import { Body } from "./WorkstreamTilesBody";
import { LaneChip, Stats } from "./WorkstreamTilesCard";

/**
 * What else a workstream links — queue cards, alignment cards, automations, pull requests, Linear projects — one chip
 * each, naming the kind and its canonical target, with why it is linked and the milestone it serves on hover.
 *
 * @returns the section, or nothing when it links none
 */
function LinkChips({
  links,
  milestones,
}: {
  links: readonly LinkView[];
  milestones: readonly MilestoneNodeView[];
}): ReactElement | null {
  if (links.length === 0) {
    return null;
  }
  return (
    <section className={SLIDE_SECTION}>
      <h4>Links</h4>
      <p className="my-[0.4rem] flex flex-wrap gap-[0.4rem]">
        {links.map((link) => (
          <span key={link.id} className={CHIP} data-link-kind={link.kind} title={linkChipTitle({ link, milestones })}>
            {linkChipText({ link })}
          </span>
        ))}
      </p>
    </section>
  );
}

/**
 * The slide-over's side column: the owner's priority and the steer behind it, the initiative, who is involved, what it
 * relates to, and what else it links.
 *
 * @returns the column
 */
function Side({
  one,
  view,
  roster,
  open,
}: {
  one: WorkstreamView;
  view: WorkstreamsView;
  roster: SlackPeople;
  open: (id: string | null) => void;
}): ReactElement {
  let priority: ReactNode = null;
  if (one.kind === "outcome" || one.kind === "standing" || one.kind === "linked") {
    priority = <p className={SLIDE_EMPTY}>not stated; no steer of yours on record yet</p>;
    if (one.priority !== null) {
      priority = (
        <p className="m-0">
          <b>{one.priority.level}</b>, {one.priority.because}
        </p>
      );
    }
  }
  const initiative =
    one.kind === "local" || one.kind === "closing"
      ? undefined
      : view.initiatives.find((each) => each.id === one.initiative);
  return (
    <aside className="min-w-0">
      {priority === null ? null : (
        <section className={cn(SLIDE_SECTION, "mt-0 border-t-0 pt-0")}>
          <h4>Priority</h4>
          {priority}
        </section>
      )}
      {initiative === undefined ? null : (
        <section className={SLIDE_SECTION}>
          <h4>Initiative</h4>
          <p className="m-0">{initiative.name}</p>
        </section>
      )}
      {one.kind === "local" ? null : (
        <Stakeholders people={one.people} roster={roster} sayEmpty={one.kind === "closing"} />
      )}
      <Related related={one.related} view={view} open={open} sayEmpty={one.kind === "closing"} />
      <LinkChips links={one.links} milestones={"milestoneGraph" in one ? one.milestoneGraph.milestones : []} />
    </aside>
  );
}

/**
 * One workstream's slide-over, the shell every Queue card opens into: the lane chip and title in the header, the
 * outcome, progress and hold above the fold, the dated entries, feedback and skeptic below, and the side column beside.
 *
 * @returns the panel
 */
export function Panel({
  one,
  view,
  roster,
  open,
  onClose,
}: {
  one: WorkstreamView;
  view: WorkstreamsView;
  roster: SlackPeople;
  open: (id: string | null) => void;
  onClose: () => void;
}): ReactElement {
  return (
    <SlideOver
      label={one.name}
      tag={<LaneChip one={one} view={view} />}
      title={one.name}
      meta={<Stats one={one} view={view} />}
      onClose={onClose}
    >
      <div className={SLIDE_BODY}>
        <div className="min-w-0 text-[0.9rem]">
          <Body one={one} />
        </div>
        <Side one={one} view={view} roster={roster} open={open} />
      </div>
    </SlideOver>
  );
}
