/**
 * The incident note form's EVIDENCE fields — `proof`, the receipts page the note opens first; `cites`, the links the
 * finding rests on. Split from `./form.ts` along that seam: these are what the owner is shown, and the rest of the form is
 * what the owner is asked. The screenshot that proves the finding is `./findingFields.ts`'s `shot`, required by a ruling.
 *
 * Pure: a parsed field in, the checked value or the refusal naming its field out.
 */
import { err, ok, type Result } from "../lib/result.js";
import { isValidPageSlug } from "../pages/url.js";

import { type IncidentFormInvalidError, IncidentNoteErrors } from "./errors.js";

/** The most evidence links the note carries — `cites`' own cap. */
const CITES_MAX = 8;

/** A Datadog host — every investigation's evidence includes one, or it read no telemetry at all. */
const DATADOG_HOST = /(?:^|\.)datadoghq\.(?:com|eu)$/u;

/**
 * The form's `proof`: the slug of the published receipts page.
 *
 * @param value whatever the form carried under `proof`
 * @returns the slug, or the refusal naming `proof`
 */
export function checkedProof({ value }: { value: unknown }): Result<string, IncidentFormInvalidError> {
  if (typeof value !== "string" || !isValidPageSlug({ slug: value })) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "proof",
        why: "is the slug of the receipts page published with `slopweaver page publish <slug> --page <file> --review <id>` — the note opens it first",
      }),
    );
  }
  return ok(value);
}

/**
 * The form's `cites`: https links, at most eight, at least one on Datadog, and a Datadog link first — the evidence
 * leads, a deploy or pull request after it.
 *
 * @param value whatever the form carried under `cites`
 * @returns the trimmed links, or the refusal naming `cites`
 */
export function checkedCites({ value }: { value: unknown }): Result<readonly string[], IncidentFormInvalidError> {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string")) {
    return err(IncidentNoteErrors.formInvalid({ field: "cites", why: "is a non-empty list of evidence links" }));
  }
  const cites = (value as readonly string[]).map((entry) => entry.trim());
  if (cites.length > CITES_MAX) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "cites",
        why: `carries ${String(cites.length)} links and the cap is ${String(CITES_MAX)}`,
      }),
    );
  }
  const hosts: string[] = [];
  for (const cite of cites) {
    const parsed = URL.canParse(cite) ? new URL(cite) : undefined;
    if (parsed?.protocol !== "https:") {
      return err(
        IncidentNoteErrors.formInvalid({ field: "cites", why: `carries "${cite}", which is not an https link` }),
      );
    }
    hosts.push(parsed.hostname);
  }
  if (!hosts.some((host) => DATADOG_HOST.test(host))) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "cites",
        why: "carries no Datadog link — the root cause and impact rest on telemetry, so cite where it was read",
      }),
    );
  }
  if (!DATADOG_HOST.test(hosts[0]!)) {
    return err(
      IncidentNoteErrors.formInvalid({
        field: "cites",
        why:
          `opens on "${cites[0]!}" — the evidence leads, so a Datadog link comes first and a deploy or pull request ` +
          "after it, since a pull request never leads in place of the discussion",
      }),
    );
  }
  return ok(cites);
}
