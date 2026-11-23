/** The pull request's panel and the autonomous act's panel, with the count of earlier acts an act card folds. */
import { type ReactElement } from "react";

import type { ActPullState } from "../../lib/actPullVerb";
import { landingCiWord } from "../../lib/landingCi";
import { type ActCardForm } from "../../lib/queueActRow";
import { type ActLinks, steerDraft, subjectLabel } from "../../lib/queueCardAsk";
import { recordLine, recordLink, recordMaybe } from "../../lib/recordLines";
import { navHref } from "../../lib/workContext";
import { type AutonomyRow } from "../live/readAutonomy";
import { type LandingReading, type LandingRow } from "../live/readLanding";
import { SLIDE_FOOT_NOTE, SlideFoot, SlideOver } from "../live/SlideOver";
import { ActLinkList } from "./ActLinkList";
import { ApprovalActions } from "./ApprovalActions";
import { BUTTON, BUTTON_PRIMARY } from "./controls";
import { Reasoning } from "./PanelReasoning";
import { QueueCardBody } from "./QueueCardBody";
import { actLookupMarks } from "./QueuePanelMarks";
import { FOOT_NOTE, type PanelCommon, RECORD_SUMMARY, refusedProps } from "./QueuePanelsCommon";
import { RecordLines } from "./RecordLines";
import { settle } from "./settling";
import { useWorkContext } from "./workContextState";

/**
 * The pull request's panel: the card, and the header GitHub draws folded beneath it.
 *
 * @returns the panel
 */
export function PrPanel({
  landingRow,
  reading,
  row,
  gone,
  head,
  known,
}: PanelCommon & { landingRow: LandingRow; reading: LandingReading }): ReactElement {
  const { context } = useWorkContext();
  let blockedOn = "nothing: the verdict is the only thing holding it";
  if (landingRow.blockedOn.length > 0) {
    blockedOn = landingRow.blockedOn.join(", ");
  }
  const details = (
    <RecordLines
      known={known}
      summary={RECORD_SUMMARY}
      lines={[
        recordLink({
          label: "pull request",
          text: `${landingRow.repoSlug}#${String(landingRow.number)}`,
          url: landingRow.url,
        }),
        recordLine({ label: "title", value: landingRow.title }),
        recordLine({ label: "state", value: landingRow.action === "draft" ? "draft" : "open" }),
        recordLine({
          label: "branch",
          value: `${landingRow.headRefName} → ${landingRow.baseRefName}`,
        }),
        recordLine({ label: "CI", value: landingCiWord({ row: landingRow }) }),
        recordLine({ label: "landing says", value: `${landingRow.action}: ${landingRow.actionDetail}` }),
        recordLine({ label: "blocked on", value: blockedOn }),
      ]}
    />
  );
  const footer = (
    <SlideFoot>
      <a
        className={`${BUTTON_PRIMARY} text-[0.82rem] font-[550] no-underline hover:no-underline`}
        href={landingRow.url}
        rel="noreferrer"
      >
        Open on GitHub
      </a>
      <a
        className={`${BUTTON} text-[0.82rem] font-[550] no-underline hover:no-underline`}
        href={navHref({
          context,
          href: `/pull-requests?open=${String(landingRow.number)}&repo=${encodeURIComponent(landingRow.repoSlug)}`,
        })}
      >
        Open on the pull-requests page
      </a>
      <details className={SLIDE_FOOT_NOTE}>
        <summary className="cursor-pointer">why there is no enqueue button</summary>
        <code>github enqueue</code> wants the repository named and its dry-run report (the stack scope it would take and
        every refusal it would make) shown before a press, and that is owed to a later change.
      </details>
    </SlideFoot>
  );
  return (
    <SlideOver {...head} footer={footer}>
      <QueueCardBody
        card={row.card}
        source={row.source}
        known={known}
        {...refusedProps({ row })}
        details={details}
        aside={
          <Reasoning card={row} gone={gone} goneWord="the latest landing reading no longer hands this one to you" />
        }
      />
    </SlideOver>
  );
}

/**
 * How many earlier acts of one pattern a card folds beneath the newest — counted, never listed by their ids.
 *
 * @returns the count in words, or nothing when the act is the only one of its pattern
 */
