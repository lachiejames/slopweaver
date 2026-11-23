"use client";

/**
 * The slide-over's two "who and what else" sections: the stakeholders as identity chips, for every kind but a page-only
 * entry, and the related workstreams each opening its own slide-over, for every kind. A closing entry carries both too
 *: a completion keeps its evidence, never tucked away. This file only draws.
 */
import type { ReactElement, ReactNode } from "react";

import type { CardPerson } from "../../lib/personMentions";
import type { SlackPeople } from "../../lib/slackPeople";
import type { InvolvedView, RelatedView, WorkstreamsView } from "../../lib/workstreamTiles";
import { PersonChip } from "../console/PersonChip";
import { SLIDE_EMPTY, SLIDE_SECTION } from "./SlideOver";

/**
 * A section a completion keeps even when it holds nothing, saying so, so an older entry reads as unrecorded and
 * never as a section that is missing.
 *
 * @returns the section with its one empty line
 */
function Unrecorded({ heading }: { heading: string }): ReactElement {
  return (
    <section className={SLIDE_SECTION}>
      <h4>{heading}</h4>
      <p className={SLIDE_EMPTY}>none recorded yet</p>
    </section>
  );
}

/**
 * The people involved, each as the console's identity chip with its hover card, and the part they play. A
 * Stakeholders category sits beside Priority, Initiative and Links, the people involved as identity
 * chips the owner can hover over. A member the roster does not hold is said as such, never as their id.
 *
 * @param sayEmpty a completion says it named nobody rather than dropping the section, since what it kept is the point
 * @returns the section, or nothing when the register names nobody and the card need not say so
 */
export function Stakeholders({
  people,
  roster,
  sayEmpty,
}: {
  people: readonly InvolvedView[];
  roster: SlackPeople;
  sayEmpty: boolean;
}): ReactElement | null {
  if (people.length === 0) {
    return sayEmpty ? <Unrecorded heading="Stakeholders" /> : null;
  }
  return (
    <section className={SLIDE_SECTION}>
      <h4>Stakeholders</h4>
      <ul className="m-0 grid list-none gap-[0.45rem] p-0">
        {people.map((involved) => {
          const known = roster.get(involved.slack);
          const name = known?.name?.trim();
          let chip: ReactNode = <span className="text-muted-foreground">someone the member roster does not hold</span>;
          if (known !== undefined && name !== undefined && name !== "") {
            // The slide-over does not know who the owner is, so no stakeholder is read as the owner.
            const person: CardPerson = { ...known, id: involved.slack, self: false, workstreams: [] };
            chip = <PersonChip person={person} label={name} />;
          }
          return (
            <li key={involved.slack} data-stakeholder={involved.slack} className="grid gap-[0.1rem]">
              <span>{chip}</span>
              <span className="text-[0.8rem] text-muted-foreground">{involved.part}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The workstreams this one bears on, the way Linear lists related issues, each opening
 * its own slide-over, with why it relates when the link says.
 *
 * @param sayEmpty a completion says it names none rather than dropping the section
 * @returns the section, or nothing when none is named and the card need not say so
 */
export function Related({
  related,
  view,
  open,
  sayEmpty,
}: {
  related: readonly RelatedView[];
  view: WorkstreamsView;
  open: (id: string | null) => void;
  sayEmpty: boolean;
}): ReactElement | null {
  if (related.length === 0) {
    return sayEmpty ? <Unrecorded heading="Related" /> : null;
  }
  return (
    <section className={SLIDE_SECTION}>
      <h4>Related</h4>
      <ul className="m-0 grid list-none gap-[0.45rem] p-0">
        {related.map((each) => {
          const other = view.workstreams.find((one) => one.id === each.id);
          return (
            <li key={each.id} className="grid gap-[0.1rem]">
              <button
                type="button"
                data-related={each.id}
                className="cursor-pointer justify-self-start border-0 bg-transparent p-0 text-left font-medium text-primary underline"
                onClick={() => {
                  open(each.id);
                }}
              >
                {other === undefined ? "a workstream no longer on the register" : other.name}
              </button>
              {each.why === null ? null : <span className="text-[0.8rem] text-muted-foreground">{each.why}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
