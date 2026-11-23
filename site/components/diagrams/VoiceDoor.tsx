import type { ReactElement } from "react";

import { Arrow, Figure, Panel, Solid, STAGE } from "./figure";

/**
 * Where a voice rule actually fires, and what it fires on.
 *
 * The claim is the one that surprises a reader who assumes a style checker rewrites prose: the rules run
 * over AUTHORED PROSE only, so a link, a fenced block, a quoted third-party line and a technical identifier
 * are cut out before any rule is applied, and a match REFUSES the send before the network call rather than
 * editing the sentence into compliance.
 *
 * @returns the figure, captioned
 */
export function VoiceDoor(): ReactElement {
  return (
    <Figure
      arrow="sw-voicedoor-arrow"
      viewBox="0 0 1060 340"
      label="A composed message is reduced to authored prose before any voice rule runs: fenced code, a quoted line, a URL, inline code and a technical identifier are all cut out first. A rule matching what is left refuses the send before any network call, naming the field, the line and the rule that fired, and never rewrites the sentence."
      caption={
        <>
          A rule can only ever fire on prose <strong>the owner would have typed</strong>. What is left after the cut is
          what gets checked, and a match <strong>refuses</strong> the send before any network call. Nothing is rewritten
          for you.
        </>
      }
    >
      <Panel
        x={24}
        y={64}
        w={300}
        h={196}
        title="The composed message"
        detail={["Landed <url|the PR #N> [em dash]", "`strictForm` caught it in", "src/outbound/voice/."]}
        foot={["a link, inline code and an", "identifier are not the owner's prose"]}
      />

      <Arrow from={324} to={404} y={162} label="strips" arrow="sw-voicedoor-arrow" />

      <Solid
        x={412}
        y={112}
        w={236}
        h={100}
        fill={STAGE.mid}
        title="authoredProseOf(text)"
        detail="what is left is the owner's own prose"
      />

      <Arrow from={648} to={728} y={162} label="refuses" arrow="sw-voicedoor-arrow" />

      <Panel
        x={736}
        y={64}
        w={300}
        h={196}
        title="REFUSED, before the send"
        detail={["proof.notes[0].line[0]:", "matches the configured", "literal voice rule: em dash."]}
        foot={["Rewrite the authored prose,", "or name the one hatch."]}
      />

      <text x="24" y="288" fontSize="11.5" fill="var(--sw-figure-muted)">
        Cut before any rule runs: a fenced block, a line opening with &gt;, a URL, a Slack link, inline code, and a
        technical identifier.
      </text>
      <text x="24" y="306" fontSize="11.5" fill="var(--sw-figure-muted)">
        An identifier leaves its surrounding punctuation behind, so removing it never joins two sentences into one a
        rule could then match.
      </text>
      <text x="24" y="324" fontSize="11.5" fill="var(--sw-figure-muted)">
        Three of the four rule kinds say a thing must NOT appear. The fourth, at-least-one, is the hedge FLOOR: it fires
        when none of a set does.
      </text>
    </Figure>
  );
}
