import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

/** The refusal hue, and the only thing any figure fills with it: a reading that was retracted. */
const RETRACTED = "#9f1239";

/**
 * The two Slack gates that were conflated as one, and which of them ever gated message history.
 *
 * Drawn because the audit that found this spent sixty lines correcting itself in place. One refresh walks
 * two lanes: the STRUCTURE lane resolves channel-membership metadata and is the only thing
 * `--slack-membership-cap` bounds, while the HISTORY lane is where messages are actually read. The cap
 * reads like the scary one and never touched a message; the backfill window is what left 161 reachable
 * conversations holding zero rows.
 *
 * @returns the figure, captioned
 */
export function CoverageGates(): ReactElement {
  return (
    <Figure
      arrow="sw-coverage-arrow"
      viewBox="0 0 1060 380"
      label="One Slack refresh walks two lanes. The structure lane resolves who belongs to each channel and is the only thing the opt-in --slack-membership-cap bounds; it never touches a message, and every channel row records whether its membership was resolved. The history lane reads messages, and it is the lane that was actually gated: archived channels were never discovered and one pooled watermark could not express never-crawled, leaving 161 reachable conversations with zero rows. The reading that blamed is_member false was retracted."
      caption={
        <>
          The channel-membership cap is a scale guard on <strong>structure metadata</strong> and it is opt-in. What
          actually gated message coverage was the backfill window. Both causes are closed;{" "}
          <code>slopweaver refresh --source slack --coverage</code> reports the remaining gap and exits non-zero while
          any exists.
        </>
      }
    >
      <Kicker x={530} y={34} text="ONE REFRESH, TWO GATES: ONLY ONE EVER GATED HISTORY" />

      <Solid
        x={24}
        y={120}
        w={168}
        h={160}
        fill={STAGE.in}
        title="refresh"
        detail="--source slack"
        foot="one walk, two lanes"
      />

      <Arrow from={192} to={246} y={136} arrow="sw-coverage-arrow" label="structure" />
      <Panel
        x={254}
        y={92}
        w={268}
        h={88}
        title="The STRUCTURE lane"
        detail="conversations.members, per channel"
        foot="capped only by --slack-membership-cap"
      />
      <Arrow from={522} to={596} y={136} arrow="sw-coverage-arrow" label="resolves" />
      <Solid
        x={604}
        y={92}
        w={160}
        h={88}
        fill={STAGE.mid}
        title="Metadata only"
        detail="who is in a channel"
        foot="no message is touched"
      />
      <Arrow from={764} to={838} y={136} arrow="sw-coverage-arrow" label="and records" />
      <Panel
        x={846}
        y={92}
        w={190}
        h={88}
        title="Reported, not silent"
        detail={["every channel row carries", "membershipResolved"]}
        foot="derive names the unasked"
      />

      <Arrow from={192} to={246} y={260} arrow="sw-coverage-arrow" label="history" />
      <Panel
        x={254}
        y={216}
        w={268}
        h={88}
        title="The HISTORY lane"
        detail="message history, from one cursor"
        foot={["archived channels never discovered", "one pooled watermark for all"]}
      />
      <Arrow from={522} to={596} y={260} arrow="sw-coverage-arrow" label="reads" />
      <Solid
        x={604}
        y={216}
        w={160}
        h={88}
        fill={STAGE.out}
        title="It gated history"
        detail="161 held zero rows"
        foot="both causes now closed"
      />
      <Arrow from={764} to={838} y={260} arrow="sw-coverage-arrow" label="misread as" />
      <Solid
        x={846}
        y={216}
        w={190}
        h={88}
        fill={RETRACTED}
        title="The retracted read"
        detail="is_member: false"
        foot="was never the boundary"
      />

      <text x="24" y="340" fontSize="11.5" fill="var(--sw-figure-muted)">
        MEASURED: the user token read 476 of 477 non-archived conversations, membership or not; the
      </text>
      <text x="24" y="358" fontSize="11.5" fill="var(--sw-figure-muted)">
        one refusal was a DM whose counterpart is deactivated. Membership is a fact about a channel, not the boundary.
      </text>
    </Figure>
  );
}
