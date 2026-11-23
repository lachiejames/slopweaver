/**
 * This install's whole `gmail triage` mail policy, held as the `gmail-triage-rules` row of the store's
 * `singleton_register` (`src/store/singletonRegister.ts`).
 *
 * The repository ships no rows at all (`./triageRules.ts` holds only the shapes and the matcher): which mail one
 * owner archives, holds out or hands to a provider verb is that install's ruling about its own mailbox, so it lives
 * in the install's store, never in git.
 *
 * The document is schema version 2:
 * `{ "schemaVersion": 2, "rules": [...], "structuralRules": [...], "delegates": [...], "gatedRules": [...] }`.
 * `rules` are sender rows — a `from:` row (optional `subjectIncludes`) or a `relay:` row (required
 * `subjectIncludes`), each with a non-empty `sender`, `anchor` and `why`. The other three arrays are the shapes
 * `./triageRules.ts` declares, each entry carrying a non-empty `anchor` and `why`, at most one per kind. Every array
 * is required: a missing one is refused rather than read as off, because an absence that silently changed what is
 * archived is the defect this register exists to prevent. Version 1 (`rules` only) is still read, and reads as
 * exactly that — sender rows, and nothing else switched on; a write is always version 2.
 *
 * No row means the install declared nothing, and the triage rules nothing. A stored document that is not one of
 * those shapes is REFUSED rather than read as empty: a rule set that silently stopped applying would put the owner's
 * already-ruled mail back in front of them as cards. A sender key named twice, or a kind declared twice, is refused
 * too — two entries for one key would leave which one applies to the order of a list.
 *
 * ## The retired file
 *
 * `$SLOPWEAVER_HOME/gmail-triage-rules.json` was the authority before the store. A read finding no row imports it
 * ONCE; from then on the row is the authority and the file is inert, and every read that still finds it says so
 * ({@link GmailTriageRulesSnapshot}'s `inertFile`), because an edit to a file nothing reads is a ruling silently
 * lost. `slopweaver gmail triage-rules --set <path>` is the writer.
 */
import { z } from "zod";

import { parseJson } from "../../lib/jsonParse.js";
import { readStrictFileIfPresent } from "../../lib/presentFile.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  productionSingletonRegisterSeams,
  type SingletonRegisterOperations,
  type SingletonRegisterSeams,
  singletonRegister,
} from "../../store/singletonRegister.js";
import {
  type GmailTriageRulesError,
  GmailTriageRulesErrors,
  type GmailTriageRulesMalformedError,
  STORED_RULES_SOURCE,
} from "./triageRuleErrors.js";
import {
  EMPTY_TRIAGE_POLICY,
  type GmailTriageArchiveRule,
  type GmailTriageDelegate,
  type GmailTriageGatedRule,
  type GmailTriagePolicy,
  type GmailTriageStructuralRule,
} from "./triageRules.js";

/** A string carrying at least one non-space character, kept exactly as written — a subject phrase is matched raw. */
function nonBlank({ field }: { field: string }): z.ZodString {
  return z.string().refine((text) => text.trim().length > 0, `${field} must be a non-empty string`);
}

const fromRowSchema = z.strictObject({
  anchor: nonBlank({ field: "anchor" }),
  key: z.templateLiteral(["from:", z.string()]).refine((key) => key.length > "from:".length, "key names no address"),
  kind: z.literal("from"),
  sender: nonBlank({ field: "sender" }),
  subjectIncludes: nonBlank({ field: "subjectIncludes" }).exactOptional(),
  why: nonBlank({ field: "why" }),
});

const relayRowSchema = z.strictObject({
  anchor: nonBlank({ field: "anchor" }),
  key: z.templateLiteral(["relay:", z.string()]).refine((key) => key.length > "relay:".length, "key names no relay"),
  kind: z.literal("relay"),
  sender: nonBlank({ field: "sender" }),
  subjectIncludes: nonBlank({ field: "subjectIncludes" }),
  why: nonBlank({ field: "why" }),
});

/** One Zod issue as `<dotted path>: <message>`, the root spelled out rather than left blank. */
function issueLine({ issue }: { issue: z.core.$ZodIssue }): string {
  const where = issue.path.length === 0 ? "(root)" : issue.path.map((segment) => String(segment)).join(".");
  return `${where}: ${issue.message}`;
}

const senderRowsSchema = z.array(z.discriminatedUnion("kind", [fromRowSchema, relayRowSchema]));

/** A choice entry of one of the given kinds, carrying its anchor and reason. */
function choiceSchema<const Kinds extends readonly [string, ...string[]]>({ kinds }: { kinds: Kinds }) {
  return z.strictObject({
    anchor: nonBlank({ field: "anchor" }),
    kind: z.enum(kinds),
    why: nonBlank({ field: "why" }),
  });
}