function earlierActs({ count }: { count: number }): string | undefined {
  if (count === 0) {
    return undefined;
  }
  if (count === 1) {
    return "1 more act of this pattern";
  }
  return `${String(count)} more acts of this pattern`;
}

/**
 * The act's panel: the question, where to check it, and the approval bar — the rest of the card one
 * disclosure away.
 *
 * Clutter is removed by progressive disclosure, and a successful press closes the card and removes the row. So the card is folded (`QueueCardBody`'s
 * `folded`), and a press SETTLES the row (`./settling.tsx`): the panel closes at once, the row leaves every list,
 * and the page's one line says what was recorded — putting the row back only if the verb did not say done.
 *
 * Nothing is ever recorded that is not visible when the owner presses — Approve and Deny print their words. Any other
 * word on the act has no box here: the console's one text input is the call's chat, and this card is the page's open
 * item while the panel is up, so what the owner says there names it.
 *
 * @returns the panel
 */
export function ActPanel({
  act,
  earlier,
  links,
  row,
  gone,
  head,
  known,
  form,
  lookup,
}: PanelCommon & {
  act: AutonomyRow;
  earlier: readonly AutonomyRow[];
  form: ActCardForm;
  links: ActLinks;
  lookup: ActPullState;
}): ReactElement {
  const { refusedMark, staleLookup } = actLookupMarks({ lookup });
  const record = ({ words, did }: { words: string; did: string }): void => {
    void settle({
      about: row.card.question,
      aliases: row.aliases,
      did,
      key: row.key,
      readsSlug: "autonomy",
      slots: { actionId: act.actionId, steer: words },
      slug: "autonomy-steer",
      words,
    });
    head.onClose();
  };
  let subject = recordLine({ label: "subject", value: act.subject });
  if (act.subject.startsWith("https://")) {
    subject = recordLink({
      label: "subject",
      text: subjectLabel({ subject: act.subject }),
      url: act.subject,
    });
  }
  const details = (
    <RecordLines
      known={known}
      summary={RECORD_SUMMARY}
      // No action id, kind or run: internal names, never on a card.
      lines={[
        subject,
        recordMaybe({
          absent: "(none: recorded before the ledger asked for one)",
          label: "said",
          value: act.said,
        }),
        recordLine({ label: "why", value: act.why }),
        recordLine({ label: "done", value: act.doneIso }),
        recordMaybe({ absent: "(none recorded)", label: "witness", value: act.witness }),
        recordMaybe({ absent: "(none: unsteered)", label: "steer", value: act.steer }),
        recordMaybe({
          absent: "(none: the only act of its pattern)",
          label: "earlier",
          value: earlierActs({ count: earlier.length }),
        }),
      ]}
    />
  );
  const footer = (
    <SlideFoot>
      <ApprovalActions
        approveWords={steerDraft({ letter: "A" })}
        denyWords={steerDraft({ letter: "B" })}
        disabled={gone}
        onApprove={() => {
          record({ did: "Approved", words: steerDraft({ letter: "A" }) });
        }}
        onDeny={() => {
          record({ did: "Denied", words: steerDraft({ letter: "B" }) });
        }}
      />
      <details className={SLIDE_FOOT_NOTE}>
        <summary className="cursor-pointer">what these buttons run</summary>
        {FOOT_NOTE} Approve and Deny record the words printed on them. A press closes this panel and takes the row off
        the list; the page says what was recorded, and the row comes back if the verb refused.
      </details>
    </SlideFoot>
  );
  return (
    <SlideOver
      {...head}
      note={
        <>
          {head.note}
          {staleLookup}
        </>
      }
      footer={footer}
    >
      <QueueCardBody
        card={row.card}
        source={row.source}
        known={known}
        folded={true}
        {...(form.kind === "refused" ? { refused: form.why } : {})}
        {...(refusedMark === undefined ? {} : { refusedMark })}
        {...(links.kind === "linked" ? { links: <ActLinkList links={links} /> } : {})}
        details={details}
        aside={
          <Reasoning
            card={row}
            gone={gone}
            goneWord="the ledger now carries your word on this act; it has left the unsteered set"
          />
        }
      />
    </SlideOver>
  );
}
