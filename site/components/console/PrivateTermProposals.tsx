"use client";

/**
 * The private words a Queue card asks the owner to confirm, drawn on that card under its problem, one item each with
 * its own Yes and No.
 *
 * The words are read from the owner's own machine when the card opens (`./usePrivateTermProposals.ts`) and held only
 * in this component's state. They are not in the card's row, so no voice reading, recorded reading or transcript reads
 * them. A press records the owner's answer beside the proposal and nothing else (`../../lib/actVerbsPrivateTerms.ts`);
 * its one slot is the proposal's id. The fleet then lands each yes; a no is never landed.
 */
import { type ReactElement, useState } from "react";

import { PRIVATE_TERM_ANSWER_SLUGS } from "../../lib/actVerbsPrivateTerms";
import type { PrivateTermProposalItem, PrivateTermProposalUnavailable } from "../../lib/privateTermProposal";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Outcome, usePress } from "./press";
import { usePrivateTermProposals } from "./usePrivateTermProposals";

/** What each closed reason means to the owner. No reason carries a word. */
const UNAVAILABLE_WORDS: Readonly<Record<PrivateTermProposalUnavailable, string>> = {
  "current-changed": "the private words list changed since this was proposed, so the fleet proposes it again",
  linked: "its file is a link, so it is not read",
  malformed: "its file does not read as a proposal",
  "not-waiting": "it is not waiting any more: it was confirmed already, or it was never made on this machine",
  "not-one-row": "its new list changes more than the one word it names, so it is not shown",
  unreadable: "its file could not be read",
};

/** What each edit does to the list, in the owner's words. */
const ACTION_WORDS = { add: "Keep private", narrow: "Change", remove: "Stop keeping private" } as const;

/** One drawn item, with its own press. */
function ProposalItem({
  item,
  onAnswered,
}: {
  item: Extract<PrivateTermProposalItem, { kind: "shown" }>;
  onAnswered: () => void;
}): ReactElement {
  const { press, state } = usePress();
  const answer = ({ word }: { word: "yes" | "no" }): void => {
    void press({
      readsSlug: "board",
      slots: { proposal: item.proposalId },
      slug: PRIVATE_TERM_ANSWER_SLUGS[word],
    }).then(onAnswered);
  };
  let answered = "not answered yet";
  let answerMark = "none";
  if (item.answer !== null) {
    answered = `you said ${item.answer}`;
    answerMark = item.answer;
  }
  let meaning = "not recorded";
  if (item.meaning !== null) {
    meaning = item.meaning;
  }
  let allowedWhere = "nowhere";
  if (item.allowedWhere !== null) {
    allowedWhere = item.allowedWhere;
  }
  return (
    <li className="grid gap-[0.3rem]" data-private-term-proposal={item.proposalId}>
      <div>
        {ACTION_WORDS[item.action]} <code className="font-semibold">{item.pattern}</code>{" "}
        <span className="text-muted-foreground">
          ({item.className}, {item.caseInsensitive ? "any case" : "this case only"})
        </span>
      </div>
      <div className="text-[0.84rem] text-muted-foreground">
        means: {meaning}; fine in: {allowedWhere}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={state.phase === "sending"}
          onClick={() => {
            answer({ word: "yes" });
          }}
        >
          Yes
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={state.phase === "sending"}
          onClick={() => {
            answer({ word: "no" });
          }}
        >
          No
        </Button>
        <span className="text-[0.82rem] text-muted-foreground" data-private-term-answer={answerMark}>
          {answered}
        </span>
      </div>
      <Outcome state={state} />
    </li>
  );
}

/** One item that is not drawn, with the reason in the owner's words. */
function UnavailableItem({ item }: { item: Extract<PrivateTermProposalItem, { kind: "unavailable" }> }): ReactElement {
  return (
    <li className="text-[0.84rem] text-muted-foreground" data-private-term-proposal={item.proposalId}>
      {item.proposalId}: {UNAVAILABLE_WORDS[item.reason]}
    </li>
  );
}

/**
 * The private words a card names, as the `<dt>`/`<dd>` pair it brings to the card's own list.
 *
 * @param ids the proposal ids the card names, in order; the caller draws nothing when there are none
 * @returns the pair
 */
export function PrivateTermProposals({ ids }: { ids: readonly string[] }): ReactElement {
  const [generation, setGeneration] = useState(0);
  const reading = usePrivateTermProposals({ generation, ids });
  const reread = (): void => {
    setGeneration((was) => was + 1);
  };
  let body: ReactElement;
  if (reading.phase === "loading") {
    body = <Spinner label="the words, from this machine" size="sm" />;
  } else if (reading.phase === "not-read") {
    body = (
      <span className="text-muted-foreground">
        the words did not read from this machine; reopen the card to try again
      </span>
    );
  } else {
    body = (
      <ol className="m-0 grid list-decimal gap-[0.7rem] pl-[1.2rem]">
        {reading.items.map((item) =>
          item.kind === "shown" ? (
            <ProposalItem key={item.proposalId} item={item} onAnswered={reread} />
          ) : (
            <UnavailableItem key={item.proposalId} item={item} />
          ),
        )}
      </ol>
    );
  }
  return (
    <>
      <dt>words</dt>
      <dd data-private-term-proposals="">{body}</dd>
    </>
  );
}
