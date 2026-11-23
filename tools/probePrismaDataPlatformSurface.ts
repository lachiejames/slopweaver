/**
 * Re-measure everything an UNAUTHENTICATED request can establish about this platform, and refuse when a
 * committed row disagrees.
 *
 * ```bash
 * yarn tsx tools/probePrismaDataPlatformSurface.ts              # all three origins
 * yarn tsx tools/probePrismaDataPlatformSurface.ts --api        # the management API's declared GETs
 * yarn tsx tools/probePrismaDataPlatformSurface.ts --console    # console.prisma.io
 * yarn tsx tools/probePrismaDataPlatformSurface.ts --auth       # auth.prisma.io
 * yarn tsx tools/probePrismaDataPlatformSurface.ts --verify     # exit non-zero if any row moved
 * ```
 *
 * ## Only GETs, on purpose
 *
 * The management API's 61 mutating operations are never requested, not even to establish that they exist.
 * This atlas only ever reads, and an unauthenticated `DELETE` sent to find out what happens is a write
 * attempt whatever it returns. `apiProbe.ts` records them as `unprobed-mutating` so the absence is a
 * declared state rather than a silence.
 *
 * ## Each origin has its own control, and one of them is inverted
 *
 * `api.prisma.io` and `auth.prisma.io` answer 404 to an invented path, so their controls must FAIL for the
 * method to mean anything. `console.prisma.io` answers the same `302 → /login` to an invented path as to a
 * real one, so its control must AGREE with the real routes — and if it ever stops agreeing, the console has
 * begun discriminating and a real route inventory becomes compilable for the first time. Both directions
 * are refusals here, because both are the day somebody has to look.
 */
import {
  PRISMA_PROBE_CENSUS,
  PRISMA_PROBE_CONTROLS,
  type PrismaProbeEvidence,
  prismaProbeEvidenceFor,
} from "../src/atlas/prismaDataPlatform/apiProbe.js";
import {
  PRISMA_AUTH_CONTROL,
  PRISMA_AUTH_ENDPOINTS,
  PRISMA_AUTH_ORIGIN,
  type PrismaAuthEvidence,
} from "../src/atlas/prismaDataPlatform/authEndpoints.js";
import {
  PRISMA_CONSOLE_CANDIDATES,
  PRISMA_CONSOLE_CONTROL,
  PRISMA_CONSOLE_MANIFEST,
  PRISMA_CONSOLE_ORIGIN,
  PRISMA_CONSOLE_ROUTES,
} from "../src/atlas/prismaDataPlatform/consoleRoutes.js";
import { PRISMA_SPEC_PIN } from "../src/atlas/prismaDataPlatform/generated/specLock.js";
import { PRISMA_DATA_PLATFORM_SURFACES } from "../src/atlas/prismaDataPlatform/generated/surfaces.js";
import { isRecord } from "../src/lib/parsers.js";

/** What every `{brace}` path segment becomes. Obviously synthetic, so no request reaches a real resource. */
const SYNTHETIC = "zzzsynthetic";

/** Everything that disagreed with a committed row, collected so one run reports them all. */
const disagreements: string[] = [];

/** Fail loudly. */
function refuse(message: string): never {
  process.stderr.write(`probePrismaDataPlatformSurface: ${message}\n`);
  process.exit(1);
}

/** One path template with every parameter replaced by an obviously synthetic segment. */
function concretePath({ path }: { path: string }): string {
  return path
    .split("/")
    .map((segment) => (segment.startsWith("{") ? SYNTHETIC : segment))
    .join("/");
}

/** One unauthenticated GET's status, following nothing. */
async function statusOf({ url }: { url: string }): Promise<{ location: string; status: number }> {
  const response = await fetch(url, { redirect: "manual" });
  return { location: response.headers.get("location") ?? "", status: response.status };
}

/** Which class one management-API answer falls into. */
function apiEvidenceOf({ status }: { status: number }): PrismaProbeEvidence {
  if (status === 404) {
    return "absent-404";
  }
  if (status === 401) {
    return "exists-auth-required";
  }
  if (status === 422) {
    return "exists-validation-first";
  }
  return "exists-unauthenticated";
}

