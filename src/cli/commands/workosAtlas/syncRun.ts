/**
 * `slopweaver atlas workos sync [--json] [--home <dir>]` — probe WorkOS's route map against the running
 * API and, when a key exists, read what the environment holds.
 *
 * ## This verb IS the door
 *
 * Doctrine rule 3's own resolution: a `slopweaver` verb that reaches a provider is the door, rather than a
 * way around one. WorkOS is reached here and nowhere else — the origin is a constant in
 * `atlas/workos/routeCandidates.ts` and no flag names a host, so a run cannot be pointed at a different
 * tenant by its command line.
 *
 * ## Why an unconfigured key is EXIT_EXPECTED_EMPTY rather than an error
 *
 * This installation's access to WorkOS is a JumpCloud SaaS-management account record, which is evidence a
 * login exists and mints no API key. So the route map syncs and the content does not, and that combination
 * is the ordinary starting state. Reporting it as a failure would train a reader to ignore this verb's exit
 * code; reporting it as success would hide a real, actionable gap. The third code says exactly what
 * happened.
 *
 * The MANDATORY half is the route probe, and its failure is `EXIT_ERROR` however much content was
 * published. This verb decided its own exit code rather than leaning on the kit back when the kit's
 * `hasUsableCoverage` was existential; that predicate is gone and `kit/mandatoryKinds.ts` now refuses a
 * mixed generation at publish time, but the exit code stays this verb's own — the two answer different
 * questions.
 */
import { type WorkosFetch } from "../../../atlas/workos/client.js";
import { WORKOS_CONTENT_KINDS } from "../../../atlas/workos/contentAcquire.js";
import { resolveWorkosApiKey } from "../../../atlas/workos/credential.js";
import { workosAtlasPaths } from "../../../atlas/workos/store.js";
import { syncWorkosApiSurface, type WorkosSyncOutcome } from "../../../atlas/workos/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a WorkOS atlas verb sits: past the runtime, the script, the `atlas` noun and the platform. */
export const WORKOS_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const WORKOS_SYNC_USAGE = "usage: slopweaver atlas workos sync [--json] [--home <dir>]";

/**
 * The production HTTP seam: one `fetch`, and nothing a caller can steer.
 *
 * Redirects are NOT followed, and that is load-bearing rather than incidental: a `302` to
 * `error.workos.com` is itself one of the six verdicts `routeProbe.ts` classifies, and following it would
 * replace that evidence with whatever the error host happens to serve.
 *
 * @returns the fetch implementation the client drives
 *
 * @internal
 */
export function productionWorkosFetch(): WorkosFetch {
  return async ({ url, method, headers }) => {
    const response = await fetch(url, { headers: { ...headers }, method, redirect: "manual" });
    return { status: response.status, text: await response.text() };
  };
}

/**
 * The exit code one sync earned.
 *
 * @param outcome what the sync published
 * @returns `EXIT_OK` when both halves ran, `EXIT_EXPECTED_EMPTY` when the content half is unconfigured or
 *   bounded, and `EXIT_ERROR` when it was attempted and broke
 *
 * @internal
 */
export function exitCodeForWorkosSync({ outcome }: { outcome: WorkosSyncOutcome }): number {
  if (outcome.content === "synced") {
    return EXIT_OK;
  }
  return outcome.content === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/**
 * The lines one sync prints.
 *
 * Each content family that did not sync gets its own line. The rolled-up outcome cannot say WHICH endpoint
 * refused, and a reader who has to open the atlas files to find that out is a reader who will not.
 *
 * @param outcome what the sync published
 * @returns the report, one line each, ending without a trailing newline
 *
 * @internal
 */
export function renderWorkosSyncLines({ outcome }: { outcome: WorkosSyncOutcome }): readonly string[] {
  const families = WORKOS_CONTENT_KINDS.filter((kind) => outcome.families[kind].outcome !== "synced").map((kind) => {
    const grade = outcome.families[kind];
    if (grade.reason === null) {
      return `  ${kind} (${grade.outcome})`;
    }
    return `  ${kind} (${grade.outcome}) — ${grade.reason}`;
  });
  return [
    `workos api route map — ${String(outcome.presentCount)} of ${String(outcome.probedCount)} candidate ` +
      `pair(s) proved present by the running server, ${String(outcome.absentCount)} proved not routed ` +
      "(no credential used)",
    `content (${outcome.content}) — ${String(outcome.organizationCount)} organisation(s), ` +
      `${String(outcome.userCount)} user(s), ${String(outcome.connectionCount)} connection(s), ` +
      `${String(outcome.directoryCount)} directory(ies)`,
    ...families,
    `dashboard page map — ${String(outcome.pageCount)} declared address(es), none witnessed until a walk runs`,
  ];
}

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({ rest }: { rest: readonly string[] }): Result<{ home: string; json: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * Run the WorkOS sync.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function workosAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: WORKOS_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: WORKOS_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: WORKOS_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson } = options.value;
  // A missing key is not a reason to skip the probe: the route map needs no credential at all, and refusing
  // the whole run would make an account-only install unable to hold WorkOS's API surface.
  const published = await syncWorkosApiSurface({
    apiKey: resolveWorkosApiKey({ env: process.env, home }),
    at: new Date().toISOString(),
    env: process.env,
    fetch: productionWorkosFetch(),
    paths: workosAtlasPaths({ home }),
  });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  if (asJson) {
    logger.out({ line: JSON.stringify(published.value, null, 1) });
  } else {
    renderWorkosSyncLines({ outcome: published.value }).forEach((line) => {
      logger.out({ line });
    });
  }
  return exitCodeForWorkosSync({ outcome: published.value });
}
