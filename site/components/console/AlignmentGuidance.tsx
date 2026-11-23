"use client";

/**
 * The owner's guidance on the Alignment page: one closed fold whose summary counts every source, opening onto each
 * rank in order — doctrine, standing rules, then rulings, asks and memory — with one line per entry and its citation.
 *
 * Folded by default because it is reference, not a question: nothing here asks or acts. The derivation is
 * `../../lib/alignmentGuidance.ts`; the read is `profile guidance --json` (`../live/readGuidance.ts`).
 */
import type { ReactElement } from "react";

import { type GuidanceView, guidanceByLevel, guidanceCountOf, guidanceItemsOf } from "../../lib/alignmentGuidance";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import { readGuidance } from "../live/readGuidance";
import { type LiveState, useLive } from "../live/useLive";

/** The live slug, as `../../lib/liveVerbsAlignment.ts` names it. */
const GUIDANCE_SLUG = "guidance";

/** What a mark says the reading is of. */
const SUBJECT = "your guidance";

/**
 * The page's one read of the owner's guidance, which the guidance section and every act card's sidebar share.
 *
 * @returns the live read
 */
export function useGuidance(): LiveState<GuidanceView> {
  return useLive<GuidanceView>({ read: readGuidance, slug: GUIDANCE_SLUG });
}

/**
 * The fold, or the read's spinner or staleness mark until it has read.
 *
 * @param state the page's guidance read
 * @returns the section
 */
export function AlignmentGuidance({ state }: { state: LiveState<GuidanceView> }): ReactElement {
  if (state.phase !== "ready") {
    return <ReadStandIn state={state} subject={SUBJECT} block />;
  }
  return (
    <>
      <ReadMark state={state} subject={SUBJECT} row />
      <GuidanceFold view={state.value} />
    </>
  );
}

/**
 * The closed fold over one reading.
 *
 * @param view the reading
 * @returns the fold
 */
export function GuidanceFold({ view }: { view: GuidanceView }): ReactElement {
  return (
    <details className="group mt-[0.6rem] mb-[0.2rem]" data-testid="guidance">
      <summary className="cursor-pointer text-[0.82rem] text-muted-foreground group-open:mb-[0.6rem]">
        {view.sources.map((source) => guidanceCountOf({ source })).join(" · ")}
      </summary>
      {guidanceByLevel({ view }).map((group) => (
        <section key={group.heading} className="mb-[0.6rem]">
          <h3 className="my-[0.3rem] text-[0.8rem] font-semibold">{group.heading}</h3>
          {group.sources.map((source) => (
            <div key={source.id} className="mb-[0.4rem]" data-guidance-source={source.id}>
              <p className="my-[0.2rem] text-[0.78rem]">{source.label}</p>
              <ul className="my-[0.2rem] list-disc pl-[1.1rem] text-[0.78rem]">
                {guidanceItemsOf({ source }).map((item) => {
                  if (item.kind === "entry") {
                    return (
                      <li key={`entry:${item.citation}:${item.text}`}>
                        {item.text} <code className="text-[0.72rem] text-muted-foreground">{item.citation}</code>
                      </li>
                    );
                  }
                  if (item.kind === "empty") {
                    return (
                      <li key="empty" className="text-muted-foreground">
                        empty
                      </li>
                    );
                  }
                  return (
                    <li key={`not-read:${item.why}`} className="text-muted-foreground">
                      not read: {item.why}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </details>
  );
}
