/**
 * `store verify`'s half of the lock: measure it read-only, by behaviour, without changing anything — and judge a
 * selection the lock does not recognise as this stack by whether it reaches this stack's server anyway.
 */
import { err, ok, type Result } from "#lib/result.js";

import { gatewaySessionsQuery } from "./edgeParse.js";
import type { StoreLockError } from "./errors.js";
import { LOCK_LOGIN_ROLE, loadedHbaProblems } from "./hba.js";
import { type FoundSelection, type LockStart, lockStart, reachesStack, type StackIdentity } from "./localStack.js";
import { defaultUrl, grantFindings, LOOPBACK_HOSTS, loginProblem } from "./proofs.js";
import type { LockDeps, LockMeasurement } from "./reconcile.js";

/**
 * The finding `store verify` reports when the exported variable selects this checkout's own stack.
 *
 * @internal named by this module and its test only — callers read it as a finding line
 */
export const ENVIRONMENT_REACHES_STACK =
  "SLOPWEAVER_STORE_URL reaches this checkout's own stack and overrides the secrets/store-url the lock writes — unset it and let secrets/store-url select the store";

/**
 * The finding `store verify` reports when secrets/store-url reaches this stack by a name or port the lock never writes.
 *
 * @internal named by this module and its test only — callers read it as a finding line
 */
export const SECRET_REACHES_STACK_ELSEWHERE =
  "secrets/store-url reaches this checkout's own stack by an address the lock does not write — run slopweaver store lock so it names 127.0.0.1 and the stack's port";

/** The read-only effects a measurement uses. */
type MeasureDeps = Pick<
  LockDeps,
  "adminCount" | "adminSql" | "hostIsLocal" | "postmasterStartOverSocket" | "readRules" | "stackGateway" | "tryLogin"
>;

/** Whether the `local-store-elsewhere` hatch is open, and the four-line refusal to report when it is not. */
type LocalElsewhere = { readonly open: true } | { readonly open: false; readonly refusal: string };

/** How a selection the lock does not recognise relates to this stack. */
type Reach =
  | { readonly verdict: "reaches" | "elsewhere" | "local-unproven" }
  | { readonly verdict: "unidentified"; readonly why: string };

/**
 * Whether a store URL reaches this checkout's own stack — by its literal loopback address and port, or, through any
 * other route such as a hostname alias or a local port forward, by logging in and reading the same server start time
 * the container's socket reports. A URL that does not log in cannot bypass the login either,
 * and `store verify` then reads the lock as not measured. One that logs in but whose server will not say when it
 * started cannot be told apart from this stack, so it is never cleared as elsewhere.
 *
 * One that logs in ON THIS MAC and reads a different start time is never cleared either, unless the
 * `local-store-elsewhere` hatch is open: that start time is read through the very login being judged, so a forward
 * into the locked stack can answer it falsely (five Codex reviews in a row each found a new way). Failing
 * closed ends that loop; a remote URL is unaffected, because the store refuses a remote host anyway.
 *
 * @param url the selected connection string
 * @param localElsewhereOpen whether the `local-store-elsewhere` hatch lets a login on this Mac be judged elsewhere
 * @returns whether it reaches this stack, does not, logs in on this Mac where that cannot be proved, or logs in
 *   somewhere that could not be identified (with why)
 */
