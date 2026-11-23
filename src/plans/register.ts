/**
 * Decode, derive and change the plan register. Pure — the caller reads and writes the store, this decides
 * whether what it read is usable and what one change makes of it.
 *
 * ## Structural only, on purpose
 *
 * {@link parsePlanRegister} checks the SHAPE of the register and nothing about rotation. Claude's own rules
 * belong to `src/claude/config.ts`. The write path applies `parseClaudeAccounts` to the generated
 * projection, which holds no count rule — a register may hold zero, one or N Claude rows, one being a whole
 * fleet — and a Codex route never fails over a Claude-specific problem.
 *
 * ## Raw rows survive a change
 *
 * Every function here carries {@link PlanRegisterSnapshot.document} beside the typed rows and edits the RAW
 * row when it changes one. A key this version does not read — a newer writer's field, or the `pinned: null`
 * the legacy Claude file already carries — is preserved rather than dropped. Reconstructing the document
 * from the narrowed rows would quietly delete it.
 *
 * ## An alias is a neutral local label
 *
 * Never derived from an email address, unique within its provider, and filename-safe because the Codex
 * quota cache is addressed by it. Renaming one does NOT move a credential: for Claude the alias IS the
 * store directory name and `storeService.ts` hashes that path for the keychain, so a rename addresses a
 * different, empty item. A rename is a re-enrollment; nothing here performs one.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { hasLineBreak } from "#lib/lineBreaks.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { ALIAS_MAX_LENGTH, ALIAS_PATTERN } from "./alias.js";
import { type PlanRegisterError, PlanRegisterErrors } from "./errors.js";
import { lapseProblems } from "./lapse.js";
import { structuralProblems } from "./structure.js";
import { decodePlanThresholds } from "./thresholds.js";
import type {
  PlanDiagnostic,
  PlanPause,
  PlanProvider,
  PlanRegisterDocument,
  PlanRegisterSnapshot,
  RegisteredPlan,
} from "./types.js";
import { decodePlanAllowance, decodeUsageLimitPercent, usageLimitProblems } from "./usageLimit.js";

/** The only register version this build reads or writes. */
const PLAN_REGISTER_VERSION = 1;

// The alias shape lives in `./alias.ts`, a leaf the removal history reads too; re-exported so its readers keep one door.
export { isPlanAlias } from "./alias.js";

/**
 * Whether a decoded value names one of the providers this build serves.
 *
 * @param value the row's `provider` field, as decoded
 * @returns whether it is `claude` or `codex`
 */
function isPlanProvider(value: unknown): value is PlanProvider {
  return value === "claude" || value === "codex";
}

/**
 * Every problem with one candidate row, so a caller sees all of them at once.
 *
 * @param row one decoded element of the register's `rows`
 * @param index its position, for a message that can point at the offending row
 * @returns every problem found, empty when the row is usable
 */
function rowProblems({ index, row }: { index: number; row: unknown }): readonly string[] {
  const at = `row ${index + 1}`;
  if (!isRecord(row)) {
    return [`${at} is not an object`];
  }
  const problems: string[] = [];
  if (!isPlanProvider(row["provider"])) {
    problems.push(`${at} needs a \`provider\` of \`claude\` or \`codex\``);
  }
  const alias = row["alias"];
  if (typeof alias !== "string" || !ALIAS_PATTERN.test(alias)) {
    problems.push(`${at} needs an \`alias\` of lowercase letters, digits and hyphens`);
  } else if (alias.length > ALIAS_MAX_LENGTH) {
    problems.push(`${at}'s alias is longer than ${String(ALIAS_MAX_LENGTH)} characters`);
  }
  const storeDir = row["storeDir"];
  if (typeof storeDir !== "string" || storeDir.trim() === "") {
    problems.push(`${at} needs a \`storeDir\` naming the directory its provider's CLI is signed into`);
  }
  const email = row["email"];
  // One line, for the reason `claude/config.ts` gives: a printed address spanning two lines forges a gauge line.
  if (email !== undefined && (typeof email !== "string" || !email.includes("@") || hasLineBreak({ text: email }))) {
    problems.push(`${at}'s \`email\`, when present, must be the one-line address its store's account is called`);
  }
  problems.push(...pausedProblems({ at, paused: row["paused"] }));
  problems.push(
    ...usageLimitProblems({ allowance: row["allowance"], at, usageLimitPercent: row["usageLimitPercent"] }),
  );
  problems.push(...lapseProblems({ at, lapsesAtIso: row["lapsesAtIso"] }));
  return problems;
}