const structuralRuleSchema = choiceSchema({ kinds: ["last-reply", "passed-invite"] });
const delegateSchema = choiceSchema({ kinds: ["fathom-clear-inbox", "gmail-clear-meeting-notes", "spend-tasks"] });
const gatedRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    anchor: nonBlank({ field: "anchor" }),
    key: z.templateLiteral(["from:", z.string()]).refine((key) => key.length > "from:".length, "key names no address"),
    kind: z.literal("provider-integration-not-installed"),
    why: nonBlank({ field: "why" }),
  }),
  z.strictObject({
    anchor: nonBlank({ field: "anchor" }),
    kind: z.literal("calendar-invite-responded"),
    why: nonBlank({ field: "why" }),
  }),
]);

const ruleFileSchema = z.discriminatedUnion("schemaVersion", [
  z.strictObject({ rules: senderRowsSchema, schemaVersion: z.literal(1) }),
  z.strictObject({
    delegates: z.array(delegateSchema),
    gatedRules: z.array(gatedRuleSchema),
    rules: senderRowsSchema,
    schemaVersion: z.literal(2),
    structuralRules: z.array(structuralRuleSchema),
  }),
]);

/** The install's policy document, as stored and as a `--set` file declares it — always read up to version 2. */
export interface GmailTriageRulesDocument extends GmailTriagePolicy {
  readonly schemaVersion: 2;
}

/** Every value named more than once, each once, in first-seen order. */
function repeatedValues({ values }: { values: readonly string[] }): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated];
}

/** Every key or kind the document declares more than once, as one issue line each. */
function duplicateIssues({ document }: { document: GmailTriagePolicy }): readonly string[] {
  const keys = repeatedValues({ values: document.rules.map(({ key }) => key) }).map(
    (key) => `key ${key} is declared more than once`,
  );
  const kinds = [
    { field: "structuralRules", values: document.structuralRules.map(({ kind }) => kind) },
    { field: "delegates", values: document.delegates.map(({ kind }) => kind) },
    { field: "gatedRules", values: document.gatedRules.map(({ kind }) => kind) },
  ].flatMap(({ field, values }) =>
    repeatedValues({ values }).map((kind) => `${field} declares ${kind} more than once`),
  );
  return [...keys, ...kinds];
}

/**
 * Validate one parsed policy document, reading a version 1 document as sender rows with nothing else on. Pure.
 *
 * @param value the parsed JSON, or the stored `jsonb`
 * @param source where it came from — a file path or {@link STORED_RULES_SOURCE} — carried into the refusal
 * @returns the document at version 2, or `TRIAGE_RULES_MALFORMED` naming every issue found
 */
export function parseGmailTriageRulesDocument({
  value,
  source,
}: {
  value: unknown;
  source: string;
}): Result<GmailTriageRulesDocument, GmailTriageRulesMalformedError> {
  const parsed = ruleFileSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issueLine({ issue }));
    return err(GmailTriageRulesErrors.malformed({ issues, source }));
  }
  const { data } = parsed;
  const rules: readonly GmailTriageArchiveRule[] = data.rules;
  let structuralRules: readonly GmailTriageStructuralRule[] = [];
  let delegates: readonly GmailTriageDelegate[] = [];
  let gatedRules: readonly GmailTriageGatedRule[] = [];
  // Version 1 predates every choice but sender rows, so reading it as those rows alone is what it said.
  if (data.schemaVersion === 2) {
    ({ delegates, gatedRules, structuralRules } = data);
  }
  const document: GmailTriageRulesDocument = { delegates, gatedRules, rules, schemaVersion: 2, structuralRules };
  const issues = duplicateIssues({ document });
  if (issues.length > 0) {
    return err(GmailTriageRulesErrors.malformed({ issues, source }));
  }
  return ok(document);
}

/**
 * Read and validate one rule document from disk — the retired home file, or a `--set` file handed to the writer.
 *
 * @param path the file to read
 * @returns the document, `undefined` when nothing is there, or the typed refusal
 */
export function readGmailTriageRulesFile({
  path,
}: {
  path: string;
}): Result<GmailTriageRulesDocument | undefined, GmailTriageRulesError> {
  const read = readStrictFileIfPresent({ operation: "read gmail triage rules", path });
  if (read.isErr()) {
    return err(GmailTriageRulesErrors.unreadable({ detail: read.error.message, path }));
  }
  if (read.value === null) {
    return ok(undefined);
  }
  const value = parseJson({ text: read.value });
  if (value.isErr()) {
    return err(GmailTriageRulesErrors.malformed({ issues: [value.error.message], source: path }));
  }
  return parseGmailTriageRulesDocument({ source: path, value: value.value });
}

/**
 * The install's policy as it stands — every array empty when the store holds no row and there was no file to
 * import — with what a writer pins to and what a reader must be told.
 */
export interface GmailTriageRulesSnapshot extends GmailTriagePolicy {
  /** The revision a writer pins to; null when no row exists yet. */
  readonly revision: number | null;
  /** The retired home file's path when it still sits beside an authoritative row, read by nothing. */
  readonly inertFile: string | undefined;
}

