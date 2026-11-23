/**
 * Re-measure everything an UNAUTHENTICATED request can establish about the Hex API, and refuse when a
 * committed row disagrees.
 *
 * ```bash
 * yarn tsx tools/probeHexApiSurface.ts            # print the census
 * yarn tsx tools/probeHexApiSurface.ts --verify   # exit non-zero if any row moved
 * ```
 *
 * ## Only GETs, and only to nouns
 *
 * Every request is a `GET` to `/api/v1/<one segment>`. Nothing is sent to a nested path, nothing is sent
 * with a body, and no method other than `GET` is ever used — an unauthenticated `DELETE` sent to find out
 * what happens is a write attempt whatever it returns.
 *
 * ## Two controls, and the second must FAIL to discriminate
 *
 * `apiProbe.ts` carries the reasoning. `HEX_ABSENCE_CONTROL` is an invented noun that must answer 404, or a
 * 401 anywhere else means nothing. `HEX_DEPTH_CONTROL` is an invented path NESTED under a mounted noun that
 * must answer 401 — because the router authenticates a subtree before routing within it, which is exactly
 * what bounds this method to noun level. If the depth control ever starts answering 404, Hex has begun
 * discriminating deeper and a path-level inventory becomes compilable for the first time. Both directions
 * are refusals here, because both are the day somebody has to look.
 */
import {
  HEX_ABSENCE_CONTROL,
  HEX_API_ORIGIN,
  HEX_API_PREFIX,
  HEX_DEPTH_CONTROL,
  HEX_PROBE_CENSUS,
  hexProbeEvidenceFor,
} from "../src/atlas/hex/apiProbe.js";

/** Everything that disagreed with a committed row, collected so one run reports them all. */
const disagreements: string[] = [];

/** Fail loudly. */
function refuse({ message }: { message: string }): never {
  process.stderr.write(`probeHexApiSurface: ${message}\n`);
  process.exit(1);
}

/** One unauthenticated GET's status, following nothing. */
async function statusOf({ path }: { path: string }): Promise<number> {
  const response = await fetch(`${HEX_API_ORIGIN}${HEX_API_PREFIX}/${path}`, { redirect: "manual" });
  await response.text();
  return response.status;
}

/**
 * Probe every noun and both controls, and report or refuse.
 *
 * @returns nothing; the process exits non-zero on a disagreement under `--verify`
 */
async function main(): Promise<void> {
  const absence = hexProbeEvidenceFor({ status: await statusOf({ path: HEX_ABSENCE_CONTROL }) });
  if (absence !== "absent-404") {
    refuse({
      message: `the absence control \`${HEX_ABSENCE_CONTROL}\` answered ${absence} rather than absent-404, so nothing this run measured discriminates. Nothing was reported`,
    });
  }
  const depth = hexProbeEvidenceFor({ status: await statusOf({ path: HEX_DEPTH_CONTROL }) });
  if (depth !== "mounted-401") {
    refuse({
      message: `the depth control \`${HEX_DEPTH_CONTROL}\` answered ${depth} rather than mounted-401. The router has begun discriminating below the first segment, which means a PATH-level inventory is now compilable and \`apiProbe.ts\`'s stated bound is out of date`,
    });
  }

  for (const row of HEX_PROBE_CENSUS) {
    const evidence = hexProbeEvidenceFor({ status: await statusOf({ path: row.noun }) });
    if (evidence !== row.evidence) {
      disagreements.push(`${row.noun}: committed ${row.evidence}, served ${evidence}`);
    }
  }

  const mounted = HEX_PROBE_CENSUS.filter((row) => row.evidence === "mounted-401").length;
  process.stdout.write(
    `probeHexApiSurface: ${String(mounted)} of ${String(HEX_PROBE_CENSUS.length)} nouns mounted; both controls held\n`,
  );
  if (disagreements.length === 0) {
    return;
  }
  if (process.argv.includes("--verify")) {
    refuse({ message: `${String(disagreements.length)} row(s) moved:\n  ${disagreements.join("\n  ")}` });
  }
  process.stdout.write(`  ${String(disagreements.length)} row(s) moved:\n    ${disagreements.join("\n    ")}\n`);
}

await main();
