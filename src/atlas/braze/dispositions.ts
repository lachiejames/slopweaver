/**
 * What this atlas may do with each Braze operation, decided per operation and never per family.
 *
 * `docs/atlas-intent/06-holdings.md` is the authority. The criterion is not a list of families to skip: a family's
 * records are voluminous when they are **time-series OBSERVATIONS** — emitted by the platform, unbounded,
 * growing with the clock, identified by an INSTANT rather than by a name somebody chose. Configuration is the
 * complement: what a person or a system CREATED, listable exhaustively.
 *
 * ## The method is not the criterion, and on this platform that is not a nuance
 *
 * Braze answers several of its largest READS with `POST`, because their selectors — a list of external ids, a
 * segment, a control group — do not fit in a query string. `POST /users/export/ids` reads; `POST /users/track`
 * writes. A rule keyed on the verb would class both as mutations and would silently drop the export half of
 * the surface, which is the half a question about a real user is answered from. So the read-shaped POSTs are
 * matched by NAME, before the mutation rule ever sees them, and each carries its own rule id so a reader can
 * see the judgement rather than infer it.
 *
 * ## Rules are ORDERED and first-match-wins
 *
 * The ordering is the whole content of several of them. {@link BRAZE_DISPOSITION_RULES} is exported so
 * `sync.ts` can report a rule that matched nothing — a dead rule reads as considered judgement and is not one.
 */
import type { BrazeDisposition } from "./model.js";
import { brazePathKey } from "./pathKey.js";

/** One reviewed rule: how it matches, what it decides, and why in English. */
interface BrazeDispositionRule {
  readonly id: string;
  readonly disposition: BrazeDisposition;
  readonly reason: string;
  readonly matches: (input: { method: string; key: string }) => boolean;
}

/** The population exports: one call streams every user in a segment or control group. */
const POPULATION_EXPORTS = new Set(["/users/export/segment", "/users/export/global_control_group"]);

/**
 * Deliverability registers the platform appends to as messages fail.
 *
 * Each row is stamped with when it happened and nobody named it, so they are observations by the criterion
 * even though a workspace's list of them is not unbounded the way an analytics series is.
 */
const DELIVERABILITY_STREAMS = new Set(["/email/hard_bounces", "/email/unsubscribes", "/sms/invalid_phone_numbers"]);

/** Methods that change something on the platform. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Every disposition rule, in the order they are applied.
 *
 * @internal
 */
export const BRAZE_DISPOSITION_RULES: readonly BrazeDispositionRule[] = [
  {
    disposition: "reachable",
    id: "read-post-user-export-ids",
    matches: ({ method, key }) => method === "POST" && key === "/users/export/ids",
    reason:
      "a READ that Braze answers with POST because its selector is a list of external ids. It addresses rows " +
      "somebody names rather than streaming a population, so it is ordinary configuration-shaped access and " +
      "must not be swept up by the mutation rule below",
  },
  {
    disposition: "voluminous",
    id: "voluminous-user-population-export",
    matches: ({ method, key }) => method === "POST" && POPULATION_EXPORTS.has(key),
    reason:
      "one call streams every user profile in a segment or control group — unbounded, growing with the " +
      "workspace, and never a set somebody enumerated. Enumerated and declared here; its rows are never " +
      "stored whole",
  },
  {
    disposition: "voluminous",
    id: "voluminous-analytics-series",
    matches: ({ key }) => /(?:\/data_series|\/data_summary|_series)$/.test(key),
    reason:
      "a daily or windowed series of engagement counts emitted by the platform and identified by an instant. " +
      "This is the engagement event stream: its existence is atlas content, its every row is not",
  },
  {
    disposition: "voluminous",
    id: "voluminous-deliverability-stream",
    matches: ({ key }) => DELIVERABILITY_STREAMS.has(key),
    reason:
      "a register the platform appends to as messages bounce, unsubscribe or fail to reach a handset. Each " +
      "row is stamped with when it happened and nobody named it, so it is an observation rather than " +
      "configuration",
  },
  {
    disposition: "excluded",
    id: "excluded-mutation",
    matches: ({ method }) => MUTATING_METHODS.has(method),
    reason:
      "it changes something on the platform, and this atlas calls no mutation ever. It is still RECORDED, " +
      "because an atlas that omitted it would answer that Braze offers no way to do this, which is false",
  },
  {
    disposition: "reachable",
    id: "reachable-configuration",
    matches: () => true,
    reason:
      "configuration somebody authored — a campaign, canvas, segment, catalogue, template, content block, " +
      "preference centre, data-object type or subscription group — listable exhaustively and safe to read " +
      "once a credential exists",
  },
];

/**
 * What one operation was classed as, and by which rule.
 *
 * @internal
 */
export interface BrazeDispositionVerdict {
  readonly disposition: BrazeDisposition;
  readonly reason: string;
  readonly ruleId: string;
}

/** The rule that matches anything the others did not. Named so the fallback below is not a magic string. */
const CATCH_ALL_RULE_ID = "reachable-configuration";

/**
 * Class one operation.
 *
 * @param method the HTTP method, in any case
 * @param path the path exactly as a published source wrote it
 * @returns the disposition, the rule that decided it, and its reason
 */
export function brazeDispositionFor({ method, path }: { method: string; path: string }): BrazeDispositionVerdict {
  const upper = method.toUpperCase();
  const key = brazePathKey({ path });
  for (const rule of BRAZE_DISPOSITION_RULES) {
    if (rule.matches({ key, method: upper })) {
      return { disposition: rule.disposition, reason: rule.reason, ruleId: rule.id };
    }
  }
  // Unreachable while the last rule matches everything; kept total rather than asserted non-null.
  return { disposition: "reachable", reason: "no reviewed rule matched", ruleId: CATCH_ALL_RULE_ID };
}

/**
 * Every reviewed rule's id, so a sync can report one that matched nothing.
 *
 * @returns the rule ids, in application order
 */
export function brazeDispositionRuleIds(): readonly string[] {
  return BRAZE_DISPOSITION_RULES.map((rule) => rule.id);
}