/** The one door every reader and writer of the install's triage rules goes through. */
export interface GmailTriageRulesPort {
  readonly read: (request: {
    readonly home: string;
  }) => Promise<Result<GmailTriageRulesSnapshot, GmailTriageRulesError>>;
  /** Replace the whole document, pinned to the revision the writer read; a conflict is never retried. */
  readonly replace: (request: {
    readonly document: GmailTriageRulesDocument;
    readonly expectedRevision: number | null;
    readonly home: string;
  }) => Promise<Result<GmailTriageRulesSnapshot, GmailTriageRulesError>>;
}

/**
 * The line a reader prints when the retired file still sits beside an authoritative row. Pure.
 *
 * @param snapshot the rules as read
 * @returns the warning, or `undefined` when there is no inert file to warn about
 */
export function inertRuleFileLine({ snapshot }: { snapshot: GmailTriageRulesSnapshot }): string | undefined {
  if (snapshot.inertFile === undefined || snapshot.revision === null) {
    return undefined;
  }
  return (
    `${snapshot.inertFile} is retired and read by nothing: the store's row (revision ${String(snapshot.revision)}) ` +
    `is this install's triage rules. Change them with \`slopweaver gmail triage-rules --set <path>\`, then ` +
    `move that file out of the home`
  );
}

/** The seams the port is built over: the register's own, and how to tell a retired file is still there. */
export type GmailTriageRulesSeams = SingletonRegisterSeams<GmailTriageRulesDocument, GmailTriageRulesError>;

/**
 * The register seams every port shares bar the connection: the retired file read and the stored decoder.
 *
 * @returns the import read, decoder and error factories
 */
export function gmailTriageRulesDomainSeams(): Omit<GmailTriageRulesSeams, "connect"> {
  return {
    decodeStored: ({ value }) => parseGmailTriageRulesDocument({ source: STORED_RULES_SOURCE, value }),
    errors: GmailTriageRulesErrors,
    readImport: ({ home }) => readGmailTriageRulesFile({ path: stateHomePaths({ home }).gmailTriageRulesJson }),
  };
}

/** The retired file's path when it is still in the home — present at all, readable or not. */
function inertFileOf({ home }: { home: string }): string | undefined {
  const path = stateHomePaths({ home }).gmailTriageRulesJson;
  const read = readStrictFileIfPresent({ operation: "check for the retired gmail triage rules file", path });
  if (read.isOk() && read.value === null) {
    return undefined;
  }
  return path;
}

/** The policy a stored document declares; no document is an install that declared nothing. */
function policyOf({ document }: { document: GmailTriageRulesDocument | undefined }): GmailTriagePolicy {
  if (document === undefined) {
    return EMPTY_TRIAGE_POLICY;
  }
  return document;
}

/**
 * The policy a snapshot carries, as the triage applies it — the snapshot minus its revision and file bookkeeping.
 * Pure.
 *
 * @param snapshot the policy as read
 * @returns the four arrays the triage reads
 */
export function triagePolicyOf({ snapshot }: { snapshot: GmailTriageRulesSnapshot }): GmailTriagePolicy {
  return {
    delegates: snapshot.delegates,
    gatedRules: snapshot.gatedRules,
    rules: snapshot.rules,
    structuralRules: snapshot.structuralRules,
  };
}

/**
 * The port over whichever register operations it is handed — production's or a unit test's in-memory ones.
 *
 * @param register the register's read and compare-and-set
 * @returns the port
 */
export function gmailTriageRulesPortOver({
  register,
}: {
  register: SingletonRegisterOperations<GmailTriageRulesDocument, GmailTriageRulesError>;
}): GmailTriageRulesPort {
  const snapshotOf = ({
    document,
    home,
    revision,
  }: {
    document: GmailTriageRulesDocument | undefined;
    home: string;
    revision: number | null;
  }): GmailTriageRulesSnapshot => {
    const policy = policyOf({ document });
    return {
      delegates: policy.delegates,
      gatedRules: policy.gatedRules,
      inertFile: revision === null ? undefined : inertFileOf({ home }),
      revision,
      rules: policy.rules,
      structuralRules: policy.structuralRules,
    };
  };
  return {
    read: async ({ home }) => {
      const read = await register.read({ home });
      if (read.isErr()) {
        return err(read.error);
      }
      return ok(snapshotOf({ document: read.value.document, home, revision: read.value.revision }));
    },
    replace: async ({ document, expectedRevision, home }) => {
      const written = await register.compareAndSet({ document, expectedRevision, home });
      if (written.isErr()) {
        return err(written.error);
      }
      return ok(snapshotOf({ document: written.value.document, home, revision: written.value.revision }));
    },
  };
}

/**
 * The port this install's triage rules are reached through: the store. Only composition roots call this.
 *
 * @returns the port every production reader and writer uses
 */
export function gmailTriageRulesPort(): GmailTriageRulesPort {
  return gmailTriageRulesPortOver({
    register: singletonRegister({
      seams: productionSingletonRegisterSeams({ ...gmailTriageRulesDomainSeams(), id: "gmail-triage-rules" }),
    }),
  });
}
