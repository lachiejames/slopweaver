/**
 * The home-wide policy every write transport's privacy guard judges under (`./privacyCheck.ts`): the private terms,
 * the private denylist and the committed forbidden-identifier rules, read from ONE explicit state home.
 *
 * Fail-closed, and read afresh on every write by each caller: the private-terms file refuses when absent,
 * unreadable, readable by others or malformed (`../hygiene/privateTerms.ts`), and an unreadable denylist refuses
 * too; an absent denylist is normal. A transport that cached this answer would keep sending after the file was
 * deleted or broken, so no caller does.
 */
import { FORBIDDEN_IDENTIFIER_RULES } from "../hygiene/forbiddenIdentifiers.js";
import { printableUnderTerms, privateTermsOrRefusal } from "../hygiene/privateTerms.js";
import { loadDenylistResult, unreadableDenylistMessage } from "../hygiene/scan.js";
import { err, ok, type Result } from "../lib/result.js";
import type { PrivacyPolicy } from "./privacyCheck.js";

/**
 * Read the write policy from one home, or the sentence every write is refused with when it cannot be relied on.
 *
 * @param home the state home the verb resolved, never an ambient one
 * @returns the policy, or the refusal sentence
 */
export function loadWritePrivacyPolicy({ home }: { home: string }): Result<PrivacyPolicy, string> {
  const privateTerms = privateTermsOrRefusal({ home });
  if (privateTerms.isErr()) {
    return err(privateTerms.error);
  }
  const denylist = loadDenylistResult({ home });
  if (denylist.kind === "unreadable") {
    // The terms DID load, so the sentence (which names the denylist's path) is judged against them here: a caller
    // renders a policy refusal with no terms, since in every other refusal they never loaded.
    return err(printableUnderTerms({ line: unreadableDenylistMessage({ load: denylist }), terms: privateTerms.value }));
  }
  const lines = denylist.kind === "loaded" ? denylist.lines : [];
  return ok({ denylist: lines, identifierRules: FORBIDDEN_IDENTIFIER_RULES, privateTerms: privateTerms.value });
}