/**
 * Every problem with one row's `paused` value, empty when the plan is not paused at all.
 *
 * A malformed pause is a problem rather than something to ignore, because of the DIRECTION of the failure:
 * an ignored one leaves the plan in the fleet while its row says it is out.
 *
 * @param at how to name the offending row in a message
 * @param paused the row's `paused` value, as decoded
 * @returns every problem found
 */
function pausedProblems({ at, paused }: { at: string; paused: unknown }): readonly string[] {
  if (paused === undefined) {
    return [];
  }
  if (!isRecord(paused)) {
    return [`${at}'s \`paused\`, when present, must be an object with \`reason\` and \`sinceIso\``];
  }
  const problems: string[] = [];
  const reason = paused["reason"];
  const sinceIso = paused["sinceIso"];
  if (typeof reason !== "string" || reason.trim() === "") {
    problems.push(`${at}'s \`paused.reason\` must say what the plan is waiting on`);
  }
  if (typeof sinceIso !== "string" || parseStrictIsoInstantMs({ text: sinceIso }) === undefined) {
    problems.push(`${at}'s \`paused.sinceIso\` must be an ISO-8601 instant`);
  }
  return problems;
}

/**
 * Read one row's `paused` value into the contract, after {@link pausedProblems} reported any malformed one.
 *
 * @param paused the row's `paused` value, as decoded
 * @returns the pause, or undefined when the plan is not paused
 */
function decodePaused({ paused }: { paused: unknown }): PlanPause | undefined {
  if (!isRecord(paused)) {
    return undefined;
  }
  const reason = paused["reason"];
  const sinceIso = paused["sinceIso"];
  if (typeof reason !== "string" || typeof sinceIso !== "string") {
    return undefined;
  }
  return { reason, sinceIso };
}

/**
 * Narrow one validated raw row to its typed plan.
 *
 * @param row a raw row {@link rowProblems} already reported nothing about
 * @returns the typed plan, or undefined when the row is not one
 */
function decodeRow({ row }: { row: Readonly<Record<string, unknown>> }): RegisteredPlan | undefined {
  const provider = row["provider"];
  const alias = row["alias"];
  const storeDir = row["storeDir"];
  if (!isPlanProvider(provider) || typeof alias !== "string" || typeof storeDir !== "string") {
    return undefined;
  }
  const paused = decodePaused({ paused: row["paused"] });
  const email = row["email"];
  const lapsesAtIso = row["lapsesAtIso"];
  return {
    alias,
    allowance: decodePlanAllowance({ allowance: row["allowance"] }),
    provider,
    storeDir,
    usageLimitPercent: decodeUsageLimitPercent({ usageLimitPercent: row["usageLimitPercent"] }),
    ...(row["pinned"] === true ? { pinned: true as const } : {}),
    ...(typeof email === "string" ? { email } : {}),
    ...(paused === undefined ? {} : { paused }),
    ...(typeof lapsesAtIso === "string" ? { lapsesAtIso } : {}),
  };
}

/**
 * Decode a register document without applying any provider's rotation requirements.
 *
 * @param value the decoded contents of `plans.json`
 * @returns the preserved raw document beside its validated typed rows, or every problem found at once
 */
export function parsePlanRegister({ value }: { value: unknown }): Result<PlanRegisterSnapshot, PlanRegisterError> {
  if (!isRecord(value)) {
    return err(PlanRegisterErrors.registerInvalid({ problems: ["the register is not an object"] }));
  }
  if (value["version"] !== PLAN_REGISTER_VERSION) {
    return err(
      PlanRegisterErrors.registerInvalid({
        problems: [
          `the register declares version ${JSON.stringify(value["version"])}; this build reads version ` +
            `${String(PLAN_REGISTER_VERSION)} only`,
        ],
      }),
    );
  }
  const rawRows = value["rows"];
  if (!Array.isArray(rawRows)) {
    return err(PlanRegisterErrors.registerInvalid({ problems: ["the register's `rows` is not an array"] }));
  }
  const problems = rawRows.flatMap((row, index) => rowProblems({ index, row }));
  if (problems.length > 0) {
    return err(PlanRegisterErrors.registerInvalid({ problems }));
  }
  const rows = rawRows.filter(isRecord);
  const plans = rows.flatMap((row) => {
    const decoded = decodeRow({ row });
    return decoded === undefined ? [] : [decoded];
  });
  const structural = structuralProblems({ document: value, plans });
  if (structural.length > 0) {
    return err(PlanRegisterErrors.registerInvalid({ problems: structural }));
  }
  return ok({
    diagnostics: [],
    document: { ...value, rows, version: PLAN_REGISTER_VERSION },
    plans,
    thresholds: decodePlanThresholds({ document: value }),
    // A decoded document is not yet a stored one: only the store edge knows which row revision it came from.
    revision: null,
    source: "registered",
  });
}

