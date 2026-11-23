import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

const LEGS = [
  {
    foot: "Datadog, the repository, a browser, the live API",
    key: "now",
    label: "goes and looks",
    reach: "NOW: go and look",
    title: "Why did the staging pool exhaust?",
    y: 56,
  },
  {
    foot: "bronze + silver, Postgres full text",
    key: "history",
    label: "recalls",
    reach: "HISTORY: read what was said",
    title: "What did we decide about X?",
    y: 160,
  },
  {
    foot: "an atlas, with its claim boundary",
    key: "shape",
    label: "looks up",
    reach: "SHAPE: look it up, never guess",
    title: "What does that platform CONTAIN?",
    y: 264,
  },
] as const;

/**
 * The split the owner has settled, and it is the one an implementation is most likely to lose.
 *
 * The workflow is chosen PER QUESTION, before anything is retrieved. A live question reads live; a
 * historical one reads the corpus; a "what does this platform contain" one reads an atlas. All three are the
 * same bot, and only the middle leg leans on the corpus at all — which is why "the corpus answers the
 * question" is the commonest mis-description of this repository.
 *
 * @returns the figure, captioned
 */
export function QuestionRouting(): ReactElement {
  return (
    <Figure
      arrow="sw-routing-arrow"
      viewBox="0 0 1060 400"
      label="A question is routed before anything is retrieved. A now question (why did the staging pool exhaust) is answered by going and looking at Datadog, the repository, a browser or the live API. A history question (what did we decide about X) is answered from bronze and silver through Postgres full text. A shape question (what does that platform contain) is answered from an atlas, with its claim boundary attached. All three ground one cited answer."
      caption={
        <>
          A live question reads live, never the historical record. That split is why the corpus is{" "}
          <strong>one source the bot reads</strong> rather than the author of the answer.
        </>
      }
    >
      <Kicker x={530} y={34} text="THE WORKFLOW IS CHOSEN PER QUESTION, BEFORE ANYTHING IS RETRIEVED" />

      <Solid
        x={24}
        y={56}
        w={150}
        h={296}
        fill={STAGE.in}
        title="A question"
        detail="tagged in Slack"
        foot="routed before retrieval"
      />

      {LEGS.map((leg) => (
        <g key={leg.key}>
          <Arrow from={174} to={266} y={leg.y + 44} arrow="sw-routing-arrow" label={leg.label} />
          <Panel x={274} y={leg.y} w={352} h={88} title={leg.title} detail={leg.reach} foot={leg.foot} />
          <Arrow from={626} to={698} y={leg.y + 44} arrow="sw-routing-arrow" />
        </g>
      ))}

      <Solid
        x={706}
        y={56}
        w={330}
        h={296}
        fill={STAGE.out}
        title="One answer, cited"
        detail="every claim links to its record"
        foot="similarity nominates; never concludes"
      />

      <text x="24" y="382" fontSize="11.5" fill="var(--sw-figure-muted)">
        Only the middle leg reads the corpus; routing, never deletion, was the fix the owner reached for every time they
        said so.
      </text>
    </Figure>
  );
}
