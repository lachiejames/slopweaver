import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/** What the chair does on each of its two passes through one lap, drawn as rows inside the hub. */
const CHAIR_ROWS = [
  { y: 226, text: "delegates a seat per board row" },
  { y: 252, text: "reads the artifacts and asks back" },
  { y: 278, text: "puts what needs the owner on the Queue" },
] as const;

/**
 * The two arrows in the whole lap that are the owner's, drawn thicker than the four that are machinery.
 *
 * Not a colour: `Arrowhead` fills with `currentColor` precisely so an arrow never carries a hue, because a
 * hue in these figures means a stage. Stroke weight says the same thing without spending a stage on it.
 */
const HUMAN_STROKE = "2.2";

/**
 * The owner's feedback loop, drawn as the closed circuit it is.
 *
 * The chair sits at the CENTRE rather than in a line, and that is the whole reason this figure is radial.
 * One lap passes through it twice: once taking the owner's instruction and spawning seats, once taking what those
 * seats bring back and putting what needs the owner on the Queue. Drawn left-to-right, the chair would have to
 * appear twice — and a picture with two chairs contradicts the one claim it exists to make, which is that the
 * owner speaks to just one.
 *
 * The closing arrow, the Queue back to the owner, is drawn with as much room as any other on purpose: it is
 * what makes this a loop rather than a delegation tree, and it is the arrow most easily left as an
 * afterthought.
 *
 * @returns the figure, captioned
 */
export function FeedbackLoop(): ReactElement {
  return (
    <Figure
      arrow="sw-loop-arrow"
      viewBox="0 0 1060 500"
      label="The owner's feedback loop, as a closed circuit of six arrows. They type into one pinned supervisor chair. That chair spawns a visible peer seat per board row with cmux spawn. Those seats send back a page with page publish, or a recorded question with handover ask. A seat's recorded question is a console Queue card the moment it is asked; the chair reads the rest with handover list and registers whatever else needs the owner on that Queue with handover register, and the owner reads that one page and answers it. Four arrows carry those verbs. The two that carry none are the two that are the owner, and they are drawn thicker for it. The chair is drawn once, at the centre, because a single lap passes through it twice."
      caption={
        <>
          The owner's loop, closed. They speak to <strong>one</strong> chair and read <strong>one</strong> page;
          everything between the two is the fleet. The chair is drawn once, at the centre, because a single lap passes
          through it twice: <code>slopweaver cmux list --json</code> shows exactly one workspace with{" "}
          <code>pinned: true</code>, and that one is it.
        </>
      }
    >
      <Kicker x={140} y={156} text="THE ONLY HUMAN HERE" />
      <Kicker x={534} y={138} text="ONE CHAIR, PINNED" />
      <Kicker x={918} y={34} text="MANY SEATS, ONE PER ROW" />

      <Solid
        x={24}
        y={172}
        w={232}
        h={118}
        fill={STAGE.in}
        title="The owner"
        detail="speaks to ONE chair"
        foot="and reads ONE page"
      />

      <rect x="386" y="152" width="296" height="158" rx="10" fill={STAGE.mid} />
      <text x="534" y="196" textAnchor="middle" fontSize="14" fontWeight="600" fill="#ffffff">
        The pinned supervisor
      </text>
      <text x="534" y="216" textAnchor="middle" fontSize="12" fill="#ffffff" opacity="0.88">
        the one chat the owner talks to
      </text>
      {CHAIR_ROWS.map((row) => (
        <g key={row.text}>
          <rect x="400" y={row.y} width="268" height="22" rx="6" fill="#ffffff" opacity="0.14" />
          <text x="412" y={row.y + 15} fontSize="11.5" fill="#ffffff">
            {row.text}
          </text>
        </g>
      ))}

      <Solid
        x={800}
        y={50}
        w={236}
        h={118}
        fill={STAGE.mid}
        title="Peer seats"
        detail="one visible session each"
        foot="never a daemon, never hidden"
      />

      <Panel
        x={800}
        y={300}
        w={236}
        h={126}
        title="Artifacts and asks"
        detail={["a page the owner reacts to,", "or a recorded question"]}
        foot={["one board row per", "thing still in flight"]}
      />

      <Solid
        x={24}
        y={352}
        w={300}
        h={112}
        fill={STAGE.out}
        title="The console Queue"
        detail="every question for the owner, one card each"
        foot="the one page the owner reads"
      />

      {/* 1 · the owner into the chair. A human act, so it names no verb — there is no verb for typing. */}
      <g strokeWidth={HUMAN_STROKE}>
        <Arrow from={256} to={378} y={231} arrow="sw-loop-arrow" label="the owner types" />
      </g>

      {/* 2-5 · the machinery half of the lap. Every one of these four arrows carries its own verb. */}
      <g stroke="currentColor" strokeWidth="1.6" fill="none" markerEnd="url(#sw-loop-arrow)">
        <path d="M682 237 H752 V109 H792" />
        <path d="M918 168 V292" />
        <path d="M792 363 H736 V263 H686" />
        <path d="M534 310 V408 H330" />
      </g>
      <text x="760" y="182" fontSize="11" fill="var(--sw-figure-muted)">
        {"cmux spawn"}
      </text>
      <text x="932" y="216" fontSize="11" fill="var(--sw-figure-muted)">
        page publish
      </text>
      <text x="932" y="232" fontSize="11" fill="var(--sw-figure-muted)">
        handover ask
      </text>
      <text x="728" y="332" textAnchor="end" fontSize="11" fill="var(--sw-figure-muted)">
        handover list
      </text>
      <text x="440" y="398" textAnchor="middle" fontSize="11" fill="var(--sw-figure-muted)">
        handover register
      </text>

      {/* 6 · the page back to the owner. The arrow that makes this a loop instead of a delegation tree. */}
      <g stroke="currentColor" strokeWidth={HUMAN_STROKE} fill="none" markerEnd="url(#sw-loop-arrow)">
        <path d="M174 352 V298" />
      </g>
      <text x="188" y="316" fontSize="11" fill="var(--sw-figure-muted)">
        the owner reads it,
      </text>
      <text x="188" y="332" fontSize="11" fill="var(--sw-figure-muted)">
        and answers it
      </text>

      <text x="360" y="448" fontSize="11.5" fill="var(--sw-figure-muted)">
        Two of the six arrows are the owner. The other four are verbs, and each one is
      </text>
      <text x="360" y="466" fontSize="11.5" fill="var(--sw-figure-muted)">
        a command on this machine that you can run and watch happen.
      </text>
    </Figure>
  );
}
