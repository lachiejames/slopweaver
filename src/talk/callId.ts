/**
 * What a call id is: a v4 UUID the console mints, which names its file under `talk/calls`. Its own module so the call
 * store and the quarantine ledger it consults can both check one without importing each other.
 */

/** Matches a v4 UUID and nothing else — the same shape a relay turn is held to (`./relayDraft.ts`). */
const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Whether a string is a call id this store will name a file after.
 *
 * @param callId the candidate
 * @returns whether it is a v4 UUID
 */
export function isCallId({ callId }: { callId: string }): boolean {
  return V4_UUID.test(callId);
}