/** Probe every declared GET against three controls that must answer 404. */
async function probeApi(): Promise<void> {
  for (const control of PRISMA_PROBE_CONTROLS) {
    const { status } = await statusOf({ url: `${PRISMA_SPEC_PIN.server}${control}` });
    if (status !== 404) {
      refuse(
        `the control ${control} answered ${String(status)} rather than 404, so no other answer on ` +
          "api.prisma.io proves anything. Re-derive the method before trusting any row",
      );
    }
  }
  const gets = PRISMA_DATA_PLATFORM_SURFACES.filter((row) => row.method === "GET");
  if (gets.length !== PRISMA_PROBE_CENSUS.probedGets) {
    refuse(
      `the registry now holds ${String(gets.length)} GET operations, pinned ${String(PRISMA_PROBE_CENSUS.probedGets)}` +
        " — regenerate the registry and update PRISMA_PROBE_CENSUS in the same commit",
    );
  }
  for (const row of gets) {
    const { status } = await statusOf({ url: `${PRISMA_SPEC_PIN.server}${concretePath({ path: row.path })}` });
    const found = apiEvidenceOf({ status });
    process.stdout.write(`${row.path.padEnd(96)} ${found}\n`);
    const pinned = prismaProbeEvidenceFor({ method: row.method, path: row.path });
    if (found !== pinned) {
      disagreements.push(`  GET ${row.path}: apiProbe.ts says ${pinned}, probe says ${found}`);
    }
  }
  process.stdout.write(
    `all ${String(PRISMA_PROBE_CONTROLS.length)} controls answered 404, so every answer above is evidence\n`,
  );
}

/** Which class one authorization-server answer falls into. */
function authEvidenceOf({ status }: { status: number }): PrismaAuthEvidence {
  if (status === 404) {
    return "absent-404";
  }
  if (status === 405) {
    return "method-not-allowed-405";
  }
  if (status === 400) {
    return "rejects-400";
  }
  return "serves-200";
}

/** Probe every authorization-server endpoint against a control that must answer 404. */
async function probeAuth(): Promise<void> {
  const control = await statusOf({ url: `${PRISMA_AUTH_ORIGIN}${PRISMA_AUTH_CONTROL}` });
  if (control.status !== 404) {
    refuse(
      `the control ${PRISMA_AUTH_CONTROL} answered ${String(control.status)} rather than 404, so no other ` +
        "answer on auth.prisma.io proves anything",
    );
  }
  for (const endpoint of PRISMA_AUTH_ENDPOINTS) {
    const { status } = await statusOf({ url: `${PRISMA_AUTH_ORIGIN}${endpoint.path}` });
    const found = authEvidenceOf({ status });
    process.stdout.write(`${endpoint.path.padEnd(48)} ${found}\n`);
    if (found !== endpoint.evidence) {
      disagreements.push(`  ${endpoint.path}: authEndpoints.ts says ${endpoint.evidence}, probe says ${found}`);
    }
  }
}

/**
 * Whether one console answer is the sign-in redirect every path gets.
 *
 * The `Location` is compared after resolving it against the origin, because the console sends a RELATIVE
 * `/login` and a string comparison against the absolute form would call every real answer a difference —
 * which, on the one origin whose control is supposed to AGREE, would fire the refusal on every run.
 */
function isLoginRedirect({ location, status }: { location: string; status: number }): boolean {
  if (status !== 302 || location.length === 0) {
    return false;
  }
  return new URL(location, PRISMA_CONSOLE_ORIGIN).href === `${PRISMA_CONSOLE_ORIGIN}/login`;
}

/** How many route entries the signed-out page's own manifest declares. */
async function consoleManifestEntries(): Promise<{ ids: readonly string[]; total: number }> {
  const page = await fetch(PRISMA_CONSOLE_MANIFEST.servedFrom);
  if (!page.ok) {
    refuse(`${PRISMA_CONSOLE_MANIFEST.servedFrom} answered ${String(page.status)}`);
  }
  const html = await page.text();
  const assignment = html.indexOf(`${PRISMA_CONSOLE_MANIFEST.global} = `);
  if (assignment < 0) {
    refuse(
      `${PRISMA_CONSOLE_MANIFEST.servedFrom} no longer assigns ${PRISMA_CONSOLE_MANIFEST.global}. The console` +
        " has changed framework or build, so what a signed-out client is told about the route tree has to be" +
        " re-derived before consoleRoutes.ts can be trusted",
    );
  }
  const start = html.indexOf("{", assignment);
  let depth = 0;
  let end = start;
  for (let at = start; at < html.length; at += 1) {
    if (html[at] === "{") {
      depth += 1;
    } else if (html[at] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = at + 1;
        break;
      }
    }
  }
  const parsed: unknown = JSON.parse(html.slice(start, end));
  const routes = isRecord(parsed) ? parsed["routes"] : undefined;
  if (!isRecord(routes)) {
    return refuse("the route manifest carries no `routes` object");
  }
  return { ids: Object.keys(routes).toSorted(), total: Object.keys(routes).length };
}

