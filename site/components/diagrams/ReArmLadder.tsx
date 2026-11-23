import type { ReactElement } from "react";
import { Arrowhead } from "./Arrowhead";

/**
 * The death-watch ladder: where a re-arm happens, and the exact point at which it stops happening.
 *
 * @returns the figure, captioned
 */
export function ReArmLadder(): ReactElement {
  return (
    <figure className="sw-figure">
      <svg
        viewBox="0 0 1060 310"
        role="img"
        aria-label="The loop session ticks listen supervise every fifteen seconds. A socket that has been disconnected for under ninety seconds is merely reconnecting and the tick does nothing. Past that it journals a death, then counts: fewer than three deaths in fifteen minutes hands back an arm command carrying the dead arm's own scope, and three or more escalates, leaves the listener down, and records a question for the owner."
      >
        <Arrowhead id="sw-rearm-arrow" />

        <rect
          x="24"
          y="56"
          width="200"
          height="84"
          rx="10"
          fill="var(--sw-figure-panel)"
          stroke="var(--sw-figure-line)"
        />
        <text x="124" y="90" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--sw-figure-ink)">
          One tick, every 15s
        </text>
        <text x="124" y="110" textAnchor="middle" fontSize="10.5" fill="var(--sw-figure-muted)">
          slopweaver listen
        </text>
        <text x="124" y="126" textAnchor="middle" fontSize="10.5" fill="var(--sw-figure-muted)">
          supervise
        </text>

        <rect
          x="280"
          y="56"
          width="216"
          height="84"
          rx="10"
          fill="var(--sw-figure-panel)"
          stroke="var(--sw-figure-ink)"
          strokeWidth="2"
        />
        <text x="388" y="94" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--sw-figure-ink)">
          Not connected for 90s?
        </text>
        <text x="388" y="115" textAnchor="middle" fontSize="10.5" fill="var(--sw-figure-muted)">
          since the socket ENTERED that state
        </text>

        <rect x="552" y="56" width="186" height="84" rx="10" fill="var(--sw-stage-mid)" />
        <text x="645" y="94" textAnchor="middle" fontSize="13" fontWeight="600" fill="#ffffff">
          Journal a death
        </text>
        <text x="645" y="114" textAnchor="middle" fontSize="10.5" fill="#ffffff" opacity="0.85">
          arms.jsonl
        </text>

        <rect
          x="794"
          y="56"
          width="236"
          height="84"
          rx="10"
          fill="var(--sw-figure-panel)"
          stroke="var(--sw-figure-ink)"
          strokeWidth="2"
        />
        <text x="912" y="94" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--sw-figure-ink)">
          3 deaths in 15 minutes?
        </text>
        <text x="912" y="115" textAnchor="middle" fontSize="10.5" fill="var(--sw-figure-muted)">
          the count and the window both matter
        </text>

        <g stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd="url(#sw-rearm-arrow)">
          <line x1="224" y1="98" x2="272" y2="98" />
          <line x1="496" y1="98" x2="544" y2="98" />
          <line x1="738" y1="98" x2="786" y2="98" />
          <path d="M388 140 L388 176 L124 176 L124 148" />
          <path d="M912 140 L912 168 L675 168 L675 198" />
          <path d="M912 168 L915 168 L915 198" />
        </g>

        <text x="248" y="88" textAnchor="middle" fontSize="11" fill="var(--sw-figure-muted)">
          reads
        </text>
        <text x="520" y="88" textAnchor="middle" fontSize="11" fill="var(--sw-figure-muted)">
          yes
        </text>
        <text x="762" y="88" textAnchor="middle" fontSize="11" fill="var(--sw-figure-muted)">
          then
        </text>
        <text x="400" y="164" fontSize="11" fontWeight="600" fill="var(--sw-figure-muted)">
          no: reconnecting is normal, so nothing happens
        </text>
        <text x="668" y="190" textAnchor="end" fontSize="11" fontWeight="600" fill="var(--sw-figure-muted)">
          fewer than 3
        </text>
        <text x="924" y="190" fontSize="11" fontWeight="600" fill="var(--sw-figure-muted)">
          3 or more
        </text>

        <rect x="560" y="206" width="230" height="80" rx="10" fill="var(--sw-stage-out)" />
        <text x="675" y="234" textAnchor="middle" fontSize="13" fontWeight="600" fill="#ffffff">
          Hand back an arm command
        </text>
        <text x="675" y="254" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.88">
          composed from the DEAD arm, so
        </text>
        <text x="675" y="270" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.88">
          its scope is neither widened nor lost
        </text>

        <rect x="800" y="206" width="230" height="80" rx="10" fill="#9f1239" />
        <text x="915" y="234" textAnchor="middle" fontSize="13" fontWeight="600" fill="#ffffff">
          Escalate, and STOP
        </text>
        <text x="915" y="254" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.88">
          the listener is left DOWN and a
        </text>
        <text x="915" y="270" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.88">
          question is recorded for the owner
        </text>
      </svg>
      <figcaption>
        Where the re-arming stops. A fourth silent re-arm would be the blind retry loop the doctrine forbids, so the
        third death buys a durable question instead, and that escalation stands until a person arms or disarms, because
        a later tick can never lift its own hold.
      </figcaption>
    </figure>
  );
}
