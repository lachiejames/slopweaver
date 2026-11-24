"use client";

/*
 * The private-word proposals one open Queue card names, read through `app/api/private-term-proposals` off the owner's
 * own store when the card opens, and again after each Yes or No pressed on it. Nothing polls and nothing is kept
 * outside this hook's state: no module cache, no browser cache, no saved reading. The words exist only while the
 * card that shows them is open. A failed read is said as one fixed sentence and never drawn over an earlier one.
 */

import { useEffect, useState } from "react";
import { CONSOLE_READ_HEADER, CONSOLE_READ_VALUE } from "../../lib/consoleRead";
import { type PrivateTermProposalItem, privateTermProposalsAnswerOf } from "../../lib/privateTermProposal";
import { PRIVATE_TERM_PROPOSAL_PARAM, privateTermProposalQuery } from "../../lib/privateTermProposalIds";

/** The card's view of one read. */
export type PrivateTermProposalsState =
  | { readonly phase: "loading" }
  | { readonly phase: "not-read" }
  | { readonly phase: "ready"; readonly items: readonly PrivateTermProposalItem[] };

/**
 * Read the asked proposals, once per distinct `ids` and `generation`.
 *
 * @param ids the proposal ids the card names, in order; never empty when the card asks
 * @param generation bumped by the card after a press, so the answer just recorded is read back
 * @returns the read as it stands
 */
export function usePrivateTermProposals({
  ids,
  generation,
}: {
  ids: readonly string[];
  generation: number;
}): PrivateTermProposalsState {
  const query = privateTermProposalQuery({ ids });
  const key = `${query}#${String(generation)}`;
  const [reading, setReading] = useState<{ readonly key: string; readonly state: PrivateTermProposalsState }>({
    key,
    state: { phase: "loading" },
  });
  useEffect(() => {
    const control = new AbortController();
    const expectedIds = new URLSearchParams(query).getAll(PRIVATE_TERM_PROPOSAL_PARAM);
    const read = async (): Promise<void> => {
      let next: PrivateTermProposalsState = { phase: "not-read" };
      try {
        const response = await fetch(`/api/private-term-proposals?${query}`, {
          cache: "no-store",
          headers: { [CONSOLE_READ_HEADER]: CONSOLE_READ_VALUE },
          signal: control.signal,
        });
        const items = privateTermProposalsAnswerOf({ body: await response.json(), expectedIds });
        if (items !== undefined) {
          next = { items, phase: "ready" };
        }
      } catch {
        next = { phase: "not-read" };
      }
      if (!control.signal.aborted) {
        setReading({ key, state: next });
      }
    };
    void read();
    return () => {
      control.abort();
    };
  }, [key, query]);
  // A re-read after a press keeps the items it already drew until it lands, so each item's own outcome line stays
  // in place. A read of different ids starts from loading: those words were never drawn here.
  const sameIds = reading.key.startsWith(`${query}#`);
  if (reading.key !== key && !(sameIds && reading.state.phase === "ready")) {
    return { phase: "loading" };
  }
  return reading.state;
}