/**
 * Build the register an unadopted install ALREADY has, without writing anything.
 *
 * Exactly the plans the user signed in to: the Claude rows Slopweaver's own enrolment wrote, carried through
 * byte-for-byte with a `provider` discriminator added. Nothing found on the machine joins them — a Codex login
 * in `$CODEX_HOME`, or any other — because a plan is the user's to offer, never ours to discover: plans are never
 * added from what is found on the machine. A Codex plan enters only by `slopweaver plans add --provider codex`.
 * `slopweaver plans adopt` is what turns this picture into a file.
 *
 * @param claudeRows the raw contents of `claude-accounts/accounts.json`, empty when that file is absent
 * @returns the derived snapshot, carrying a `DERIVED_REGISTER` diagnostic, or every problem found
 */
export function derivePlanRegister({
  claudeRows,
}: {
  claudeRows: readonly Readonly<Record<string, unknown>>[];
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  const rows: readonly Readonly<Record<string, unknown>>[] = claudeRows.map((row) => ({ ...row, provider: "claude" }));
  const parsed = parsePlanRegister({ value: { rows, version: PLAN_REGISTER_VERSION } });
  return parsed.map((snapshot) => ({
    ...snapshot,
    diagnostics: [derivedRegisterDiagnostic()],
    source: "derived" as const,
  }));
}

/**
 * The diagnostic every derived read carries, so no surface presents a computed picture as a stored one.
 *
 * @returns the `DERIVED_REGISTER` diagnostic
 */
function derivedRegisterDiagnostic(): PlanDiagnostic {
  return {
    code: "DERIVED_REGISTER",
    message:
      `no plan register has been adopted, so this picture was DERIVED from the Claude plans already ` +
      `signed in — \`slopweaver plans adopt\` writes it down`,
  };
}

/**
 * Narrow the register to one provider's rows.
 *
 * @returns that provider's plans, in registered order
 */
export function plansForProvider({
  plans,
  provider,
}: {
  plans: readonly RegisteredPlan[];
  provider: PlanProvider;
}): readonly RegisteredPlan[] {
  return plans.filter((plan) => plan.provider === provider);
}

/**
 * The registered plan one provider and alias name.
 *
 * @param alias the plan's neutral local label
 * @returns the plan, or undefined when no row carries that pair
 */
export function findRegisteredPlan({
  alias,
  plans,
  provider,
}: {
  alias: string;
  plans: readonly RegisteredPlan[];
  provider: PlanProvider;
}): RegisteredPlan | undefined {
  return plans.find((plan) => plan.provider === provider && plan.alias === alias);
}

/**
 * The plan one provider's pinned seats boot against, when a row carries the pin.
 *
 * @returns the pinned plan, or undefined when that provider has none
 */
export function pinnedPlanFor({
  plans,
  provider,
}: {
  plans: readonly RegisteredPlan[];
  provider: PlanProvider;
}): RegisteredPlan | undefined {
  return plans.find((plan) => plan.provider === provider && plan.pinned === true);
}

/**
 * The plans of one provider the fleet may actually spend — every registered row that is not paused.
 *
 * This is the ONE filter, and where it is applied is the design: a site acting on "the fleet" calls it, and
 * a site acting on a plan the operator NAMED does not, because pausing a plan must never block signing it
 * back in.
 *
 * @returns the unpaused plans of that provider, in registered order
 */
export function unpausedPlansFor({
  plans,
  provider,
}: {
  plans: readonly RegisteredPlan[];
  provider: PlanProvider;
}): readonly RegisteredPlan[] {
  return plansForProvider({ plans, provider }).filter((plan) => plan.paused === undefined);
}

/**
 * Re-validate a changed row list against the whole register's rules.
 *
 * Re-parsing rather than patching the typed rows is deliberate: every structural rule — pin cardinality, a
 * paused pin, a duplicate destination — is then enforced by exactly one function, so a mutation cannot
 * publish a register a read of the same file would refuse.
 *
 * @param document the document whose unrelated top-level fields are carried through
 * @param rows the changed rows
 * @returns the republished snapshot, or every problem the change introduced
 */
export function republishRows({
  document,
  rows,
}: {
  document: PlanRegisterDocument;
  rows: readonly Readonly<Record<string, unknown>>[];
}): Result<PlanRegisterSnapshot, PlanRegisterError> {
  return parsePlanRegister({ value: { ...document, rows, version: PLAN_REGISTER_VERSION } });
}