async function selectionReachesStack({
  deps,
  localElsewhereOpen,
  stack,
  url,
}: {
  deps: Pick<LockDeps, "hostIsLocal" | "postmasterStartOverSocket" | "tryLogin">;
  localElsewhereOpen: boolean;
  stack: StackIdentity;
  url: string;
}): Promise<Reach> {
  if (reachesStack({ stack, url })) {
    return { verdict: "reaches" };
  }
  const attempt = await deps.tryLogin({ url });
  if (attempt.kind === "refused") {
    return { verdict: "elsewhere" };
  }
  if (attempt.kind === "unidentified") {
    return { verdict: "unidentified", why: `its server would not say when it started (${attempt.why})` };
  }
  const socketStart = deps.postmasterStartOverSocket({ projectId: stack.projectId });
  if (socketStart.isErr()) {
    // Docker could not be asked. A remote host cannot be this stack, but one on this Mac could be a forward to it
    // so it is never cleared as elsewhere.
    if (await deps.hostIsLocal({ url })) {
      return {
        verdict: "unidentified",
        why: `it logs in on this Mac and Docker could not be asked for this stack's start time (${socketStart.error.message})`,
      };
    }
    return { verdict: "elsewhere" };
  }
  if (attempt.postmasterStart === socketStart.value) {
    return { verdict: "reaches" };
  }
  if (!localElsewhereOpen && (await deps.hostIsLocal({ url }))) {
    return { verdict: "local-unproven" };
  }
  return { verdict: "elsewhere" };
}

/**
 * Measure the lock read-only: the selection is the login on this stack, the rules are in place, the default door
 * is refused over both families, no stray session is open, and the API roles hold nothing. A selection the lock
 * does not recognise as this stack — the exported variable, another name, another port — that still logs in to this
 * stack's server is a finding rather than "not measured", because it reaches the store around the lock's URL. One
 * that logs in on this Mac and cannot be proved to lead elsewhere is a finding too: the `local-store-elsewhere`
 * refusal.
 *
 * @param localElsewhere whether that hatch is open, and the four-line refusal to report when it is not
 * @param stack the stack the config names
 * @param selection the store selection
 * @param deps the read-only effects
 * @returns what held and what did not
 */
export async function measureLock({
  stack,
  selection,
  deps,
  localElsewhere,
}: {
  localElsewhere: LocalElsewhere;
  stack: StackIdentity;
  selection: FoundSelection;
  deps: MeasureDeps;
}): Promise<Result<LockMeasurement, StoreLockError>> {
  const start = lockStart({ selection, stack });
  if (start.isOk()) {
    return measureRecognised({ deps, stack, start: start.value });
  }
  if (selection === null) {
    return err(start.error);
  }
  const reach = await selectionReachesStack({
    deps,
    localElsewhereOpen: localElsewhere.open,
    stack,
    url: selection.url,
  });
  const finding = unrecognisedFinding({ localElsewhere, origin: selection.origin, reach });
  if (finding === null) {
    return err(start.error);
  }
  return ok({ findings: [finding], held: [] });
}

/**
 * The one finding a selection the lock does not recognise earns, by how it relates to this stack.
 *
 * @param origin where the selection came from, which names it in the finding
 * @returns the finding, or `null` when the selection leaves the lock unmeasured
 */
function unrecognisedFinding({
  localElsewhere,
  origin,
  reach,
}: {
  localElsewhere: LocalElsewhere;
  origin: NonNullable<FoundSelection>["origin"];
  reach: Reach;
}): string | null {
  if (reach.verdict === "local-unproven" && !localElsewhere.open) {
    return localElsewhere.refusal;
  }
  const source = origin === "environment" ? "SLOPWEAVER_STORE_URL" : "secrets/store-url";
  if (reach.verdict === "unidentified") {
    return `${source} logs in, but whether it reaches this checkout's own stack around the lock's login cannot be told: ${reach.why}`;
  }
  if (reach.verdict === "reaches") {
    return origin === "environment" ? ENVIRONMENT_REACHES_STACK : SECRET_REACHES_STACK_ELSEWHERE;
  }
  return null;
}

/**
 * Measure a selection the lock recognises as this stack, check by check, in the order `store verify` reports them.
 *
 * @param start the database and current URL
 * @returns what held and what did not, or the first read that failed
 */
