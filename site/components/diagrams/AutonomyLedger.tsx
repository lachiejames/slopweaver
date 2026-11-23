import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

const ACTORS = [
  { y: 64, verb: "appends", title: "A landing seat", detail: "pressed Merge when ready" },
  { y: 140, verb: "appends", title: "A bot turn", detail: "cleared a review thread" },
  { y: 216, verb: "appends", title: "The chair itself", detail: "rebased one of the owner's pull requests" },
] as const;

/**
 * Where the briefing's autonomy section comes from, and why nobody composes it.
 *
 * The claim is the arrow direction: the register is written by whichever session ACTED, and the section
 * is a projection of that file. A supervisor free to retype a row could disagree with what the acting
 * session recorded, which would leave the owner steering an account of an act rather than the act — so the
 * renderer refuses a form that writes the section itself, and refuses a malformed line rather than
 * skipping it, because a page reporting "nothing was done" off a failed read is the confident wrong
 * answer this whole section exists to prevent.
 *
 * @returns the figure, captioned
 */
export function AutonomyLedger(): ReactElement {
  return (
    <Figure
      arrow="sw-ledger-arrow"
      viewBox="0 0 1060 420"
      label="Every session acting under graduated autonomy appends one line to the state home's append-only autonomy register. The Fleet Briefing's fourth section is a projection of that file, newest first and never folded away, with the reasoning, the witness and the act id behind a fold. The renderer refuses a form that composes the section itself, and refuses a malformed line rather than skipping it."
      caption={
        <>
          The section is a <strong>projection</strong>, not a composition. Whoever acted wrote the row; the briefing
          only renders it. That is what makes it a surface the owner can <em>steer</em> rather than an account of an act
          they have to take somebody&rsquo;s word for.
        </>
      }
    >
      <Kicker x={144} y={44} text="EVERY ACTING SESSION" />
      <Kicker x={488} y={44} text="ONE REGISTER" />
      <Kicker x={874} y={44} text="WHERE THE OWNER READS IT" />

      {ACTORS.map((actor) => (
        <g key={actor.title}>
          <Panel x={24} y={actor.y} w={240} h={64} title={actor.title} detail={actor.detail} />
          <Arrow from={264} to={340} y={actor.y + 32} arrow="sw-ledger-arrow" label={actor.verb} />
        </g>
      ))}

      <Solid
        x={348}
        y={64}
        w={280}
        h={216}
        fill={STAGE.in}
        title="The autonomy register"
        detail="append-only, one line per act"
        foot="recorded by a verb, never a redirect"
      />

      <Arrow from={628} to={704} y={172} arrow="sw-ledger-arrow" label="projects" />

      <Solid
        x={712}
        y={64}
        w={324}
        h={216}
        fill={STAGE.out}
        title="Done for you, without asking"
        detail="the briefing's fourth section"
        foot="why · witness · act id sit behind the fold"
      />

      <Rail d="M488 280 L488 298" arrow="sw-ledger-arrow" />
      <Rail d="M874 280 L874 298" arrow="sw-ledger-arrow" />

      <rect x="348" y="304" width="688" height="72" rx="10" fill="#9f1239" />
      <text x="692" y="330" textAnchor="middle" fontSize="13" fontWeight="600" fill="#ffffff">
        You cannot compose this section
      </text>
      <text x="692" y="352" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.9">
        the render refuses a form that writes it, because a retyped row could disagree with the act
      </text>
      <text x="692" y="370" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.9">
        and one malformed line takes the whole section off the page rather than being skipped
      </text>

      <text x="24" y="404" fontSize="11.5" fill="var(--sw-figure-muted)">
        A REFUSED act is a real row and renders as one: an act the fleet tried and could not complete is one of the
        things the owner asked to be able to steer.
      </text>
    </Figure>
  );
}
