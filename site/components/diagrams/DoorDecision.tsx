import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

const CHECKS = [
  { y: 96, text: "Is this verb allowed to reach this provider at all?" },
  { y: 134, text: "Does the form validate every field the schema requires?" },
  { y: 172, text: "Does the shape fit above the fold, or does it REFUSE?" },
  { y: 210, text: "Is there a finding on this branch the owner has not ruled on?" },
] as const;

/**
 * What the door does to an outbound act, and the two ways out of it.
 *
 * Drawn for the property rule 7 turns on: an outbound form CAPS what appears above the fold and REFUSES a
 * violation rather than truncating one. A truncating door produces a message that looks fine and says
 * less than it claims; a refusing door produces a session that has to fix the message.
 *
 * @returns the figure, captioned
 */
export function DoorDecision(): ReactElement {
  return (
    <Figure
      arrow="sw-door-arrow"
      viewBox="0 0 1060 360"
      label="An outbound act enters the admit door, which runs four checks in order: whether the verb may reach that provider, whether the typed form validates, whether the rendered shape fits above the fold, and whether the branch carries an unruled finding. A pass sends the act and writes a door_event row. A failure is a policy refusal carrying what caught it, legitimate exceptions, the named escape hatch and an instruction to use judgement."
      caption={
        <>
          The shape is enforced by the <strong>schema</strong>, never by review. A form that would exceed what fits
          above the fold is <strong>refused</strong>, not truncated: a truncated message reads perfectly and says less
          than it claims, which is the failure this door exists to make impossible.
        </>
      }
    >
      <Kicker x={120} y={42} text="A SESSION ACTS" />
      <Kicker x={530} y={42} text="src/admit" />
      <Kicker x={930} y={42} text="WHAT HAPPENS" />

      <Solid
        x={24}
        y={128}
        w={196}
        h={92}
        fill={STAGE.mid}
        title="slack post"
        detail="github pr · linear issue"
        foot="a typed form, never a string"
      />
      <Arrow from={220} to={286} y={174} arrow="sw-door-arrow" />

      <rect x="294" y="72" width="476" height="196" rx="12" fill={STAGE.in} />
      <text x="532" y="96" textAnchor="middle" fontSize="11" letterSpacing="1.5" fill="#ffffff" opacity="0.9">
        THE DOOR: ONE, FOR EVERY PROVIDER
      </text>
      {CHECKS.map((check) => (
        <g key={check.text}>
          <rect x="310" y={check.y + 12} width="444" height="30" rx="6" fill="#ffffff" opacity="0.15" />
          <text x="324" y={check.y + 32} fontSize="12.5" fill="#ffffff">
            {check.text}
          </text>
        </g>
      ))}

      <Arrow from={770} to={836} y={122} arrow="sw-door-arrow" label="pass" />
      <Solid
        x={844}
        y={86}
        w={192}
        h={76}
        fill={STAGE.out}
        title="Sent"
        detail="and journalled"
        foot="a door_event row"
      />

      <Rail d="M770 220 L836 220" arrow="sw-door-arrow" />
      <Panel
        x={844}
        y={184}
        w={192}
        h={92}
        title="A policy refusal"
        detail="four lines, always in order"
        foot={["what caught it · exceptions", "the hatch · judgement"]}
      />

      <text x={24} y={300} fontSize={11.5} fill="var(--sw-figure-muted)">
        A refusal that only says “blocked” is a defect: one that does not say why helps neither
      </text>
      <text x={24} y={318} fontSize={11.5} fill="var(--sw-figure-muted)">
        the agent nor a human, and both need the information. The wording is a constant the
      </text>
      <text x={24} y={336} fontSize={11.5} fill="var(--sw-figure-muted)">
        renderer owns, so no gate can quietly word itself
      </text>
      <text x={24} y={354} fontSize={11.5} fill="var(--sw-figure-muted)">
        “do not override”.
      </text>
    </Figure>
  );
}
