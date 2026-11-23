import type { ReactElement } from "react";

import { Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

const BANNED = [
  { x: 552, y: 96, title: "A daemon", detail: "resident, invisible" },
  { x: 800, y: 96, title: "A queue consumer", detail: "catching up later" },
  { x: 552, y: 186, title: "An automatic retry", detail: "on a tag nobody saw" },
  { x: 800, y: 186, title: "A card asking the owner", detail: "to tag again" },
] as const;

/**
 * Rule 2 drawn as the property it actually is: VISIBILITY, not process count.
 *
 * The reason this needs a figure is that every reader's first instinct — "so only one process, then" — is
 * wrong. `cmux spawn` IS the intended shape of tier-3 execution, and many sessions is fine. What is
 * banned is a model the owner cannot see and interrupt as it runs.
 *
 * @returns the figure, captioned
 */
export function SessionVisibility(): ReactElement {
  return (
    <Figure
      arrow="sw-visible-arrow"
      viewBox="0 0 1060 340"
      label="The property rule 2 protects is visibility, not process count. Many spawned sessions are allowed, because the owner can see and interrupt each one as it runs. Four shapes are banned: a resident daemon, a queue consumer that catches up later, an automatic retry on an address nobody saw, and a card asking the owner to tag again. A Slack tag arriving when no session is running is a no-op by design."
      caption={
        <>
          The property is <strong>visibility</strong>, not process count. A Slack tag arriving when nothing is running
          is a <strong>no-op by design</strong>, and a running, visible session picking a stranded ask up <em>once</em>{" "}
          and saying so in-thread is none of the banned shapes.
        </>
      }
    >
      <Kicker x={264} y={36} text="ALLOWED" />
      <Kicker x={792} y={36} text="BANNED, ALL FOUR" />

      <Solid
        x={24}
        y={64}
        w={480}
        h={92}
        fill={STAGE.mid}
        title="Any number of VISIBLE sessions"
        detail="cmux spawn is tier-3 execution's intended shape"
        foot="the owner can see it, and interrupt it, as it runs"
      />
      <Panel
        x={24}
        y={172}
        w={232}
        h={76}
        title="listen --follow --queue"
        detail="records, and never answers"
        foot="explicitly allowed"
      />
      <Panel
        x={272}
        y={172}
        w={232}
        h={76}
        title="A stranded ask, picked up"
        detail="ONCE, by a running session"
        foot="and said so in-thread"
      />

      {BANNED.map((box) => (
        <g key={box.title}>
          <rect
            x={box.x}
            y={box.y}
            width="228"
            height="72"
            rx="9"
            fill="var(--sw-figure-panel)"
            stroke="var(--sw-stage-in)"
            strokeWidth="1.6"
            strokeDasharray="5 4"
          />
          <text x={box.x + 14} y={box.y + 28} fontSize="13" fontWeight="600" fill="var(--sw-stage-in)">
            {box.title}
          </text>
          <text x={box.x + 14} y={box.y + 48} fontSize="11.5" fill="var(--sw-figure-muted)">
            {box.detail}
          </text>
        </g>
      ))}

      <Rail d="M504 130 L544 130" />
      <text x="24" y="292" fontSize="11.5" fill="var(--sw-figure-muted)">
        Gated by `no-headless`: no allowlist, no marker. All reasoning happens in a session that already exists and is
        already on screen.
      </text>
    </Figure>
  );
}
