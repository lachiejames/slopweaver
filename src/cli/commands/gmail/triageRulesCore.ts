/**
 * PURE argument handling and rendering for `gmail triage-rules`. A malformed invocation is refused before the store
 * is opened, which is what lets the verb declare `parseRejectIsIoFree`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { GmailTriageRulesSnapshot } from "../../../live/gmail/triageRuleStore.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type GmailArgsError, GmailArgsErrors } from "./errors.js";
import { GMAIL_TRIAGE_RULES_USAGE } from "./triageRulesUsage.js";

/** A parsed `gmail triage-rules` invocation. */
export interface GmailTriageRulesArgs {
  readonly home: string | undefined;
  /** The document to replace the whole set with; undefined to list. */
  readonly set: string | undefined;
  readonly json: boolean;
}

/**
 * Parse the `gmail triage-rules` tail.
 *
 * @param rest the argv tail after `gmail triage-rules`
 * @returns the validated request, or the one reason it was refused
 */
export function parseGmailTriageRulesArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GmailTriageRulesArgs, GmailArgsError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "set"] } });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: GMAIL_TRIAGE_RULES_USAGE }));
  }
  const { values, flags } = parsed.value;
  const set = values["set"];
  if (set?.trim() === "") {
    return err(GmailArgsErrors.flagsInvalid({ reasons: ["--set needs a path"], usage: GMAIL_TRIAGE_RULES_USAGE }));
  }
  return ok({ home: values["home"], json: flags.has("json"), set });
}

/**
 * How many choices the policy declares across all four arrays. Pure.
 *
 * @param snapshot the policy as read
 * @returns the total; zero is an install that declared nothing
 */
export function declaredChoiceCount({ snapshot }: { snapshot: GmailTriageRulesSnapshot }): number {
  return (
    snapshot.rules.length + snapshot.structuralRules.length + snapshot.delegates.length + snapshot.gatedRules.length
  );
}

/** One section of the text rendering: its heading, then one indented line per entry, or nothing when it is empty. */
function section({ heading, lines }: { heading: string; lines: readonly string[] }): readonly string[] {
  return lines.length === 0 ? [] : [heading, ...lines.map((line) => `  ${line}`)];
}

/**
 * Render the policy as read, one line per entry in text, or under `--json` `{ document, revision }`, where
 * `document` is exactly what a `--set` file declares, so a writer edits what it read and hands it back whole. Pure.
 *
 * @param snapshot the policy and the revision it stands at
 * @param json whether to emit the machine-readable document
 * @returns the output
 */
export function renderGmailTriageRules({
  snapshot,
  json,
}: {
  snapshot: GmailTriageRulesSnapshot;
  json: boolean;
}): string {
  if (json) {
    return safeJsonStringify({
      label: "gmail triage-rules",
      space: 2,
      value: {
        document: {
          delegates: snapshot.delegates,
          gatedRules: snapshot.gatedRules,
          rules: snapshot.rules,
          schemaVersion: 2,
          structuralRules: snapshot.structuralRules,
        },
        revision: snapshot.revision,
      },
    });
  }
  const head =
    snapshot.revision === null
      ? "this install declares no gmail triage policy (the store holds none): every group is carded"
      : `${String(declaredChoiceCount({ snapshot }))} gmail triage choice(s), store revision ${String(snapshot.revision)}`;
  const senderLines = snapshot.rules.map((rule) => {
    const subject = rule.subjectIncludes === undefined ? "" : ` (subject has "${rule.subjectIncludes}")`;
    return `${rule.key}${subject} — ${rule.why} [${rule.anchor}]`;
  });
  const kindLines = ({
    entries,
  }: {
    entries: readonly { kind: string; why: string; anchor: string; key?: string }[];
  }): readonly string[] =>
    entries.map((entry) => {
      const key = entry.key === undefined ? "" : ` ${entry.key}`;
      return `${entry.kind}${key} — ${entry.why} [${entry.anchor}]`;
    });
  return [
    head,
    ...section({ heading: "sender rows (archived unasked):", lines: senderLines }),
    ...section({ heading: "structural rules:", lines: kindLines({ entries: snapshot.structuralRules }) }),
    ...section({ heading: "delegates:", lines: kindLines({ entries: snapshot.delegates }) }),
    ...section({ heading: "gated rules (a seat checks first):", lines: kindLines({ entries: snapshot.gatedRules }) }),
  ].join("\n");
}
