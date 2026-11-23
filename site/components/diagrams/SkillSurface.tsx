import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

/**
 * Where a session's instructions come from, and which of them load always.
 *
 * Drawn for the distinction between an always-on rule and a skill: a rule that loads softly gets
 * re-argued, so the standing doctrine sits in `AGENTS.md` and five unscoped rule files, while a skill is
 * pulled in only when its verb is the thing being done. A seat's launch template drops the three code rules
 * when it never edits code, and Codex, which reads `AGENTS.md` alone, receives the rule files through the
 * plugin's Codex-only `SessionStart` hook.
 *
 * @returns the figure, captioned
 */
export function SkillSurface(): ReactElement {
  return (
    <Figure
      arrow="sw-skills-arrow"
      viewBox="0 0 1060 340"
      label="Every session loads AGENTS.md and the unscoped rule files: cross-session messages and journalled grants in every seat, and TypeScript patterns, testing and error handling in a code seat, since the launch template of a seat that never edits code drops those three. Codex reads AGENTS.md itself and receives the rule files through a Codex-only plugin SessionStart hook. Several source trees add a path-scoped area rule that loads only inside them. A skill under skills slash name slash SKILL dot md is pulled in only when its verb is what is being done, and each stays under about 200 lines with detail in a reference folder."
      caption={
        <>
          A rule that loads softly gets re-argued, so doctrine is <strong>always on</strong>. A skill is pulled in only
          when its verb is what you are doing: one <code>SKILL.md</code> per verb, no second copy, each under about 200
          lines with the procedure in <code>reference/</code>.
        </>
      }
    >
      <Kicker x={264} y={36} text="LOADED AT LAUNCH" />
      <Solid
        x={24}
        y={56}
        w={480}
        h={70}
        fill={STAGE.mid}
        title="AGENTS.md"
        detail="ten operating rules, each naming what enforces it"
      />
      <Panel
        x={24}
        y={136}
        w={235}
        h={72}
        title="typescript-patterns"
        detail="testing · error-handling"
        foot="code seats only"
      />
      <Panel
        x={269}
        y={136}
        w={235}
        h={72}
        title="cross-session-messages"
        detail="journalled-grants"
        foot="every seat"
      />
      <Panel
        x={24}
        y={218}
        w={480}
        h={64}
        title="Per-tree `paths:`-scoped area rules"
        detail="admit · atlas · cli · corpus · devLint · handover · live · outbound"
      />

      <Rail d="M504 170 L560 170" arrow="sw-skills-arrow" />

      <Kicker x={792} y={36} text="PULLED IN WHEN IT IS THE JOB" />
      <Solid
        x={568}
        y={56}
        w={468}
        h={70}
        fill={STAGE.out}
        title="skills/&lt;name&gt;/SKILL.md"
        detail="one per verb, no second copy anywhere"
      />
      <Panel
        x={568}
        y={140}
        w={468}
        h={64}
        title="skills/&lt;name&gt;/reference/*.md"
        detail="the procedure and the detail: what keeps SKILL.md under ~200 lines"
      />
      <Panel
        x={568}
        y={218}
        w={468}
        h={64}
        title="Gated by `command-trigger` and `agent-doc-size`"
        detail="a skill that drifts from its verb fails `yarn lint`"
      />
      <Arrow from={802} to={802} y={136} arrow="sw-skills-arrow" />
      <Arrow from={802} to={802} y={214} arrow="sw-skills-arrow" />

      <text x="24" y="320" fontSize="11.5" fill="var(--sw-figure-muted)">
        Enumerate what this install actually has with `slopweaver catalog` and `ls skills/`, never from a count written
        down here.
      </text>
    </Figure>
  );
}
