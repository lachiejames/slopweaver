/**
 * The quiet line a held draft's card carries about the world moving since the draft was written, opening onto who said
 * or changed what. It surfaces what happened in the world since the card was created, without being prominent: one
 * line in the conversation's own muted ink, taking the warning ink only when something moved, and everything else
 * waits behind it. The words are `../../lib/sinceDrafted.ts`'s; the measurement
 * is the verb's.
 */

import type { ReactElement } from "react";
import { ageOf } from "../../lib/ageOf";
import { consoleHref } from "../../lib/localPageHref";
import { sinceDraftedView } from "../../lib/sinceDrafted";
import type { DraftContext } from "../live/readDraftContext";
import { IntegrationFailure } from "./ConnectIntegration";

/** The quiet line every note under the conversation is drawn in. */
const NOTE = "m-0 text-[0.78rem] text-muted-foreground";

/**
 * What moved in the conversation since the draft was written, folded behind one line.
 *
 * @param context the conversation as the card read it, carrying the verb's measurement
 * @returns the folded line, open onto each new or edited message and what the read could not see
 */
export function SinceDraftedDetails({ context }: { context: DraftContext }): ReactElement {
  const reading = context.sinceDrafted;
  let age = "";
  if (reading.kind === "measured") {
    age = ageOf({ iso: reading.draftedIso });
  }
  const view = sinceDraftedView({ age, messages: context.messages, people: context.people, reading });
  if (view.kind === "not-measured") {
    return (
      <details className="basis-full text-[0.78rem]" data-since-drafted="not-measured">
        <summary className="cursor-pointer text-muted-foreground">{view.summary}</summary>
        <IntegrationFailure why={view.why} fallback={<p className={NOTE}>Not measured: {view.why}.</p>} />
      </details>
    );
  }
  const ink = view.changed ? "text-warning" : "text-muted-foreground";
  return (
    <details className="basis-full text-[0.78rem]" data-since-drafted={view.changed ? "changed" : "unchanged"}>
      <summary className={`cursor-pointer ${ink}`}>{view.summary}</summary>
      <div className="mt-[0.3rem] grid gap-[0.2rem]">
        {view.changes.map((change) => (
          <a
            className="text-info no-underline hover:underline"
            data-change={change.kind}
            href={consoleHref({ url: change.permalink })}
            key={change.ts}
            rel="noreferrer"
            target="_blank"
          >
            {change.line}
          </a>
        ))}
        {view.removedLine !== undefined && <p className={NOTE}>{view.removedLine}</p>}
        {view.limits.map((limit) => (
          <p className={NOTE} key={limit}>
            {limit}
          </p>
        ))}
        {!view.changed && view.limits.length === 0 && (
          <p className={NOTE}>The draft still reads against the conversation it was written for.</p>
        )}
      </div>
    </details>
  );
}
