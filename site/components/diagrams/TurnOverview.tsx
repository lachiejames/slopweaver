import type { ReactElement } from "react";
import { Arrowhead } from "./Arrowhead";

const STEPS = [
  { y: 80, text: "brief: pin the question and its reach", source: "turn/brief.ts" },
  { y: 118, text: "investigate: with every tool it has", source: "turn/tier.ts" },
  { y: 156, text: "answer: ground, review, then post", source: "turn/poster.ts" },
] as const;

const FOUNDATIONS = [
  {
    x: 24,
    title: "The corpus, on this machine",
    detail: ["Slack · GitHub · Linear · Notion", "opt-in: Gmail · Calendar · Fathom"],
    source: "src/corpus",
  },
  { x: 281, title: "An atlas per platform", detail: ["look it up, never guess"], source: "src/atlas" },
  { x: 538, title: "One door, every write", detail: ["a verb, never a curl"], source: "src/admit" },
  { x: 795, title: "Review, shape and voice", detail: ["a second session signs it"], source: "src/outbound" },
] as const;

/**
 * The whole bot in one picture: a Slack tag in, one visible session, a sourced answer out.
 *
 * This is the top of the disclosure ladder — every box on it has a page of its own underneath, so it
 * carries stages and the four things a turn stands on, and nothing else.
 *
 * @returns the figure, captioned
 */
export function TurnOverview(): ReactElement {
  return (
    <figure className="sw-figure">
      <svg
        viewBox="0 0 1060 406"
        role="img"
        aria-label="A Slack app_mention enters one visible session, which briefs, investigates and answers, and posts one cited card back to the thread. The session stands on the local corpus of Slack, GitHub, Linear and Notion history, plus opt-in Gmail, Calendar and Fathom; a platform atlas; the one write door; and the review, shape and voice checks."
      >
        <Arrowhead id="sw-overview-arrow" />

        <text x="140" y="26" textAnchor="middle" fontSize="11" letterSpacing="1.6" fill="var(--sw-figure-muted)">
          1 · IN
        </text>
        <text x="550" y="26" textAnchor="middle" fontSize="11" letterSpacing="1.6" fill="var(--sw-figure-muted)">
          2 · PROCESSING
        </text>
        <text x="940" y="26" textAnchor="middle" fontSize="11" letterSpacing="1.6" fill="var(--sw-figure-muted)">
          3 · OUT
        </text>

        <rect x="24" y="75" width="232" height="96" rx="10" fill="var(--sw-stage-in)" />
        <text x="140" y="112" textAnchor="middle" fontSize="14" fontWeight="600" fill="#ffffff">
          A colleague tags
        </text>
        <text x="140" y="132" textAnchor="middle" fontSize="14" fontWeight="600" fill="#ffffff">
          @acme-bot
        </text>
        <text x="140" y="152" textAnchor="middle" fontSize="12" fill="#ffffff" opacity="0.85">
          in a Slack thread
        </text>

        <rect x="332" y="40" width="436" height="166" rx="10" fill="var(--sw-stage-mid)" />
        <text x="550" y="66" textAnchor="middle" fontSize="11" letterSpacing="1.4" fill="#ffffff" opacity="0.9">
          ONE VISIBLE SESSION PER TURN
        </text>
        {STEPS.map((step) => (
          <g key={step.source}>
            <rect x="348" y={step.y} width="404" height="34" rx="7" fill="#ffffff" opacity="0.14" />
            <text x="362" y={step.y + 22} fontSize="13" fill="#ffffff">
              {step.text}
            </text>
            <text x="738" y={step.y + 22} textAnchor="end" fontSize="10" fill="#ffffff" opacity="0.75">
              {step.source}
            </text>
          </g>
        ))}

        <rect x="844" y="75" width="192" height="96" rx="10" fill="var(--sw-stage-out)" />
        <text x="940" y="108" textAnchor="middle" fontSize="14" fontWeight="600" fill="#ffffff">
          One reply,
        </text>
        <text x="940" y="128" textAnchor="middle" fontSize="14" fontWeight="600" fill="#ffffff">
          in that thread
        </text>
        <text x="940" y="150" textAnchor="middle" fontSize="12" fill="#ffffff" opacity="0.85">
          every claim cited
        </text>

        <g stroke="currentColor" strokeWidth="1.6" markerEnd="url(#sw-overview-arrow)">
          <line x1="256" y1="123" x2="324" y2="123" />
          <line x1="768" y1="123" x2="836" y2="123" />
        </g>
        <text x="294" y="112" textAnchor="middle" fontSize="11" fill="var(--sw-figure-muted)">
          app_mention
        </text>
        <text x="806" y="112" textAnchor="middle" fontSize="11" fill="var(--sw-figure-muted)">
          cited card
        </text>

        <g stroke="currentColor" strokeWidth="1.4" strokeDasharray="5 4" fill="none">
          <path d="M550 206 L550 262 M144 262 L915 262 M144 262 L144 286 M401 262 L401 286 M658 262 L658 286 M915 262 L915 286" />
        </g>
        <text x="562" y="236" fontSize="11" fill="var(--sw-figure-muted)">
          stands on
        </text>

        {FOUNDATIONS.map((box) => (
          <g key={box.source}>
            <rect
              x={box.x}
              y="286"
              width="241"
              height="92"
              rx="9"
              fill="var(--sw-figure-panel)"
              stroke="var(--sw-figure-line)"
            />
            <text x={box.x + 16} y="311" fontSize="13" fontWeight="600" fill="var(--sw-figure-ink)">
              {box.title}
            </text>
            {box.detail.map((line, index) => (
              <text key={line} x={box.x + 16} y={330 + index * 16} fontSize="11.5" fill="var(--sw-figure-muted)">
                {line}
              </text>
            ))}
            <text x={box.x + 16} y="365" fontSize="11" fill="var(--sw-figure-muted)" opacity="0.85">
              {box.source}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>
        One turn, end to end. The three stages are what a reader sees; the four boxes underneath are what makes the
        answer citable rather than plausible. Each stage has its own page.
      </figcaption>
    </figure>
  );
}
