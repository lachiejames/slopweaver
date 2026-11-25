/**
 * `slopweaver secrets status` — the READ side of the secrets store, which did not exist.
 *
 * `src/cli/manifests/secrets.ts` registered exactly one verb, `set`, so the owner's only view of their own
 * credential store was `ls`. This verb lists every credential with its platform, what it is, its scope at
 * mint, its expiry and which verb reads it — and **never a value**. That is structural rather than a
 * promise: {@link readStore} is the only function here that opens a file, it opens grant JSON only, and the
 * one thing it takes out of a grant is the bound account, the scope COUNT, the scopes that could write and
 * `expiryMs` — a scope URI is a public identifier, never token material. A single-line secret's bytes are
 * never read at all — only its mode, its mtime and whether its size is zero.
 *
 * A thin effectful shell over pure halves: the register and the state machine are `src/secrets/status.ts`,
 * the parser and the renderers are `./statusCore.ts`, and everything below is `readdir`/`stat`/`readFile`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { unsetFieldAsNull } from "#lib/absent.js";
import { slopweaverHome } from "../../../config.js";
import { type DatadogSiteState, datadogSiteState } from "../../../datadog/config.js";
import { datadogSite } from "../../../datadog/source.js";
import type { Logger } from "../../../lib/logger.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { notReadOnlyScopes } from "../../../live/google/scopes.js";
import { OUTLOOK_CALENDAR_GRANT_SECRET, OUTLOOK_MAIL_GRANT_SECRET } from "../../../secrets/outlookGrant.js";
import { credentialRows, type GrantObservation, type StoreObservation } from "../../../secrets/status.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseSecretsStatusArgs, renderStatus, type SecretsStatusArgs, visibleRows } from "./statusCore.js";
import { SECRETS_STATUS_USAGE } from "./statusUsage.js";

/** The two Outlook grant files — mail and calendar — both MSAL caches rather than a Google refresh token. */
const OUTLOOK_GRANT_FILES: ReadonlySet<string> = new Set([OUTLOOK_MAIL_GRANT_SECRET, OUTLOOK_CALENDAR_GRANT_SECRET]);

/** The token-free reading of a grant file. Anything that will not parse yields `undefined`, never a throw. */
function readGrant({ path }: { path: string }): GrantObservation | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "secrets status grant", text: raw });
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const record: Record<string, unknown> = { ...parsed };
  const account = record["account"];
  const scopes = record["scopes"];
  const grantedAtIso = record["grantedAtIso"];
  const expiryMs = record["expiryMs"];
  if (typeof account !== "string" || typeof grantedAtIso !== "string" || !Array.isArray(scopes)) {
    return undefined;
  }
  // Every door's guard (`googleGrant.ts`'s `isGrant`, `outlookGrant.ts`'s `isOutlookGrant`) refuses a non-string scope.
  const scopeNames = scopes.filter((scope): scope is string => typeof scope === "string");
  if (scopeNames.length !== scopes.length) {
    return undefined;
  }
  // The fields its own door requires beyond those: both Outlook grants' `msalCache` and `homeAccountId`, every Google
  // door's `refreshToken`. Only their types are read, never their bytes, and a grant without one is a file its door
  // refuses, so it must not read `ok`.
  const requiredFields = OUTLOOK_GRANT_FILES.has(basename(path)) ? ["msalCache", "homeAccountId"] : ["refreshToken"];
  if (requiredFields.some((field) => typeof record[field] !== "string")) {
    return undefined;
  }
  return {
    account,
    grantedAtIso,
    scopeCount: scopes.length,
    writeScopes: notReadOnlyScopes({ scopes: scopeNames }),
    ...(typeof expiryMs === "number" ? { expiryMs } : {}),
  };
}

/**
 * Observe every file standing in the store, without reading a single-line secret's bytes.
 *
 * A missing `secrets/` directory is an empty store rather than an error: an install that has connected
 * nothing yet is an ordinary state, and the report's job is to say so.
 *
 * @param home the Slopweaver home whose `secrets/` directory to read
 * @returns one observation per file, in whatever order the filesystem gave them
 */
export function readStore({ home }: { home: string }): readonly StoreObservation[] {
  const dir = stateHomePaths({ home }).secrets;
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(dir, name);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(path);
    } catch {
      return [];
    }
    if (!stats.isFile()) {
      return [];
    }
    const grant = name.endsWith(".json") ? readGrant({ path }) : undefined;
    return [
      {
        modeOctal: (stats.mode & 0o777).toString(8).padStart(3, "0"),
        modifiedIso: stats.mtime.toISOString(),
        name,
        ...(grant === undefined ? {} : { grant }),
        ...(stats.size === 0 ? { empty: true as const } : {}),
      },
    ];
  });
}

/** The injectable seams the shell composes — real fs and clock in production, plain fakes in a test. */
export interface SecretsStatusDeps {
  /**
   * Whether the home names a Datadog site. Config rather than a secret, so it is no row; `--json` carries it beside
   * the rows because Datadog's two keys connect nothing without it.
   */
  readonly datadogSite: (target: { home: string }) => DatadogSiteState;
  readonly home: () => string;
  readonly nowMs: () => number;
  readonly readStore: typeof readStore;
  readonly logger: Pick<Logger, "out" | "error">;
}

/** The home whose store is reported: `--home` when given, else the ambient one the seam resolves. */
function storeHome({ args, deps }: { args: SecretsStatusArgs; deps: SecretsStatusDeps }): string {
  const named = unsetFieldAsNull({ key: "home", record: args });
  if (named === null) {
    return deps.home();
  }
  return named;
}

/**
 * Run `secrets status` over injected dependencies — the testable shell.
 *
 * @param argv the full process argv (`secrets status` starts at index 2)
 * @param deps the effectful seams
 * @returns the process exit code
 */
export function runSecretsStatusWithDeps({ argv, deps }: { argv: readonly string[]; deps: SecretsStatusDeps }): number {
  const tail = argv.slice(3);
  const rest = tail[0] === "status" ? tail.slice(1) : tail;
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.logger.out({ line: SECRETS_STATUS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseSecretsStatusArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      deps.logger.error({ msg: message });
    });
    return EXIT_USAGE;
  }
  const home = storeHome({ args: parsed.value, deps });
  const rows = credentialRows({ nowMs: deps.nowMs(), observations: deps.readStore({ home }) });
  if (parsed.value.json) {
    deps.logger.out({
      line: JSON.stringify({
        datadogSite: deps.datadogSite({ home }),
        home,
        rows: visibleRows({ all: parsed.value.all, rows }),
      }),
    });
    return EXIT_OK;
  }
  renderStatus({ all: parsed.value.all, rows }).forEach((line) => {
    deps.logger.out({ line });
  });
  return EXIT_OK;
}

/** Production dependencies (real fs read, real clock). */
function productionSecretsStatusDeps(): SecretsStatusDeps {
  return {
    datadogSite: ({ home }) => datadogSiteState({ raw: datadogSite({ home }) }),
    home: slopweaverHome,
    logger,
    nowMs: () => Date.now(),
    readStore,
  };
}

/**
 * Run the `secrets status` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runSecretsStatus(argv: readonly string[]): number {
  return runSecretsStatusWithDeps({ argv, deps: productionSecretsStatusDeps() });
}

export const secretsStatusCommand = defineCommand({ run: runSecretsStatus });
