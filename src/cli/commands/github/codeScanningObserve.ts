/**
 * The two fresh reads every `github code-scanning` sub-verb starts from, and how they are printed — split
 * from `./codeScanningRun.ts`, which owns the disable decision and the door.
 */

import { errorStatus, formatIngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { DefaultSetup, GithubDefaultSetupApi } from "../../../outbound/github/defaultSetup.js";
import {
  type ConfigurationObservation,
  configurationLine,
  type GithubCodeScanningArgs,
  setupLine,
} from "./codeScanningCore.js";

/** The statuses that mean "this token cannot see the attachment" — unknown, never "none attached". */
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([403, 404]);

/** Both fresh reads every sub-verb starts from. */
export interface CodeScanningObserved {
  readonly setup: DefaultSetup;
  readonly configuration: ConfigurationObservation;
}

/**
 * Read default setup and the attached configuration; a configuration 403/404 is kept as UNKNOWN.
 *
 * @param api the default-setup client both reads go through
 * @param args the parsed sub-verb, naming the repository
 * @returns both reads, or the formatted failure of whichever read could not be classified
 */
export async function observeCodeScanning({
  api,
  args,
}: {
  api: GithubDefaultSetupApi;
  args: GithubCodeScanningArgs;
}): Promise<Result<CodeScanningObserved>> {
  const setup = await api.defaultSetup({ owner: args.owner, repo: args.repo });
  if (setup.isErr()) {
    return err([formatIngestError({ error: setup.error })]);
  }
  const read = await api.securityConfiguration({ owner: args.owner, repo: args.repo });
  if (read.isOk()) {
    const configuration: ConfigurationObservation =
      read.value === undefined ? { kind: "none" } : { kind: "read", value: read.value };
    return ok({ configuration, setup: setup.value });
  }
  const status = errorStatus({ error: read.error });
  if (status !== undefined && UNAVAILABLE_STATUSES.has(status)) {
    return ok({ configuration: { error: read.error, kind: "unavailable" }, setup: setup.value });
  }
  return err([formatIngestError({ error: read.error })]);
}

/**
 * Print the two reads, one line each, or as one JSON document carrying the outcome.
 *
 * @param deps the stdout channel the report is written to
 * @param outcome the one-phrase verdict the report opens on
 * @param extra further JSON fields, such as the pre-write read, merged into the document
 */
export function reportCodeScanning({
  deps,
  args,
  observed,
  outcome,
  extra = {},
}: {
  deps: { readonly out: (line: string) => void };
  args: GithubCodeScanningArgs;
  observed: CodeScanningObserved;
  outcome: string;
  extra?: Readonly<Record<string, unknown>>;
}): void {
  const repo = `${args.owner}/${args.repo}`;
  if (args.json) {
    const configuration =
      observed.configuration.kind === "unavailable"
        ? { error: formatIngestError({ error: observed.configuration.error }), kind: "unavailable" }
        : observed.configuration;
    deps.out(JSON.stringify({ configuration, outcome, repo, setup: observed.setup, ...extra }, undefined, 2));
    return;
  }
  deps.out(`${outcome} ${repo}`);
  deps.out(`  ${setupLine({ setup: observed.setup })}`);
  deps.out(`  ${configurationLine({ configuration: observed.configuration })}`);
}
