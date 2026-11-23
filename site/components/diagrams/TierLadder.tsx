import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/**
 * The three ways a judged ask can actually get done, and what each one costs.
 *
 * Drawn as a ladder rather than a table because the claim is the MATCH — what the ask needs decides the
 * tier, and a reader who takes the tiers as a menu of increasingly good options has read it backwards.
 * Each rung pairs the condition with the tier it earns, on one line.
 *
 * @returns the figure, captioned
 */
export function TierLadder(): ReactElement {
  return (
    <Figure
      arrow="sw-tier-arrow"
      viewBox="0 0 1060 470"
      label="A judged ask earns exactly one of three execution tiers. An answer already in hand is answered inline, with no new process. Work that means going and looking fans out read-only subagents, which return reports and spawn nothing of their own. A whole turn's work leases a fresh visible session you can watch and interrupt. The third tier carries an elapsed lease, and a request whose lease has expired is answered lease-expired rather than being dispatched."
      caption={
        <>
          The tier is a consequence of what the ask needs, never a preference. The third one carries an{" "}
          <strong>elapsed lease</strong>, which is the whole reason a session nobody is watching cannot be left
          dispatched forever, and the default is stated in the source as provisional rather than considered.
        </>
      }
    >
      <Kicker x={224} y={44} text="WHAT THE ASK NEEDS" />
      <Kicker x={782} y={44} text="THE TIER IT EARNS" />

      <Panel
        x={24}
        y={68}
        w={380}
        h={88}
        title="The answer is already in hand"
        detail="the session knows it, or one read settles it"
        foot="nothing has to go anywhere"
      />
      <Arrow from={404} to={520} y={112} arrow="sw-tier-arrow" label="answers inline" />
      <Solid
        x={528}
        y={68}
        w={508}
        h={88}
        fill={STAGE.out}
        title="inline"
        detail="no new process at all"
        foot="the cheapest honest tier, and the commonest"
      />

      <Panel
        x={24}
        y={176}
        w={380}
        h={88}
        title="Somebody has to go and look"
        detail="the corpus, a thread, a log, a pull request"
        foot="reading only: it writes nothing"
      />
      <Arrow from={404} to={520} y={220} arrow="sw-tier-arrow" label="fans out" />
      <Solid
        x={528}
        y={176}
        w={508}
        h={88}
        fill={STAGE.mid}
        title="read-only subagent"
        detail="returns a report, never an answer"
        foot="flat by ruling: a detective spawns nothing"
      />

      <Panel
        x={24}
        y={284}
        w={380}
        h={88}
        title="It is a whole turn's work"
        detail="build it, prove it, land it, say what it cost"
        foot="bigger than this conversation"
      />
      <Arrow from={404} to={520} y={328} arrow="sw-tier-arrow" label="leases" />
      <Solid
        x={528}
        y={284}
        w={508}
        h={88}
        fill={STAGE.in}
        title="fresh visible session"
        detail="one you can watch and interrupt"
        foot="and it carries an expiring lease"
      />

      <text x={24} y={404} fontSize={11.5} fill="var(--sw-figure-muted)">
        A hard cap on turns alone would not fix anything; it defers a session that never terminates until a later
      </text>
      <text x={24} y={422} fontSize={11.5} fill="var(--sw-figure-muted)">
        consumer has already frozen around the gap. So a fresh-session request carries a wall-clock lease, and the
      </text>
      <text x={24} y={440} fontSize={11.5} fill="var(--sw-figure-muted)">
        executor refuses to dispatch one that has already expired: it answers lease-expired rather than spawning a
      </text>
      <text x={24} y={458} fontSize={11.5} fill="var(--sw-figure-muted)">
        session nobody will ever check on again. The default is two hours, and the source calls that provisional.
      </text>
    </Figure>
  );
}