/** Probe the console, whose control must AGREE with every real route. See this file's header. */
async function probeConsole(): Promise<void> {
  const control = await statusOf({ url: `${PRISMA_CONSOLE_ORIGIN}${PRISMA_CONSOLE_CONTROL}` });
  if (!isLoginRedirect(control)) {
    refuse(
      `the control ${PRISMA_CONSOLE_CONTROL} answered ${String(control.status)} → ${control.location} rather ` +
        "than the sign-in redirect. console.prisma.io has begun discriminating between real and invented" +
        " paths, which means a real route inventory can now be compiled without signing in — re-derive" +
        " src/atlas/prismaDataPlatform/consoleRoutes.ts, which currently records that it cannot be",
    );
  }
  for (const candidate of PRISMA_CONSOLE_CANDIDATES) {
    const answer = await statusOf({ url: `${PRISMA_CONSOLE_ORIGIN}${candidate}` });
    const found = isLoginRedirect(answer) ? "indistinguishable-from-control" : `DISTINGUISHABLE ${answer.status}`;
    process.stdout.write(`${candidate.padEnd(32)} ${found}\n`);
    if (!isLoginRedirect(answer)) {
      disagreements.push(
        `  ${candidate}: consoleRoutes.ts holds it as a candidate the probe cannot see, and it answered ` +
          `${String(answer.status)} — promote it to PRISMA_CONSOLE_ROUTES with the evidence class it earned`,
      );
    }
  }
  for (const route of PRISMA_CONSOLE_ROUTES.filter((row) => row.evidence !== "manifest-declared")) {
    const answer = await statusOf({ url: `${PRISMA_CONSOLE_ORIGIN}${route.route}` });
    process.stdout.write(`${route.route.padEnd(32)} ${String(answer.status)} (pinned ${route.evidence})\n`);
    const stillDistinct = !isLoginRedirect(answer);
    if (!stillDistinct) {
      disagreements.push(
        `  ${route.route}: pinned ${route.evidence}, and it now answers the same sign-in redirect as the ` +
          "control — it is no longer distinguishable, so the row has lost its evidence",
      );
    }
  }
  const manifest = await consoleManifestEntries();
  process.stdout.write(`route manifest: ${String(manifest.total)} entries — ${manifest.ids.join(", ")}\n`);
  if (manifest.total !== PRISMA_CONSOLE_MANIFEST.declaredEntries) {
    disagreements.push(
      `  the signed-out route manifest declares ${String(manifest.total)} entries, pinned ` +
        `${String(PRISMA_CONSOLE_MANIFEST.declaredEntries)} — if it grew, the console now tells an anonymous ` +
        "client about routes it used to hide, and a real inventory is compilable",
    );
  }
}

/** Run whichever origins were asked for, and refuse if verifying and anything moved. */
async function main(): Promise<void> {
  const argv = new Set(process.argv.slice(2));
  const all = !argv.has("--api") && !argv.has("--console") && !argv.has("--auth");
  if (all || argv.has("--api")) {
    await probeApi();
  }
  if (all || argv.has("--auth")) {
    await probeAuth();
  }
  if (all || argv.has("--console")) {
    await probeConsole();
  }
  if (argv.has("--verify") && disagreements.length > 0) {
    process.stderr.write(
      `probePrismaDataPlatformSurface: ${String(disagreements.length)} row(s) moved:\n` +
        `${disagreements.join("\n")}\nupdate the committed module in the same commit, with the new ` +
        "measurement date\n",
    );
    process.exit(1);
  }
  process.stdout.write(`${String(disagreements.length)} disagreement(s) with the committed rows\n`);
}

void main();
