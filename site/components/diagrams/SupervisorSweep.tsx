import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

const REFUSALS = ["a shift state that names a STANDING step", "a rendered prompt over 700 words"] as const;

/**
 * Why the sweep is a file the wake-up reads, and only the shift state ever travels in the prompt.
 *
 * The claim drawn here is the one the prose cannot make obvious on its own: the standing half and the
 * shift half are different objects with different lifetimes, and the renderer REFUSES the two being
 * joined. A prompt that re-absorbs the contract decays by hand-copy — measured, one rule
 * appeared in eight wordings across four handoffs and was then absent from the next three while still
 * true — so the refusal is what keeps the loop closing back onto the file rather than onto a memory.
 *
 * @returns the figure, captioned
 */
export function SupervisorSweep(): ReactElement {
  return (
    <Figure
      arrow="sw-sweep-arrow"
      viewBox="0 0 1060 400"
      label="The standing half of the supervisor sweep is a file, sweep-contract.md, holding the ordered tick as its only copy. The sweep-prompt verb renders a wake-up prompt that names that file by path and carries only this tick's shift state. It refuses a shift state naming a standing step, and a rendered prompt over 700 words. The armed wake-up fires, and the next tick reads the standing half back out of the file rather than out of a prompt that carried a copy of it."
      caption={
        <>
          Two halves with two lifetimes. The <strong>standing</strong> one is a file the wake-up reads; the{" "}
          <strong>shift</strong> one is what changed this tick. The renderer refuses them being joined, which is what
          keeps the loop closing back onto the file instead of onto one session&rsquo;s memory.
        </>
      }
    >
      <Kicker x={174} y={36} text="STANDING: ONE COPY" />
      <Kicker x={538} y={36} text="RENDERED EACH TICK" />
      <Kicker x={894} y={36} text="ARMED" />

      <Panel
        x={24}
        y={56}
        w={300}
        h={96}
        title="sweep-contract.md"
        detail={["the ordered tick, and the only", "copy of it, under the size cap"]}
        foot="read every tick, never retyped"
      />

      <Arrow from={324} to={396} y={104} arrow="sw-sweep-arrow" label="names it" />

      <Solid
        x={404}
        y={56}
        w={268}
        h={96}
        fill={STAGE.mid}
        title="supervisor sweep-prompt"
        detail="renders the prompt you arm"
        foot="SHIFT STATE ONLY: what changed"
      />

      <Arrow from={672} to={744} y={104} arrow="sw-sweep-arrow" label="arms" />

      <Panel
        x={752}
        y={56}
        w={284}
        h={96}
        title="ScheduleWakeup"
        detail={["the rendered string, verbatim", "1200s · noop on a quiet tick"]}
        foot="a cadence held in memory dies with it"
      />

      <Rail d="M538 152 L538 196" arrow="sw-sweep-arrow" />
      <rect x="404" y="204" width="268" height="90" rx="10" fill="#9f1239" />
      <text x="538" y="230" textAnchor="middle" fontSize="13" fontWeight="600" fill="#ffffff">
        It REFUSES two shapes
      </text>
      {REFUSALS.map((refusal, index) => (
        <text key={refusal} x={538} y={254 + index * 18} textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.9">
          {refusal}
        </text>
      ))}
      <text x={538} y={314} textAnchor="middle" fontSize="11" fill="var(--sw-figure-muted)">
        both are the prompt re-absorbing the contract
      </text>

      <Rail d="M894 152 L894 344 L174 344 L174 156" arrow="sw-sweep-arrow" />
      <text x={534} y={334} textAnchor="middle" fontSize="11" fill="var(--sw-figure-muted)">
        the next tick READS the standing half back, rather than carrying a copy of it
      </text>

      <text x="24" y="382" fontSize="11.5" fill="var(--sw-figure-muted)">
        Measured over eleven handoffs: 412 to 998 of every armed prompt&rsquo;s 592 to 1,240 words were standing
        procedure, re-typed by hand.
      </text>
    </Figure>
  );
}
