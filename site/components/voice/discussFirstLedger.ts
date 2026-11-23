/**
 * The call's discuss-first ledger: for each team repository this call has put "did you actually discuss this first?"
 * for, the relay that put it (`../../lib/discussFirst.ts`). It is what keeps the question to once a call per
 * repository. A reconnect or a quiet rollover is the same call and keeps it; only a fresh call empties it
 * (`./VoiceProvider.tsx`). Split from that file, which sits at its 300-line cap.
 */
import type { PriorDiscussFirst } from "../../lib/discussFirst";
import type { TalkRelayWire } from "../../lib/talkRelayRequestWire";
import type { RelayHandOffSeams } from "./relayAttempt";

/** The relay seams' ledger, and the reset a fresh call makes. */
export type DiscussFirstLedger = RelayHandOffSeams["discussFirst"] & { readonly reset: () => void };

/**
 * A ledger with nothing put yet.
 *
 * @returns the ledger
 */
export function discussFirstLedger(): DiscussFirstLedger {
  const asked = new Map<string, PriorDiscussFirst>();
  const unlanded = new Map<string, TalkRelayWire>();
  return {
    claim: ({ prior, repository }) => {
      asked.set(repository, prior);
    },
    holdReplay: ({ repository, wire }) => {
      unlanded.set(repository, wire);
    },
    prior: ({ repository }) => asked.get(repository),
    reset: () => {
      asked.clear();
      unlanded.clear();
    },
    takeReplay: ({ repository }) => {
      const wire = unlanded.get(repository);
      unlanded.delete(repository);
      return wire;
    },
  };
}