async function measureRecognised({
  deps,
  stack,
  start,
}: {
  deps: MeasureDeps;
  stack: StackIdentity;
  start: LockStart;
}): Promise<Result<LockMeasurement, StoreLockError>> {
  const { projectId, dbPort } = stack;
  const gateway = deps.stackGateway({ projectId });
  if (gateway.isErr()) {
    return err(gateway.error);
  }
  const socketStart = deps.postmasterStartOverSocket({ projectId });
  if (socketStart.isErr()) {
    return err(socketStart.error);
  }
  const login = loginReading({
    problem: loginProblem({
      attempt: await deps.tryLogin({ url: start.currentUrl }),
      postmasterStart: socketStart.value,
    }),
  });
  const rules = deps.readRules({ projectId });
  if (rules.isErr()) {
    return err(rules.error);
  }
  const ruleProblems = loadedHbaProblems({ gateway: gateway.value, rules: rules.value });
  const ruleCheck = cleanReading({
    clean: `pg_hba.conf admits only ${LOCK_LOGIN_ROLE} from the Mac`,
    problems: ruleProblems,
  });
  const doors = await doorReadings({ deps, port: dbPort });
  const strays = strayReading({ deps, gateway: gateway.value, projectId });
  if (strays.isErr()) {
    return err(strays.error);
  }
  const grants = grantFindings({ database: start.database, deps, projectId });
  if (grants.isErr()) {
    return err(grants.error);
  }
  const grantCheck = cleanReading({
    clean: "the API roles hold no right on the store's tables",
    problems: grants.value,
  });
  return ok(merged({ parts: [login, ruleCheck, doors, strays.value, grantCheck] }));
}

/**
 * The login check's reading.
 *
 * @param problem why the store URL is not the lock's login, or `null` when it is
 * @returns one held line or one finding
 */
function loginReading({ problem }: { problem: string | null }): LockMeasurement {
  if (problem === null) {
    return { findings: [], held: [`the store URL logs in as ${LOCK_LOGIN_ROLE} on this stack`] };
  }
  return { findings: [`the store URL is not the lock's login: ${problem}`], held: [] };
}

/**
 * A check whose problems are its findings, and which holds when there are none.
 *
 * @param clean the held line when there is no problem
 * @returns the problems as findings, or the held line
 */
function cleanReading({ clean, problems }: { clean: string; problems: readonly string[] }): LockMeasurement {
  if (problems.length === 0) {
    return { findings: [], held: [clean] };
  }
  return { findings: problems, held: [] };
}

/**
 * Try the default door over both loopback families.
 *
 * @param port the stack's database port
 * @returns one held line or one finding per family
 */
async function doorReadings({ deps, port }: { deps: MeasureDeps; port: number }): Promise<LockMeasurement> {
  const findings: string[] = [];
  const held: string[] = [];
  for (const host of LOOPBACK_HOSTS) {
    const attempt = await deps.tryLogin({ url: defaultUrl({ host, port }) });
    if (attempt.kind === "refused" && attempt.byRule) {
      held.push(`postgres:postgres is refused at ${host}`);
    } else {
      findings.push(`postgres:postgres is NOT refused by the rule at ${host}`);
    }
  }
  return { findings, held };
}

/**
 * Count the sessions from the Mac open as a role other than the login.
 *
 * @param gateway the address Mac logins arrive from
 * @returns a finding when any is open, or the read that failed
 */
function strayReading({
  deps,
  gateway,
  projectId,
}: {
  deps: MeasureDeps;
  gateway: string;
  projectId: string;
}): Result<LockMeasurement, StoreLockError> {
  const strays = deps.adminCount({
    database: "postgres",
    projectId,
    query: gatewaySessionsQuery({ gateway, includeLogin: false, terminate: false }),
    step: "counting sessions from the Mac",
  });
  return strays.map((count) => ({
    findings:
      count > 0 ? [`${String(count)} session(s) from the Mac are open as a role other than ${LOCK_LOGIN_ROLE}`] : [],
    held: [],
  }));
}

/**
 * Several readings as one, each list in the order given.
 *
 * @param parts the readings, in report order
 * @returns their findings and held lines, concatenated
 */
function merged({ parts }: { parts: readonly LockMeasurement[] }): LockMeasurement {
  return { findings: parts.flatMap((part) => part.findings), held: parts.flatMap((part) => part.held) };
}
