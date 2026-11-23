/**
 * The PURE core of `slopweaver write vanta create-document|upload-evidence|submit-document`: flag parsing
 * for each of the three additive document writes. No fs, no clock, no network — {@link ./documentRun} does
 * every read, write, credential resolution and door routing, and {@link ./documentReport} renders what is
 * printed either side of one.
 *
 * ## Why the three verbs are flat rather than `document create`
 *
 * They are flat because `writePreview.ts` already names them flat — `create-document`, `upload-evidence`,
 * `submit-document` are its own request kinds — and a verb whose spelling differs from the preview kind it
 * resolves is one rename away from resolving the wrong request.
 *
 * ## What this surface deliberately cannot do
 *
 * The Manage API surface this package holds has NO update-an-existing-document call. Title, description,
 * cadence, reminder window, time sensitivity and sensitivity are settable at CREATE only, and there is no
 * door here that edits them afterwards. That is why every one of these writes goes through an approval
 * digest: a typo in a document title is not correctable through this door.
 *
 * `deleteUpload` and `deleteDocument` exist in `writeClient.ts` and are reached by NO verb. That is the
 * standing decision `writePreview.ts`'s header records — destructive writes have no preview here or
 * anywhere, and a destructive verb whose `--dry-run` cannot show what it would remove is not a verb this
 * program ships.
 */
import {
  vantaDocumentCadenceSchema,
  vantaDocumentReminderWindowSchema,
  vantaDocumentTimeSensitivitySchema,
} from "../../../atlas/vanta/writeApiSchemas.js";
import type { VantaCreateDocumentInput, VantaUploadEvidenceInput } from "../../../atlas/vanta/writeClient.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValue, flagValueOr, type ParsedFlagTail, parseFlagTail } from "../../optionParsers.js";
import { type VantaCredentialFlags, vantaCredentialFlags } from "./vulnerabilityCore.js";

/**
 * What every document verb carries regardless of which write it is.
 *
 * @internal
 */
export interface VantaDocumentBaseOptions extends VantaCredentialFlags {
  readonly home: string;
  readonly json: boolean;
  readonly dryRun: boolean;
  /** The digest passed to `--approve`, or `null` when the caller approved nothing — the door decides. */
  readonly approve: string | null;
}

/**
 * A validated invocation of one of the three additive document writes.
 *
 * @internal
 */
export type VantaDocumentOptions =
  | {
      readonly base: VantaDocumentBaseOptions;
      readonly write: { readonly kind: "create-document"; readonly input: VantaCreateDocumentInput };
    }
  | {
      readonly base: VantaDocumentBaseOptions;
      readonly write: {
        readonly kind: "upload-evidence";
        readonly input: Omit<VantaUploadEvidenceInput, "file"> & { readonly filePath: string };
      };
    }
  | {
      readonly base: VantaDocumentBaseOptions;
      readonly write: { readonly kind: "submit-document"; readonly input: { readonly documentId: string } };
    };

/**
 * Every flag each document verb accepts, keyed by verb. Exported so the verb-flag ratchet can probe the
 * REAL parser with each one rather than compare two declarations.
 *
 * @internal
 */
export const VANTA_DOCUMENT_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = {
  "create-document": [
    "--approve",
    "--cadence",
    "--client-id-file",
    "--client-secret-file",
    "--description",
    "--dry-run",
    "--home",
    "--json",
    "--reminder-window",
    "--sensitive",
    "--time-sensitivity",
    "--title",
  ],
  "submit-document": [
    "--approve",
    "--client-id-file",
    "--client-secret-file",
    "--document",
    "--dry-run",
    "--home",
    "--json",
  ],
  "upload-evidence": [
    "--approve",
    "--client-id-file",
    "--client-secret-file",
    "--description",
    "--document",
    "--dry-run",
    "--effective-at",
    "--file",
    "--home",
    "--json",
  ],
};

/** The default review cadence when the caller names none: annual, Vanta's own commonest evidence cycle. */
export const VANTA_DEFAULT_CADENCE = "P1Y";

/** The default reminder window when the caller names none. */
export const VANTA_DEFAULT_REMINDER_WINDOW = "P1M";

/** The default time sensitivity when the caller names none. */
export const VANTA_DEFAULT_TIME_SENSITIVITY = "MOST_RECENT";

/** Read the base options off an already-parsed tail. */
function baseOptions({ tail, defaultHome }: { tail: ParsedFlagTail; defaultHome: string }): VantaDocumentBaseOptions {
  return {
    ...vantaCredentialFlags({ parsed: tail }),
    approve: flagValue({ name: "approve", parsed: tail }),
    dryRun: tail.flags.has("dry-run"),
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: tail }),
    json: tail.flags.has("json"),
  };
}

/**
 * Grade one enum-valued flag against Vanta's own accepted values, accumulating rather than throwing.
 *
 * Typed off the SCHEMA's own parse result rather than asserting the raw string, so the accepted set and the
 * returned type can never come apart: adding a value to Vanta's enum widens both at once.
 */
