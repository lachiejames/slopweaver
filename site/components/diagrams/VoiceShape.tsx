import type { ReactElement } from "react";

import { Figure, Kicker, Panel, Rail, Solid, STAGE } from "./figure";

/**
 * What a message the bot sends is allowed to look like, and where the limit is enforced.
 *
 * The claim is rule 7's second half, which is the one that gets lost: the shape is enforced by the
 * SCHEMA, never by review. A form caps what appears above the fold and refuses a violation rather than
 * truncating it, so “concise” is a property of the type rather than a note a reviewer might not make.
 *
 * @returns the figure, captioned
 */
export function VoiceShape(): ReactElement {
  return (
    <Figure
      arrow="sw-voice-arrow"
      viewBox="0 0 1060 340"
      label="A message the bot sends is concise above the fold with everything else collapsed behind something the reader chooses to expand. The cap is enforced by the outbound form's schema, which refuses a violating message rather than truncating it. One top-level message per new post to a channel; inside an existing thread the owner drips across short replies."
      caption={
        <>
          Progressive disclosure is the default arrangement, and the cap is a <strong>schema</strong> rather than a
          review note. Run <code>slopweaver slack voice-rules</code> before writing anything as the owner; its body
          carries the owner's own per-example picks, and they beat any general guidance.
        </>
      }
    >
      <Kicker x={264} y={36} text="ABOVE THE FOLD" />
      <Kicker x={792} y={36} text="BELOW IT" />

      <Solid
        x={24}
        y={58}
        w={480}
        h={76}
        fill={STAGE.mid}
        title="The answer, in the owner's plain sentences"
        detail="lead with the one number that sells it"
        foot="no section headers on a short message"
      />
      <Panel
        x={24}
        y={150}
        w={480}
        h={62}
        title="What it is evidence for"
        detail="if they made several points, quote the one you answer"
      />
      <Panel
        x={24}
        y={228}
        w={480}
        h={62}
        title="Who it is for"
        detail="tag the people it is about, never name them in prose"
      />

      <Panel
        x={552}
        y={58}
        w={484}
        h={62}
        title="▸ The working"
        detail="collapsed, and the reader chooses to open it"
      />
      <Panel x={552} y={136} w={484} h={62} title="▸ Every source" detail="a link per claim" />
      <Panel
        x={552}
        y={214}
        w={484}
        h={62}
        title="▸ Owners and next steps"
        detail="recommendations, below the fold (only the owner is tagged)"
      />

      <Rail d="M504 96 L544 96" arrow="sw-voice-arrow" />

      <text x="24" y="322" fontSize="11.5" fill="var(--sw-figure-muted)">
        The form REFUSES a message that would exceed the cap. It never truncates one: a truncated message reads
        perfectly and says less than it claims.
      </text>
    </Figure>
  );
}
