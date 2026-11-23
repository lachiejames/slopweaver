import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

const INBOUND = [
  {
    y: 86,
    verb: "types",
    title: "slopweaver cmux send",
    detail: "types into the seat's own surface",
    foot: "lands QUEUED behind a running turn",
  },
  {
    y: 178,
    verb: "interrupts",
    title: "slopweaver cmux send --interrupt",
    detail: "opt-in, and never the default",
    foot: "a WEDGED seat ignores it, so respawn it",
  },
  {
    y: 270,
    verb: "messages",
    title: "SendMessage · ListAgents",
    detail: "Claude Code's own channel",
    foot: "a from name, no session id, no host",
  },
] as const;

const OUTBOUND = [
  {
    y: 86,
    verb: "emits",
    title: "slopweaver cmux events",
    detail: "one line per hook, per session",
    foot: "Stop · Notification · AskUserQuestion",
  },
  {
    y: 178,
    verb: "records",
    title: "slopweaver cmux list",
    detail: "the exact text last submitted",
    foot: "with the instant it was submitted",
  },
  {
    y: 270,
    verb: "reports",
    title: "slopweaver cmux processes",
    detail: "the real OS pid tree",
    foot: "cross-checked live against ps, exact",
  },
] as const;

/**
 * What reaches a seat, what a seat reports, and the property both directions share.
 *
 * Drawn for the fact neither column states on its own: these are two one-way channels, and NEITHER of
 * them interrupts. Telemetry says a seat ran a tool or ended a turn and never says what it decided;
 * anything typed at a seat mid-turn is absorbed when that turn ends rather than when it is sent. A
 * supervisor that reads either direction as a conversation gets a false negative on both.
 *
 * @returns the figure, captioned
 */
export function SeatReach(): ReactElement {
  return (
    <Figure
      arrow="sw-seat-arrow"
      viewBox="0 0 1060 452"
      label="Two one-way channels around one visible cmux seat. Reaching in: typing into the seat's surface, an opt-in interrupt, and Claude Code's own cross-session message channel. Coming out: hook events, the exact text a seat last submitted with its instant, and the real operating-system process tree. Neither direction interrupts: what is typed arrives only when the running turn ends, and an event reports that something happened, never what was decided."
      caption={
        <>
          Two one-way channels, not a conversation. What you type is absorbed when the running turn{" "}
          <strong>ends</strong>; what comes back says a seat acted, never <em>what it decided</em>: that is still only
          in the transcript or on the screen.
        </>
      }
    >
      <Kicker x={174} y={62} text="REACHING IN" />
      <Kicker x={558} y={62} text="THE SEAT" />
      <Kicker x={894} y={62} text="TELEMETRY OUT" />

      {INBOUND.map((row) => (
        <g key={row.title}>
          <Panel x={24} y={row.y} w={300} h={72} title={row.title} detail={row.detail} foot={row.foot} />
          <Arrow from={324} to={396} y={row.y + 36} arrow="sw-seat-arrow" label={row.verb} />
        </g>
      ))}

      <Solid
        x={404}
        y={86}
        w={280}
        h={256}
        fill={STAGE.mid}
        title="A visible cmux seat"
        detail="one workspace, one named model"
        foot="the owner can see it and stop it AS IT RUNS"
      />

      {OUTBOUND.map((row) => (
        <g key={row.title}>
          <Arrow from={684} to={744} y={row.y + 36} arrow="sw-seat-arrow" label={row.verb} />
          <Panel x={752} y={row.y} w={284} h={72} title={row.title} detail={row.detail} foot={row.foot} />
        </g>
      ))}

      <rect x="274" y="360" width="512" height="64" rx="10" fill="#9f1239" />
      <text x="530" y="386" textAnchor="middle" fontSize="13" fontWeight="600" fill="#ffffff">
        NEITHER DIRECTION INTERRUPTS
      </text>
      <text x="530" y="408" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.9">
        a send waits for the turn to end; an event says something happened, never what
      </text>

      <text x="24" y="444" fontSize="11.5" fill="var(--sw-figure-muted)">
        No diff method exists on this socket at all, so the text of a change still comes from git against the
        seat&rsquo;s own working directory.
      </text>
    </Figure>
  );
}