function parseEnumFlag<TValue extends string>({
  raw,
  label,
  fallback,
  schema,
  errors,
}: {
  raw: string | undefined;
  label: string;
  fallback: TValue;
  schema: {
    options: readonly string[];
    safeParse: (input: unknown) => { success: true; data: TValue } | { success: false };
  };
  errors: string[];
}): TValue {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    errors.push(`${label} must be one of ${schema.options.join(", ")} (got ${raw})`);
    return fallback;
  }
  return parsed.data;
}

/** Require a non-empty value for a flag, accumulating a refusal rather than returning a plausible blank. */
function requireFlag({
  raw,
  label,
  what,
  errors,
}: {
  raw: string | undefined;
  label: string;
  what: string;
  errors: string[];
}): string | undefined {
  const value = raw?.trim();
  if (value === undefined || value === "") {
    errors.push(`${label} ${what}`);
    return undefined;
  }
  return value;
}

/** Every flag `create-document` parses, split into the two shapes `parseFlagTail` takes. */
const CREATE_DOCUMENT_SPEC = {
  boolean: ["json", "dry-run", "sensitive"],
  value: [
    "home",
    "approve",
    "title",
    "description",
    "cadence",
    "reminder-window",
    "time-sensitivity",
    "client-id-file",
    "client-secret-file",
  ],
} as const;

/** The three review-schedule enums, each defaulted rather than demanded, so the common invocation is short. */
function documentSchedule({
  values,
  errors,
}: {
  values: Readonly<Record<string, string>>;
  errors: string[];
}): Pick<VantaCreateDocumentInput, "cadence" | "reminderWindow" | "timeSensitivity"> {
  return {
    cadence: parseEnumFlag({
      errors,
      fallback: VANTA_DEFAULT_CADENCE,
      label: "--cadence",
      raw: values["cadence"],
      schema: vantaDocumentCadenceSchema,
    }),
    reminderWindow: parseEnumFlag({
      errors,
      fallback: VANTA_DEFAULT_REMINDER_WINDOW,
      label: "--reminder-window",
      raw: values["reminder-window"],
      schema: vantaDocumentReminderWindowSchema,
    }),
    timeSensitivity: parseEnumFlag({
      errors,
      fallback: VANTA_DEFAULT_TIME_SENSITIVITY,
      label: "--time-sensitivity",
      raw: values["time-sensitivity"],
      schema: vantaDocumentTimeSensitivitySchema,
    }),
  };
}

/**
 * Parse the tail of `write vanta create-document`.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseVantaCreateDocumentOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<VantaDocumentOptions> {
  const parsed = parseFlagTail({ rest, spec: CREATE_DOCUMENT_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const schedule = documentSchedule({ errors, values });
  const title = requireFlag({
    errors,
    label: "--title",
    raw: values["title"],
    what: "names the document — it cannot be changed afterwards through this API surface",
  });
  const description = requireFlag({
    errors,
    label: "--description",
    raw: values["description"],
    what: "says what the document is evidence OF — it cannot be changed afterwards through this API surface",
  });
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    base: baseOptions({ defaultHome, tail: parsed.value }),
    write: {
      // Spelled field by field rather than spread, so the key ORDER matches what `writeClient.ts` serialises
      // — a `--dry-run` that reorders the body is showing a description of the request, not the request.
      input: {
        cadence: schedule.cadence,
        // Non-null after the `errors` guard above: `requireFlag` pushed a refusal for anything absent.
        description: description!,
        isSensitive: flags.has("sensitive"),
        reminderWindow: schedule.reminderWindow,
        timeSensitivity: schedule.timeSensitivity,
        title: title!,
      },
      kind: "create-document",
    },
  });
}

/**
 * Parse the tail of `write vanta upload-evidence`.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseVantaUploadEvidenceOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<VantaDocumentOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: {
      boolean: ["json", "dry-run"],
      value: [
        "home",
        "approve",
        "document",
        "file",
        "description",
        "effective-at",
        "client-id-file",
        "client-secret-file",
      ],
    },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const documentId = requireFlag({
    errors,
    label: "--document",
    raw: values["document"],
    what: "names the document this evidence attaches to",
  });
  const filePath = requireFlag({ errors, label: "--file", raw: values["file"], what: "names the file to upload" });
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    base: baseOptions({ defaultHome, tail: parsed.value }),
    write: {
      input: {
        description: flagValue({ name: "description", parsed: parsed.value }),
        // Non-null after the `errors` guard above: `requireFlag` pushed a refusal for anything absent.
        documentId: documentId!,
        effectiveAtDate: flagValue({ name: "effective-at", parsed: parsed.value }),
        filePath: filePath!,
      },
      kind: "upload-evidence",
    },
  });
}

/**
 * Parse the tail of `write vanta submit-document`.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseVantaSubmitDocumentOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<VantaDocumentOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: {
      boolean: ["json", "dry-run"],
      value: ["home", "approve", "document", "client-id-file", "client-secret-file"],
    },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const documentId = requireFlag({
    errors,
    label: "--document",
    raw: values["document"],
    what: "names the document to submit for review",
  });
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    base: baseOptions({ defaultHome, tail: parsed.value }),
    // Non-null after the `errors` guard above: `requireFlag` pushed a refusal for anything absent.
    write: { input: { documentId: documentId! }, kind: "submit-document" },
  });
}
