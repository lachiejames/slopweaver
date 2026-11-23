/**
 * Ask Knock's two live APIs which of their declared GET routes actually exist, with no credential at all.
 *
 * ```bash
 * yarn tsx tools/probeKnockSurface.ts            # print each declared GET's evidence class
 * yarn tsx tools/probeKnockSurface.ts --verify   # exit non-zero if src/atlas/knock/apiProbe.ts disagrees
 * ```
 *
 * `apiProbe.ts` carries WHY this probe is worth more here than on most platforms — both hosts answer a
 * known path `401` and an unknown one `404`, so an unauthenticated request separates "this route exists"
 * from "this route does not". This file is the measurement that keeps that claim honest, and `--verify` is
 * what a session runs before quoting the census.
 *
 * ## Only GETs are sent, and every parameter is obviously synthetic
 *
 * The other 130 declared operations trigger a workflow, send a broadcast or delete a branch. This atlas
 * only ever reads, so they are inventoried and never requested — `KNOCK_PROBE_CENSUS.unprobedMutating` is
 * the count, and it is asserted so their absence cannot be mistaken for a negative result. `zzzsynthetic`
 * stands in for every `{brace}` segment, because a real identifier would be reaching for the ACCOUNT rather
 * than for the route.
 */
import {
  KNOCK_AUTH_REFUSAL_CODES,
  KNOCK_NOT_FOUND_DETAILS,
  KNOCK_PROBE_CENSUS,
  type KnockProbeEvidence,
} from "../src/atlas/knock/apiProbe.js";
import { KNOCK_SURFACES } from "../src/atlas/knock/generated/surfaces.js";
import {
  KNOCK_APIS,
  KNOCK_DATA_API_ORIGIN,
  KNOCK_MANAGEMENT_API_ORIGIN,
  type KnockApi,
} from "../src/atlas/knock/surfaceNaming.js";
import { isRecord } from "../src/lib/parsers.js";

/** The value substituted for every `{brace}` segment. Obviously not an identifier of this organisation's. */
const SYNTHETIC = "zzzsynthetic";

/** Where each API is served. */
const ORIGINS: Readonly<Record<KnockApi, string>> = {
  data: KNOCK_DATA_API_ORIGIN,
  management: KNOCK_MANAGEMENT_API_ORIGIN,
};

/** Paths requested per origin that no operation declares, so the 404 answer is established rather than assumed. */
const CONTROLS: readonly string[] = [`/v1/${SYNTHETIC}`, `/v1/${SYNTHETIC}/${SYNTHETIC}`, `/${SYNTHETIC}`];

/** Fail loudly. A probe that carries on past a broken assumption reports a corroboration nobody has. */
function refuse(message: string): never {
  process.stderr.write(`probeKnockSurface: ${message}\n`);
  process.exit(1);
}

/** What one unauthenticated request came back as: the status, and the service's own code or detail. */
async function ask({ url }: { url: string }): Promise<{ code: string; status: number }> {
  const response = await fetch(url, { redirect: "manual" });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { code: text.slice(0, 40), status: response.status };
  }
  if (!isRecord(parsed)) {
    return { code: "", status: response.status };
  }
  const errors = parsed["errors"];
  const detail = isRecord(errors) ? errors["detail"] : undefined;
  const code = parsed["code"] ?? detail;
  return { code: typeof code === "string" ? code : "", status: response.status };
}

/** What one answer establishes about one declared route. */
function evidenceOf({ api, code, status }: { api: KnockApi; code: string; status: number }): KnockProbeEvidence {
  if (status === 401 && code === KNOCK_AUTH_REFUSAL_CODES[api]) {
    return "exists-auth-required";
  }
  if (status === 404 && code === KNOCK_NOT_FOUND_DETAILS[api]) {
    return "absent-404";
  }
  return refuse(`an unexpected answer on the ${api} API: ${String(status)} "${code}"`);
}

/** Establish that each origin still answers an undeclared path the way this atlas's control expects. */
async function checkControls({ api }: { api: KnockApi }): Promise<void> {
  for (const path of CONTROLS) {
    const answer = await ask({ url: `${ORIGINS[api]}${path}` });
    if (answer.status !== 404 || answer.code !== KNOCK_NOT_FOUND_DETAILS[api]) {
      refuse(
        `the ${api} API's control ${path} answered ${String(answer.status)} "${answer.code}" rather than ` +
          `404 "${KNOCK_NOT_FOUND_DETAILS[api]}" — without a working control this probe establishes nothing`,
      );
    }
  }
}

/** Probe every declared GET, print what each established, and assert the census. */
async function main(): Promise<void> {
  const verify = process.argv.includes("--verify");
  const tally: Record<string, number> = {};
  for (const api of KNOCK_APIS) {
    await checkControls({ api });
  }
  for (const row of KNOCK_SURFACES) {
    if (row.method !== "GET") {
      tally["unprobed-mutating"] = (tally["unprobed-mutating"] ?? 0) + 1;
      continue;
    }
    const url = `${ORIGINS[row.api]}${row.path.replaceAll(/\{[^}]+\}/g, SYNTHETIC)}`;
    const answer = await ask({ url });
    const evidence = evidenceOf({ api: row.api, code: answer.code, status: answer.status });
    tally[`${row.api} ${evidence}`] = (tally[`${row.api} ${evidence}`] ?? 0) + 1;
    if (!verify) {
      process.stdout.write(`${evidence}\t${row.api}\t${row.method} ${row.path}\n`);
    }
  }
  const measured: Readonly<Record<string, number>> = {
    absent: (tally["data absent-404"] ?? 0) + (tally["management absent-404"] ?? 0),
    dataExists: tally["data exists-auth-required"] ?? 0,
    managementExists: tally["management exists-auth-required"] ?? 0,
    unprobedMutating: tally["unprobed-mutating"] ?? 0,
  };
  // Compared through a plain number map rather than by indexing one record type with the other's keys:
  // `no-unsafe-type-assertion` refuses that, and refuses correctly — a claim that two record types share a
  // key set is exactly the thing a census exists to CHECK. `controlsPerOrigin` is not a measurement and is
  // asserted by `checkControls` instead, so it is deliberately absent here.
  const pinned: Readonly<Record<string, number>> = KNOCK_PROBE_CENSUS;
  for (const [field, want] of Object.entries(measured)) {
    if (want !== (pinned[field] ?? -1)) {
      refuse(`${field} measured ${String(want)}, and KNOCK_PROBE_CENSUS says ${String(pinned[field] ?? -1)}`);
    }
  }
  process.stdout.write(
    `probeKnockSurface: ${String(measured["dataExists"]! + measured["managementExists"]!)} declared GET(s) confirmed to ` +
      `exist, ${String(measured["absent"])} absent, ${String(measured["unprobedMutating"])} never requested\n`,
  );
}

void main();
