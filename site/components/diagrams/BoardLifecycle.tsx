import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

const SECTIONS = [
  { x: 24, name: "RUN NOW", detail: "runnable, nothing blocking" },
  { x: 232, name: "IN FLIGHT", detail: "a session holds the lease" },
  { x: 440, name: "WAITING ON THE OWNER", detail: "a recorded question" },
  { x: 648, name: "NOT YET", detail: "blockedBy names live work" },
  { x: 856, name: "DONE · CLOSED", detail: "computed, --all shows it" },
] as const;

/**
 * The one board: what ranks together on it, and where a row's section comes from.
 *
 * The claim it is drawn for is that the SECTION is computed, never authored. A doc's own `status:` is one
 * input; the repository probe and the run journal are the other two, and `boardState.ts` combines them
 * once by an ordered precedence list. Three separate readers is what produced a board saying RUN NOW for
 * work `start` itself refused.
 *
 * @returns the figure, captioned
 */
export function BoardLifecycle(): ReactElement {
  return (
    <Figure
      arrow="sw-board-arrow"
      viewBox="0 0 1060 380"
      label="Three inputs (the doc's authored status, a repository probe, and the run journal) are combined once by boardState.ts into one placement per doc. The board's five sections are computed from that placement, never authored. A planned document, an ask the owner made and an unanswered Slack tag all rank together on the same board."
      caption={
        <>
          One board. A planned doc, an ask the owner made and an unanswered Slack tag <strong>rank together</strong>.
          The section is <em>computed</em>: a probe downgrades confidence and never flips a doc, because proving a
          symptom absent is not the scope having shipped.
        </>
      }
    >
      <Kicker x={176} y={36} text="THREE INPUTS" />
      <Panel x={24} y={56} w={304} h={58} title="The doc's own status:" detail="what a writer authored" />
      <Panel x={24} y={126} w={304} h={58} title="A repository probe" detail="is the symptom still there?" />
      <Panel x={24} y={196} w={304} h={58} title="The run journal" detail="append-only, on disk" />

      <Arrow from={328} to={392} y={85} arrow="sw-board-arrow" />
      <Arrow from={328} to={392} y={155} arrow="sw-board-arrow" />
      <Arrow from={328} to={392} y={225} arrow="sw-board-arrow" />

      <Solid
        x={400}
        y={98}
        w={260}
        h={114}
        fill={STAGE.mid}
        title="boardState.ts"
        detail="ONE composer, not three readers"
        foot="an ordered precedence list, first match wins"
      />

      <Arrow from={660} to={724} y={155} arrow="sw-board-arrow" />
      <Solid
        x={732}
        y={98}
        w={304}
        h={114}
        fill={STAGE.out}
        title="One placement per doc"
        detail="section + the SENTENCE that explains it"
        foot="handover list · handover list --json"
      />

      <Rail d="M884 212 L884 252" arrow="sw-board-arrow" />
      {SECTIONS.map((section) => (
        <Panel key={section.name} x={section.x} y={266} w={180} h={62} title={section.name} detail={section.detail} />
      ))}
      <path
        d="M114 266 L114 252 L946 252 L946 266 M322 266 L322 252 M530 266 L530 252 M738 266 L738 252"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeDasharray="5 4"
      />

      <text x="24" y="360" fontSize="11.5" fill="var(--sw-figure-muted)">
        A recorded question is a legitimate ENDING, not a failure; it is what separates this from a loop that wakes
        forever to report it still cannot proceed.
      </text>
    </Figure>
  );
}
