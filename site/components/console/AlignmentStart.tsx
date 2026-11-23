/** What the Alignment page (`./Alignment.tsx`) opens on: Start here, and where alignment stands. */

import type { ReactElement } from "react";
import { ageOf } from "../../lib/ageOf";
import type { AlignmentStage } from "../../lib/alignment";
import type { AlignmentOrderItem } from "../../lib/alignmentRank";
import { STAND_IN_SUBJECT, startHereFaceOf } from "../../lib/alignmentStartHere";
import type { SidebarReading } from "../../lib/sidebarCountsBasis";
import { cn } from "../../lib/utils";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import type { VoiceCohort } from "../live/readAlignment";
import type { LiveState } from "../live/useLive";
import { CARD, engaging } from "./AlignmentCommon";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";

/** What the strip names while the stage's reading is not in hand. */
const STAGE_SUBJECT = "your measured message lengths";

/**
 * The strip the page opens on: where alignment stands, and what this page never does. Its headline is the stage once
 * the measured register has read, the progress indicator while it is on its way, and a staleness mark whose hover says
 * why when the read failed — a failure drawn as the indicator would spin forever.
 *
 * @param profile the read of the measured register, which the stage is judged from
 * @returns the strip
 */
export function StageStrip({
  stage,
  profile,
}: {
  stage: AlignmentStage;
  profile: LiveState<readonly VoiceCohort[]>;
}): ReactElement {
  let standing: ReactElement | string = stage.label;
  if (profile.phase !== "ready") {
    standing = <ReadStandIn state={profile} subject={STAGE_SUBJECT} />;
  } else if (profile.stale !== undefined) {
    // A stage judged off an earlier reading of the register says so beside it, never as if it were current.
    standing = (
      <span className="inline-flex items-center gap-[0.4rem]">
        {stage.label} <ReadMark state={profile} subject={STAGE_SUBJECT} />
      </span>
    );
  }
  return (
    <section
      className={cn(CARD, "mt-4")}
      data-tone={stage.tone}
      data-testid="alignment-stage"
      aria-label="where alignment stands"
    >
      <p className="m-0 text-[0.92rem] font-[650]">{standing}</p>
      <p className="mt-[0.4rem] mb-0 text-[0.8rem] text-muted-foreground">
        The fleet knows what it can see in the sources you connected, and that knowledge is rough until you say how it
        lines up with you. Your voice is learnt from the Slack messages you sent, never asked. Every question here leads
        with a scene and what the fleet would do in it; react in your own words. Nothing on this page blocks any work,
        and nothing on it will chase you. Your past Claude sessions are a source too (
        <code>slopweaver transcripts</code>), read as evidence rather than asked about here.
      </p>
    </section>
  );
}

/**
 * The card the page opens on: the question one answer would change the most for and what it could improve, in the
 * derived order (`../../lib/alignmentRank.ts`), which `docs/console/alignment.md` states and the page does not. A pointer to the question's own card, never a second copy of it;
 * touching it makes that question the one the owner is answering, so they can answer from the top. While a read the order needs
 * is on its way it shows the progress indicator, and when one failed it says which and why, never a partial order.
 *
 * Only a general-ruling question leads, the same questions the count counts: an act is listed below to look back on,
 * never counted, so it never names itself first over a measured zero.
 *
 * @param first the question that leads, `undefined` when nothing waits on the owner's answer
 * @param waiting the page's count of the general-ruling questions waiting on the owner, whose readings the order is
 *   made from
 * @param next what the console is doing about a failed read the count is made from, off its recovery runner
 * @returns the card
 */
export function StartHere({
  first,
  waiting,
  next,
  onEngage,
}: {
  first: AlignmentOrderItem | undefined;
  waiting: SidebarReading;
  next: string;
  onEngage: (key: string) => void;
}): ReactElement {
  // Which face, decided off the readings alone (`../../lib/alignmentStartHere.ts`): a failed read carries the warning
  // with words beside it, and one merely being updated the progress indicator.
  const face = startHereFaceOf({ age: (iso) => ageOf({ iso }), next, waiting });
  if (face.kind === "stand-in") {
    return <ReadStandIn state={face.state} subject={STAND_IN_SUBJECT} block />;
  }
  if (face.kind === "updating") {
    // The count is in hand, only being re-read, so the card marks that inline: a busy block would claim it loading.
    return (
      <section className={CARD} data-testid="alignment-start-here" aria-label="start here">
        <p className="m-0 flex items-center gap-[0.4rem] text-[0.82rem] text-muted-foreground">
          The first question to answer shows here once the count is current.
          <ReadingIndicator label={face.label} />
        </p>
      </section>
    );
  }
  if (face.kind === "failed") {
    return (
      <section className={CARD} data-testid="alignment-start-here" aria-label="start here">
        <p className="m-0 flex items-center gap-[0.4rem] text-[0.82rem] text-muted-foreground">
          The first question to answer shows here once the count is current.
          <StaleMark facts={face.facts} />
        </p>
      </section>
    );
  }
  if (first === undefined) {
    return (
      <section className={CARD} data-testid="alignment-start-here" aria-label="start here">
        <p className="m-0 text-[0.82rem] text-muted-foreground">
          No general-ruling question waits on your answer. A measured zero.
        </p>
      </section>
    );
  }
  return (
    <section
      className={CARD}
      data-testid="alignment-start-here"
      aria-label="start here"
      {...engaging({ about: first.key, onEngage })}
    >
      <p className="m-0 text-[0.75rem] text-muted-foreground">Start here</p>
      <p className="mt-[0.3rem] mb-0 text-[0.92rem] font-[650]">{first.title}</p>
      <p className="mt-[0.4rem] mb-0 text-[0.86rem]">{first.improves}</p>
      <p className="mt-[0.4rem] mb-0 text-[0.82rem]">
        <a href={`#${first.key}`}>Go to this question</a>
      </p>
    </section>
  );
}
