import type { ReactElement } from "react";

import { Figure, Kicker, Panel, Rail, Solid } from "./figure";

const LANES = [
  {
    x: 24,
    t: "unit",
    d: "src/__tests__/unit/** · site · desktop",
    f: "zero mocks · no network · temp-dir fixtures",
    fill: "var(--sw-stage-mid)",
  },
  {
    x: 365,
    t: "integration",
    d: "src/__tests__/integration/**",
    f: "Polly cassettes, replayed offline, re-recordable",
    fill: "var(--sw-stage-out)",
  },
  {
    x: 706,
    t: "subprocess",
    d: "src/__tests__/subprocess/**",
    f: "real git, the shipped bin, frozen turn replays",
    fill: "var(--sw-stage-in)",
  },
] as const;

/**
 * The three test lanes — one Vitest config each under `config/vitest/` — and the two sandboxes every one
 * of them installs.
 *
 * The figure is drawn for the mechanical fact that costs the most time when it is not known: a lane is
 * selected by DIRECTORY, so a `*.test.ts` sitting next to its source is silently never run. The only
 * symptom is a test count that did not move. A frozen failed turn is a subprocess-lane test under
 * `subprocess/replay/`, driving the real verbs over its fixture with `--home`.
 *
 * @returns the figure, captioned
 */
export function TestLanes(): ReactElement {
  return (
    <Figure
      arrow="sw-lanes-arrow"
      viewBox="0 0 1060 340"
      label="Three test lanes, unit, integration and subprocess, one Vitest config each, every one selected by directory rather than by filename. The integration lane replays recorded provider cassettes offline; the subprocess lane spawns real git and the shipped binary, and holds the frozen failed-turn replays. Every lane's setup files install two sandboxes: one that points SLOPWEAVER_HOME at a per-test-file directory and fails the individual test that writes outside it, and one that mints a throwaway TMPDIR per test file and removes it afterwards. A lane declaring its own setup files replaces the base array rather than extending it, so it spells both entries again."
      caption={
        <>
          A lane is selected by <strong>directory</strong>. A <code>*.test.ts</code> placed next to its source is{" "}
          <strong>silently never run</strong>: not an error, simply not collected, and the only symptom is a test count
          that did not move.
        </>
      }
    >
      <Kicker x={530} y={36} text="THREE LANES" />
      {LANES.map((lane) => (
        <Solid
          key={lane.t}
          x={lane.x}
          y={56}
          w={330}
          h={96}
          fill={lane.fill}
          title={lane.t}
          detail={lane.d}
          foot={lane.f}
        />
      ))}

      <Rail d="M530 152 L530 180" arrow="sw-lanes-arrow" />
      <Kicker x={530} y={174} text="EVERY LANE INSTALLS BOTH" />

      <Panel
        x={24}
        y={190}
        w={506}
        h={78}
        title="setup-ambient-home.ts"
        detail="$SLOPWEAVER_HOME → a per-test-FILE sandbox"
        foot="and FAILS the individual test that wrote outside it"
      />
      <Panel
        x={540}
        y={190}
        w={496}
        h={78}
        title="setup-temp-root.ts"
        detail="TMPDIR → one throwaway root per test FILE"
        foot="inherited by every helper, every spawned git, every child"
      />

      <text x={24} y={290} fontSize={11.5} fill="var(--sw-figure-muted)">
        MEASURED: one `os.scandir` of the shared temp directory took 309.9 seconds and blocked `github push`
      </text>
      <text x={24} y={307} fontSize={11.5} fill="var(--sw-figure-muted)">
        outright, against 19.33s on a clean TMPDIR. Every mkdtemp had been asked in PROSE to clean up after
      </text>
      <text x={24} y={324} fontSize={11.5} fill="var(--sw-figure-muted)">
        itself, and the prose is what produced the backlog, which is why both of these are mechanisms.
      </text>
    </Figure>
  );
}
