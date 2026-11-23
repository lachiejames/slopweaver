import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

const CODES = [
  { y: 64, code: "0 · success", verdict: "row stamped", refusal: false },
  { y: 112, code: "2 · a caller mistake", verdict: "refused before it acted", refusal: true },
  { y: 160, code: "3 · it ran, there was none", verdict: "row stamped", refusal: false },
  { y: 208, code: "4 · a prerequisite is running", verdict: "still due", refusal: false },
] as const;

/**
 * What a due row is, who runs it, and the exit code a scheduler reads it by.
 *
 * Two claims a reader does not get from the verb list. The first is that the SHAPE decides the runner:
 * a command runs in the calling process and is not a fill decision at all, while a resync is a seated
 * session because draining them serially took 2h40m in one measured pass. The second is the pair at the
 * bottom right — 3 and 4 look interchangeable and differ by the only thing that matters to a scheduler,
 * which is whether the row is stamped and therefore silent until its next firing.
 *
 * @returns the figure, captioned
 */
export function AutomationShape(): ReactElement {
  return (
    <Figure
      arrow="sw-ask-arrow"
      viewBox="0 0 1060 400"
      label="A scheduled row comes due because a supervisor tick decided it should; there is no clock and no daemon. Its shape decides the runner: a command runs in the calling process with no model, and a resync is seated on one visible session. A scheduler then reads the exit code: zero stamps the row, two is a caller mistake refused before it acted, three means it ran and there was nothing to do and still stamps the row, and four means a prerequisite is still running so the row stays due."
      caption={
        <>
          The shape decides the runner, and the exit code decides whether the row goes quiet.{" "}
          <strong>3 and 4 are not interchangeable</strong>: reaching for 3 on a not-yet stamps the row and silences it
          until its next firing.
        </>
      }
    >
      <Kicker x={154} y={44} text="A ROW COMES DUE" />
      <Kicker x={514} y={44} text="ITS SHAPE" />
      <Kicker x={868} y={44} text="WHAT THE EXIT SAYS" />

      <Panel
        x={24}
        y={64}
        w={260}
        h={144}
        title="Nothing stands by"
        detail={["no clock, no cron, no daemon:", "a supervisor tick decides", "that this row should run"]}
        foot={["the read is read-only and exits 0", "whatever it finds, so non-zero is a fault"]}
      />

      <Arrow from={284} to={356} y={102} arrow="sw-ask-arrow" label="run here" />
      <Arrow from={284} to={356} y={194} arrow="sw-ask-arrow" label="seat it" />

      <Solid
        x={364}
        y={64}
        w={300}
        h={76}
        fill={STAGE.mid}
        title="A COMMAND"
        detail="runs in this very process"
        foot="no model, nothing spawned, then it exits"
      />

      <Solid
        x={364}
        y={156}
        w={300}
        h={76}
        fill={STAGE.out}
        title="A SESSION"
        detail="one visible seat claims it"
        foot="a resync walks a provider, for minutes"
      />

      {CODES.map((row) => (
        <g key={row.code}>
          <rect
            x="700"
            y={row.y}
            width="336"
            height="40"
            rx="8"
            fill={row.refusal ? "#9f1239" : "var(--sw-figure-panel)"}
            stroke={row.refusal ? "#9f1239" : "var(--sw-figure-line)"}
          />
          <text
            x={714}
            y={row.y + 25}
            fontSize="12"
            fontWeight="600"
            fill={row.refusal ? "#ffffff" : "var(--sw-figure-ink)"}
          >
            {row.code}
          </text>
          <text
            x={1022}
            y={row.y + 25}
            textAnchor="end"
            fontSize="11.5"
            fill={row.refusal ? "#ffffff" : "var(--sw-figure-muted)"}
            opacity={row.refusal ? "0.9" : "1"}
          >
            {row.verdict}
          </text>
        </g>
      ))}

      <text x="700" y="282" fontSize="12.5" fontWeight="600" fill="var(--sw-figure-ink)">
        3 and 4 are not interchangeable
      </text>
      <text x="700" y="302" fontSize="11.5" fill="var(--sw-figure-muted)">
        reaching for 3 on a not-yet stamps the
      </text>
      <text x="700" y="320" fontSize="11.5" fill="var(--sw-figure-muted)">
        row and silences it until its next firing
      </text>

      <text x="24" y="282" fontSize="11.5" fill="var(--sw-figure-muted)">
        A command row is not a fill decision at all; run it in this tick and move on.
      </text>

      <text x="24" y="368" fontSize="11.5" fill="var(--sw-figure-muted)">
        Draining every due row serially took 2h40m in one measured pass, which is why the seated shape exists and why a
        seat takes as many rows as one session should hold.
      </text>
    </Figure>
  );
}
