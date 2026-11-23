import type { ReactElement } from "react";

import { Arrow, Figure, Kicker, Panel, Solid, STAGE } from "./figure";

const JOBS = [
  {
    x: 24,
    title: "build: runs",
    detail: "the required verdict of five workers",
    foot: "all meaningful on the MERGED result",
  },
  {
    x: 366,
    title: "integration: runs",
    detail: "replays committed cassettes",
    foot: "reads nothing from the pull request",
  },
] as const;

/**
 * Why a queue entry is a different subject from the pull request that produced it.
 *
 * The claim is the middle box: GitHub builds a throwaway ref from the base tip plus every entry ahead of
 * this one plus this one, and fires one event on it. Two things follow that neither the prose nor a
 * reader's intuition supplies — rebasing a mergeable pull request before queueing buys nothing the queue
 * is not already about to do, and a workflow without that trigger produces NO check on the entry at all,
 * so a required context that can never arrive does not fail the entry, it stalls it.
 *
 * @returns the figure, captioned
 */
export function MergeQueueEntry(): ReactElement {
  return (
    <Figure
      arrow="sw-queue-arrow"
      viewBox="0 0 1060 400"
      label="A pull request's own checks run on its head commit. Enqueuing it makes GitHub build a new throwaway reference from the base tip plus every entry ahead of it plus this one, and fire the merge_group event on that reference alone. The build and integration jobs run there and are meaningful on the merged result. The pull-request body gate does not run, because that event carries no pull request, so the queue's required checks are build and integration, never the body gate."
      caption={
        <>
          The entry is a <strong>different subject</strong> from the pull request. GitHub performs the rebase itself, on
          a throwaway reference, which is why a mergeable pull request goes straight to the queue, with no seat to wait
          for and no wave to be in.
        </>
      }
    >
      <Kicker x={164} y={44} text="THE PULL REQUEST" />
      <Kicker x={530} y={44} text="THE ENTRY" />
      <Kicker x={896} y={44} text="ONE EVENT" />

      <Panel
        x={24}
        y={64}
        w={280}
        h={88}
        title="Its own checks"
        detail={["ran on the head commit,", "on the pull request's branch"]}
        foot="the queue does not re-run them"
      />

      <Arrow from={304} to={376} y={108} arrow="sw-queue-arrow" label="enqueue" />

      <Solid
        x={384}
        y={64}
        w={292}
        h={88}
        fill={STAGE.mid}
        title="GitHub builds a NEW ref"
        detail="base tip + every entry ahead + this one"
        foot="which IS the rebase, on a throwaway ref"
      />

      <Arrow from={676} to={748} y={108} arrow="sw-queue-arrow" label="fires" />

      <Solid
        x={756}
        y={64}
        w={280}
        h={88}
        fill={STAGE.out}
        title="merge_group"
        detail="the ONLY event on that ref"
        foot="nothing else fires there at all"
      />

      <Kicker x={530} y={190} text="WHAT RUNS ON THE ENTRY" />

      {JOBS.map((job) => (
        <Panel key={job.title} x={job.x} y={210} w={330} h={76} title={job.title} detail={job.detail} foot={job.foot} />
      ))}

      <rect x="708" y="210" width="328" height="76" rx="9" fill="#9f1239" />
      <text x="872" y="236" textAnchor="middle" fontSize="13" fontWeight="600" fill="#ffffff">
        the body gate: CANNOT run
      </text>
      <text x="872" y="256" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.9">
        its subject is the pull request BODY,
      </text>
      <text x="872" y="272" textAnchor="middle" fontSize="11" fill="#ffffff" opacity="0.9">
        and this event carries no pull request
      </text>

      <text x="24" y="326" fontSize="12.5" fontWeight="600" fill="var(--sw-figure-ink)">
        So the queue&rsquo;s required checks are build and integration, and never the body gate.
      </text>
      <text x="24" y="352" fontSize="11.5" fill="var(--sw-figure-muted)">
        Carrying the trigger is necessary and not sufficient: it makes a check AVAILABLE to an entry, and only the base
        branch&rsquo;s own require-status-checks rule makes the queue WAIT for one.
      </text>
      <text x="24" y="378" fontSize="11.5" fill="var(--sw-figure-muted)">
        Measured with that rule unchecked: an enqueue at 09:14:25.096Z, its merge commit at 09:14:26Z. One second,
        against a CI lap this repository measures at p50 9m23s.
      </text>
    </Figure>
  );
}
