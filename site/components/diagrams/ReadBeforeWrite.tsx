import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

const CONDITIONS = [
  {
    detail: "a look the session was actually shown, never a navigation",
    title: "1 · The action cites an observation of the page",
    y: 68,
  },
  {
    detail: "a look does not vouch for wherever the page navigated since",
    title: "2 · That look was of the URL the page is still on",
    y: 140,
  },
  {
    detail: "a replaced document can re-issue the same ref to another element",
    title: "3 · The ref it names still names the same element",
    y: 212,
  },
  {
    detail: "checked when the command starts, against INTERACTION_SESSION_TTL_MS",
    title: "4 · The session was not idle when the command began",
    y: 284,
  },
] as const;

/**
 * What a write-capable `slopweaver browser act` has to satisfy on a `read-before-write` page.
 *
 * Four conditions is exactly the shape a prose list turns into a blur, and the claim that matters is that
 * they are conjunctive: the incident this guards against was a read followed by a missed click, so
 * any one of these read as sufficient reproduces it. Drawn as four rungs feeding ONE gate.
 *
 * @returns the figure, captioned
 */
export function ReadBeforeWrite(): ReactElement {
  return (
    <Figure
      arrow="sw-rbw-arrow"
      viewBox="0 0 1060 440"
      label="A write-capable browser action on a read-before-write page dispatches only when all four conditions hold at once: it cites an observation of the page, that observation was of the URL the page is still on, the element reference it names still names the same element, and the session was not idle when the command began. If any one is missing the action is refused."
      caption={
        <>
          Four conditions, and they are <strong>conjunctive</strong>. Reading was never the risk: the inseparability of
          reading and writing at the tool boundary was, which is why no write-capable action runs blind.
        </>
      }
    >
      <Kicker x={304} y={44} text="FOUR CONDITIONS, ALL OF THEM AT ONCE" />
      <Kicker x={858} y={44} text="AND ONLY THEN" />

      {CONDITIONS.map((condition) => (
        <Panel
          key={condition.title}
          x={24}
          y={condition.y}
          w={560}
          h={64}
          title={condition.title}
          detail={condition.detail}
        />
      ))}

      <Arrow from={584} to={672} y={174} arrow="sw-rbw-arrow" label="all four" />
      <Solid
        x={680}
        y={124}
        w={356}
        h={100}
        fill={STAGE.out}
        title="the write dispatches"
        detail="click · type · upload"
        foot="and photographs its own result"
      />

      <Rail d="M584 300 L672 300" arrow="sw-rbw-arrow" />
      <Panel
        x={680}
        y={250}
        w={356}
        h={100}
        title="Any one of them missing"
        detail={["refused, and the refusal", "names which one failed"]}
        foot="a navigation alone lifts none of them"
      />

      <text x={24} y={380} fontSize={11.5} fill="var(--sw-figure-muted)">
        Every host the register does not name refuses every write, while reads still pass, which is the owner's own
        default
      </text>
      <text x={24} y={398} fontSize={11.5} fill="var(--sw-figure-muted)">
        for a new integration. The one break-glass names a single page, expires after thirty minutes and leaves a row.
      </text>
    </Figure>
  );
}
