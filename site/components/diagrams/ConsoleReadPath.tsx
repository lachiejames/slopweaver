import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

/**
 * How a number gets onto a console tile, and the two places it can refuse to.
 *
 * The figure's claim is the allowlist: the route takes a SLUG off the URL and looks it up, so nothing the
 * URL carries is ever spliced into a command. `store read`, `turn` and `cmux spawn` are absent from the map,
 * which is what makes "no model runs in the console" a property of the data structure rather than of
 * anyone's restraint.
 *
 * @returns the figure, captioned
 */
export function ConsoleReadPath(): ReactElement {
  return (
    <Figure
      arrow="sw-console-arrow"
      viewBox="0 0 1060 360"
      label="A tile asks for a verb by slug. The route looks that slug up in a closed allowlist and refuses an unknown one with a 404. A matched row carries a literal argv array, which is spawned with no shell. The verb's JSON is parsed and handed back with the instant it was true of the machine. Every failure (a missing binary, a non-zero exit, a timeout, output that is not JSON) becomes a stated notMeasured reason, which the tile draws as a staleness mark whose hover says it, rather than an empty render."
      caption={
        <>
          The URL never reaches a command. A slug is <em>looked up</em>, and the row it matches carries a{" "}
          <strong>literal argv array</strong> spawned with no shell, so “no model runs in the console” is a property of
          the map, not of anyone's restraint.
        </>
      }
    >
      <Kicker x={120} y={36} text="THE PAGE" />
      <Kicker x={530} y={36} text="app/api/live/[verb]" />
      <Kicker x={930} y={36} text="THE MACHINE" />

      <Solid
        x={24}
        y={128}
        w={196}
        h={92}
        fill={STAGE.mid}
        title="A tile"
        detail="useLive({ slug })"
        foot="fast lane polls; slow lane reads once"
      />
      <Arrow from={220} to={284} y={174} arrow="sw-console-arrow" label="GET /api/live/board" />

      <rect
        x="292"
        y="86"
        width="452"
        height="176"
        rx="12"
        fill="var(--sw-figure-panel)"
        stroke="var(--sw-figure-line)"
      />
      <Panel
        x={308}
        y={104}
        w={420}
        h={60}
        title="liveVerbFor({ slug })"
        detail="a closed map: store read, turn and cmux spawn are simply not in it"
      />
      <Panel
        x={308}
        y={176}
        w={420}
        h={68}
        title="child_process.spawn(slopweaverBin().bin, [...verb.argv])"
        detail="an argv ARRAY, no shell, a per-row timeout"
        foot="the URL is never spliced into a command"
      />

      <Arrow from={744} to={808} y={134} arrow="sw-console-arrow" label="ok" />
      <Solid
        x={816}
        y={98}
        w={220}
        h={72}
        fill={STAGE.out}
        title="the verb's JSON"
        detail="+ when it was TRUE"
        foot="its own stamp, or the route's"
      />

      <Rail d="M744 214 L808 214" arrow="sw-console-arrow" />
      <Panel
        x={816}
        y={186}
        w={220}
        h={94}
        title="notMeasured"
        detail={["no binary · non-zero exit", "timeout · not JSON"]}
        foot="a staleness mark, the reason on hover"
      />

      <text x={24} y={300} fontSize={11.5} fill="var(--sw-figure-muted)">
        MEASURED: `fleet status --json` produced no output inside 180s, so it is ABSENT from the
      </text>
      <text x={24} y={318} fontSize={11.5} fill="var(--sw-figure-muted)">
        map rather than on the slow lane. A tile polling it would show the last answer while a request nobody
      </text>
      <text x={24} y={336} fontSize={11.5} fill="var(--sw-figure-muted)">
        can see was still running, which is the one thing a live console must never do.
      </text>
      <text x="24" y="344" fontSize="11.5" fill="var(--sw-figure-muted)">
        Reproduce both lanes: `time slopweaver fleet status --json` and `time slopweaver handover list --json`.
      </text>
    </Figure>
  );
}
