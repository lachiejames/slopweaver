/**
 * A Calendar write privacy capability with a declared-empty policy: no private terms, no denylist, the committed
 * identifier rules. For a test of something else that constructs a real Calendar write API; a test of the guard
 * itself builds `calendarWritePrivacy({ home })` over a throwaway home instead.
 */
import { FORBIDDEN_IDENTIFIER_RULES } from "../hygiene/forbiddenIdentifiers.js";
import { ok } from "../lib/result.js";
import type { CalendarWritePrivacy } from "../outbound/calendar/writePrivacy.js";

/** Judges every mutation under a policy that declares no private term and no denylisted word. */
export const NO_TERMS_CALENDAR_PRIVACY: CalendarWritePrivacy = {
  resolve: () => Promise.resolve(ok({ denylist: [], identifierRules: FORBIDDEN_IDENTIFIER_RULES, privateTerms: [] })),
};
