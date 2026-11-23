import type { ReactElement } from "react";

import { Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

const CLASSES = [
  {
    x: 24,
    title: "Shape",
    detail: ["named-object-params", "max-function-lines", "file-size-ratchet"],
    foot: "a reader has to hold it",
  },
  {
    x: 282,
    title: "Truth",
    detail: ["no-silent-fallback", "epoch-arithmetic", "whole-file-json"],
    foot: "a confident wrong answer",
  },
  {
    x: 540,
    title: "Doctrine",
    detail: ["no-headless", "no-private-browser-profile", "command-trigger"],
    foot: "a rule that would get re-argued",
  },
  {
    x: 798,
    title: "Canon",
    detail: ["doc-links", "doc-counts", "agent-doc-size"],
    foot: "a doc that lies to the next session",
  },
] as const;

/**
 * The gate surface: what a static check here is actually FOR, in four classes.
 *
 * Drawn for the property that makes this repository's gates unusual — most of them exist because a
 * convention was agreed and then broken by the people who agreed it. A gate is what a rule becomes once
 * prose has been measured failing, which is why weakening one to get a green is the named defect.
 *
 * @returns the figure, captioned
 */
export function GateSurface(): ReactElement {
  return (
    <Figure
      arrow="sw-gates-arrow"
      viewBox="0 0 1060 340"
      label="yarn lint runs every static check with no short-circuit, so one run reports everything wrong. The gates fall into four classes: shape, truth, doctrine and canon. Three mechanisms sit under them: a source marker carrying a reason, which five gates accept; a debt list that only shrinks and fails when an entry stops firing; and no run-time override for any lint gate, which its refusal says."
      caption={
        <>
          <code>yarn lint</code> runs every check <strong>with no short-circuit</strong>, so one run tells you
          everything that is wrong. Never weaken a gate to get a green; a debt list that stops firing fails just as
          loudly as one that grows.
        </>
      }
    >
      <Kicker x={530} y={34} text="WHY A RULE BECOMES A GATE" />
      <Solid x={282} y={52} w={496} h={58} fill={STAGE.mid} title="Prose was agreed, then measured failing" />

      <Rail d="M530 110 L530 132" arrow="sw-gates-arrow" />

      {CLASSES.map((klass) => (
        <Panel
          key={klass.title}
          x={klass.x}
          y={140}
          w={238}
          h={104}
          title={klass.title}
          detail={klass.detail}
          foot={klass.foot}
        />
      ))}

      <Kicker x={530} y={262} text="AND HOW EACH ONE LETS YOU PAST" />
      <Panel
        x={24}
        y={274}
        w={330}
        h={52}
        title="A reason-bearing source marker"
        detail="visible in the diff, never in a config file"
      />
      <Panel
        x={366}
        y={274}
        w={330}
        h={52}
        title="A debt list that only shrinks"
        detail="fails when an entry STOPS firing, too"
      />
      <Panel
        x={708}
        y={274}
        w={328}
        h={52}
        title="Nothing: a lint gate says so"
        detail="line three refuses a RUN-TIME override"
      />
      {/*
       * No arrow between the two rows: a zero-length `Arrow` only stamps its arrowhead, which lands on the
       * kicker directly above. The rail from the purple box already carries the downward reading.
       */}
    </Figure>
  );
}
