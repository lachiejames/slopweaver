import type { ReactElement } from "react";
import { Arrowhead } from "./Arrowhead";

const ADDRESS_SHAPES = [
  { y: 44, title: "In a channel: an explicit tag", detail: "app_mention, and nothing else" },
  { y: 120, title: "In a DM: a message that tags it", detail: "message.im (the tag is found in the text)" },
  { y: 196, title: "A reply under one of its own posts", detail: "opted-in channels only" },
] as const;

const CAPTURE_STEPS = [
  { y: 84, text: "the :eyes: reaction goes on the message", source: "listen/capture.ts" },
  { y: 122, text: "a durable captured event is appended", source: "ask/store.ts" },
  { y: 160, text: "a checklist is posted in the thread", source: "turn/answer.ts" },
  { y: 198, text: "this asker's other live asks are gathered", source: "ask/burst.ts" },
] as const;

/**
 * What counts as being addressed, who is allowed to address it, and what happens before any model runs.
 *
 * @returns the figure, captioned
 */
export function ListenerAddress(): ReactElement {
  return (
    <figure className="sw-figure">
      <svg
        viewBox="0 0 1060 390"
        role="img"
        aria-label="Three shapes count as addressing the bot: an app_mention in a channel, a tagged message in a DM, and a reply under one of its own posts. Anything else is not captured at all. An address is then checked against responders.json: a refusal reply if the asker is not on it, and otherwise capture, which reacts, appends a durable event, posts a checklist and gathers the asker's other live asks before the turn brief is built."
      >
        <Arrowhead id="sw-address-arrow" />

        {ADDRESS_SHAPES.map((shape) => (
          <g key={shape.title}>
            <rect x="24" y={shape.y} width="272" height="64" rx="10" fill="var(--sw-stage-in)" />
            <text x="40" y={shape.y + 27} fontSize="13" fontWeight="600" fill="#ffffff">
              {shape.title}
            </text>
            <text x="40" y={shape.y + 47} fontSize="11" fill="#ffffff" opacity="0.85">
              {shape.detail}
            </text>
          </g>
        ))}

        <rect
          x="24"
          y="276"
          width="272"
          height="60"
          rx="10"
          fill="var(--sw-figure-panel)"
          stroke="var(--sw-figure-line)"
          strokeDasharray="5 4"
        />
        <text x="40" y="300" fontSize="12" fontWeight="600" fill="var(--sw-figure-ink)">
          Anything else is not an address.
        </text>
        <text x="40" y="320" fontSize="11" fill="var(--sw-figure-muted)">
          No react, no card, nothing captured.
        </text>

        <g stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd="url(#sw-address-arrow)">
          <line x1="296" y1="76" x2="344" y2="132" />
          <line x1="296" y1="152" x2="344" y2="152" />
          <line x1="296" y1="228" x2="344" y2="172" />
        </g>

        <rect
          x="352"
          y="110"
          width="216"
          height="84"
          rx="10"
          fill="var(--sw-figure-panel)"
          stroke="var(--sw-figure-ink)"
          strokeWidth="2"
        />
        <text x="460" y="134" textAnchor="middle" fontSize="10" letterSpacing="1.2" fill="var(--sw-figure-muted)">
          WHO MAY COMMAND IT
        </text>
        <text x="460" y="156" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--sw-figure-ink)">
          On responders.json?
        </text>
        <text x="460" y="177" textAnchor="middle" fontSize="10.5" fill="var(--sw-figure-muted)">
          listen/whitelist.ts: an exact id list
        </text>

        <g stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd="url(#sw-address-arrow)">
          <line x1="460" y1="194" x2="460" y2="268" />
          <line x1="568" y1="152" x2="612" y2="152" />
        </g>
        <text x="472" y="222" fontSize="11" fontWeight="600" fill="var(--sw-figure-muted)">
          no
        </text>
        <text x="590" y="143" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--sw-figure-muted)">
          yes
        </text>

        <rect x="352" y="276" width="216" height="60" rx="10" fill="#9f1239" />
        <text x="460" y="301" textAnchor="middle" fontSize="13" fontWeight="600" fill="#ffffff">
          A fixed refusal reply
        </text>
        <text x="460" y="320" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.85">
          never silence
        </text>

        <rect x="620" y="44" width="416" height="216" rx="10" fill="var(--sw-stage-mid)" />
        <text x="828" y="70" textAnchor="middle" fontSize="11" letterSpacing="1.4" fill="#ffffff" opacity="0.9">
          CAPTURE: NO MODEL HAS RUN YET
        </text>
        {CAPTURE_STEPS.map((step) => (
          <g key={step.source}>
            <rect x="636" y={step.y} width="384" height="32" rx="7" fill="#ffffff" opacity="0.14" />
            <text x="650" y={step.y + 21} fontSize="12.5" fill="#ffffff">
              {step.text}
            </text>
            <text x="1006" y={step.y + 21} textAnchor="end" fontSize="9.5" fill="#ffffff" opacity="0.75">
              {step.source}
            </text>
          </g>
        ))}

        <line
          x1="828"
          y1="260"
          x2="828"
          y2="292"
          stroke="currentColor"
          strokeWidth="1.5"
          markerEnd="url(#sw-address-arrow)"
        />

        <rect x="620" y="300" width="416" height="60" rx="10" fill="var(--sw-stage-out)" />
        <text x="828" y="325" textAnchor="middle" fontSize="13" fontWeight="600" fill="#ffffff">
          turn brief: what the judging session reads
        </text>
        <text x="828" y="344" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.85">
          src/live/turn/brief.ts
        </text>
      </svg>
      <figcaption>
        An address, a gate, then capture. Rose is a refusal throughout this site. Note what capture is not: it runs
        before any model does, so a tag that is never judged still leaves a reaction, a durable event and a checklist
        behind it.
      </figcaption>
    </figure>
  );
}
