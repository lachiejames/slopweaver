/**
 * The seeded state the console's browser lane runs against: one migrated throwaway store database per RUN, holding a
 * synthetic organisation, and one throwaway `$SLOPWEAVER_HOME` per Playwright WORKER, holding a recorded GitHub
 * landing reading (so the Queue has rows without reading GitHub) and the walk's inert published page, published into
 * the run's store and its loopback Storage (`./fakeObjectStorage.ts`) and removed from both when the worker stops.
 *
 * Every write goes through the REAL CLI (`bin/slopweaver org set`, `reading record`) with an explicit `--home`, so
 * the console reads state exactly the shape the shipped verbs write it, and nothing here can land in the operator's
 * own home. The archive's suite seeded through test-only API endpoints; this repository's console has no API of its
 * own to seed through, so the verbs are the seam.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { z } from "zod";

import { type PublishedE2ePageFixture, publishE2ePageFixture } from "../../../desktop/e2ePageFixtureStore.js";
import { unwrap } from "../../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../../lib/safeJson.js";
import { STORE_URL_ENV } from "../../../store/config.js";
import { applyStore } from "../../../store/migrate.js";

/** The repository root, four directories above this file. */
export const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * The ADMIN connection the run creates its database through: CI's Postgres service, or locally the store stack's
 * (`postgresql://postgres:postgres@127.0.0.1:55322/postgres`). Required: a lane with no store cannot draw a console,
 * whose layout refuses every page until an organisation is set.
 */
const STORE_ADMIN_URL_ENV = "DESKTOP_E2E_STORE_ADMIN_URL";

/** Where global setup leaves the run's own database for the workers, which inherit its environment. */
export const RUN_STORE_URL_ENV = "DESKTOP_E2E_RUN_STORE_URL";

/** The bound on one seeding verb, each a local write that takes under 5s. */
const CLI_TIMEOUT_MS = 120_000;

/** The synthetic organisation every run's store holds (the hygiene gate's `acme`, never an installation's). */
const ORGANISATION_ARGS: readonly string[] = [
  "--display-name",
  "Acme",
  "--github-owner",
  "acme",
  "--without-google",
  "--slack-host",
  "acme.slack.com",
  "--without-linear",
  "--without-vanta",
  "--repository",
  "acme/slopweaver",
];

/** The committed synthetic landing reading the Queue draws (`site/fixtures/landing-reading/`). */
const LANDING_FIXTURE = join(REPOSITORY_ROOT, "site", "fixtures", "landing-reading", "2026-09-20.json");

/**
 * The part of a recorded reading's envelope the seed re-records: the verb's own printed document, its rows kept whole.
 * `loose` keeps every field this schema does not name, so the document is re-recorded as captured.
 */
const ReadingEnvelope = z.object({
  document: z.looseObject({ rows: z.array(z.record(z.string(), z.unknown())) }),
});

/**
 * The two row fields `github landing` added after the capture, which the Queue's reader requires
 * (`site/components/live/readLandingRow.ts`). Patched in memory, the way `site/__tests__/unit/readLanding.test.ts`
 * patches them, because the capture is re-taken rather than hand-edited.
 */
const ROW_FIELDS_SINCE_CAPTURE = { authorLogin: "acme-owner", createdAtIso: "2026-09-19T00:00:00Z" } as const;

/**
 * The admin connection, refused by name when unset.
 *
 * @returns the URL
 */
export function storeAdminUrl(): string {
  const url = process.env[STORE_ADMIN_URL_ENV];
  if (url === undefined || url === "") {
    throw new Error(
      `${STORE_ADMIN_URL_ENV} is unset: the console lane needs a Postgres admin connection to create its throwaway store (locally, postgresql://postgres:postgres@127.0.0.1:55322/postgres)`,
    );
  }
  return url;
}

/**
 * The URL naming one database on the admin connection's server.
 *
 * @param adminUrl the admin connection
 * @param database the database to name instead
 * @returns the URL
 */
function databaseUrl({ adminUrl, database }: { adminUrl: string; database: string }): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Run the checkout's own CLI, refusing on a non-zero exit with what it printed.
 *
 * @param args the arguments after `slopweaver`
 * @param env the child's whole environment
 * @returns what it printed to stdout
 */
function runCli({ args, env }: { args: readonly string[]; env: NodeJS.ProcessEnv }): string {
  const run = spawnSync(join(REPOSITORY_ROOT, "bin", "slopweaver"), args, {
    encoding: "utf8",
    env,
    timeout: CLI_TIMEOUT_MS,
  });
  if (run.status !== 0) {
    throw new Error(
      `slopweaver ${args.join(" ")} exited ${String(run.status)} (${String(run.signal)}):\n${run.stdout}\n${run.stderr}`,
    );
  }
  return run.stdout;
}

/** One run's store: its URL and how to drop it. */
export interface RunStore {
  readonly url: string;
  readonly drop: () => Promise<void>;
}

/**
 * Create, migrate and seed the run's store: the production migrator, then the real `org set`.
 *
 * @param adminUrl the admin connection
 * @param home a throwaway home `org set` runs under, so it reads nothing of the operator's
 * @returns the store
 */
export async function createRunStore({ adminUrl, home }: { adminUrl: string; home: string }): Promise<RunStore> {
  const database = `desktop_e2e_${randomUUID().slice(0, 8)}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${database}`);
  const url = databaseUrl({ adminUrl, database });
  unwrap(await applyStore({ url }));
  runCli({
    args: ["org", "set", ...ORGANISATION_ARGS, "--home", home],
    env: { ...process.env, SLOPWEAVER_HOME: home, SLOPWEAVER_STORE_URL: url },
  });
  return {
    drop: async () => {
      await admin.unsafe(`drop database if exists ${database} with (force)`);
      await admin.end();
    },
    url,
  };
}

/**
 * Run one in-process store operation against the run's store, whatever this process's environment named before. The
 * store resolves `SLOPWEAVER_STORE_URL` ahead of a home's own, so a developer's ambient value would otherwise send
 * the lane's fixture into a real store.
 *
 * @param storeUrl the run's store
 * @param run the operation
 * @returns what the operation answered
 */
export async function againstRunStore<T>({ storeUrl, run }: { storeUrl: string; run: () => Promise<T> }): Promise<T> {
  const previous = process.env[STORE_URL_ENV];
  process.env[STORE_URL_ENV] = storeUrl;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env[STORE_URL_ENV];
    } else {
      process.env[STORE_URL_ENV] = previous;
    }
  }
}

/**
 * Refuse unless the run's store holds no row of any published-page table for a slug, after its fixture was removed.
 *
 * @param storeUrl the run's store
 * @param slug the fixture's slug
 */
export async function assertFixtureRowsGone({ storeUrl, slug }: { storeUrl: string; slug: string }): Promise<void> {
  const sql = postgres(storeUrl, { max: 1, onnotice: () => {} });
  try {
    const [counted] = await sql<{ rows: number }[]>`
      select ((select count(*) from published_page where page_key = ${slug})
           + (select count(*) from published_page_file where page_key = ${slug})
           + (select count(*) from published_page_version where page_key = ${slug})
           + (select count(*) from published_page_alias where page_key = ${slug}))::int as rows`;
    if (counted!.rows !== 0) {
      throw new Error(`the run's store still holds ${String(counted!.rows)} row(s) of the fixture page ${slug}`);
    }
  } finally {
    await sql.end();
  }
}

/**
 * Seed one worker's home: the landing reading the Queue draws, recorded through `reading record` as true now, and the
 * inert page the viewer spec opens, published through the real publisher into the run's store and Storage.
 *
 * @param home the worker's throwaway home
 * @param storeUrl the run's store
 * @param nonce what makes the published page's slug this worker's own
 * @returns the published page fixture
 */
export async function seedWorkerHome({
  home,
  storeUrl,
  nonce,
}: {
  home: string;
  storeUrl: string;
  nonce: string;
}): Promise<PublishedE2ePageFixture> {
  const envelope = ReadingEnvelope.parse(
    safeJsonParse({ label: LANDING_FIXTURE, text: readFileSync(LANDING_FIXTURE, "utf8") }),
  );
  // The document `reading record --from` reads sits OUTSIDE the home: the home holds only what the verbs write.
  const scratch = mkdtempSync(join(tmpdir(), "sw-e2e-doc-"));
  const document = join(scratch, "landing-document.json");
  const patched = {
    ...envelope.document,
    rows: envelope.document.rows.map((row) => ({ ...row, ...ROW_FIELDS_SINCE_CAPTURE })),
  };
  try {
    writeFileSync(document, `${safeJsonStringify({ label: "landing document", value: patched })}\n`);
    recordLanding({ document, home, storeUrl });
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
  const published = await againstRunStore({
    run: () => publishE2ePageFixture({ home, nonce, nowIso: new Date().toISOString() }),
    storeUrl,
  });
  if (published.isErr()) {
    throw new Error(published.error.message);
  }
  return published.value;
}

/**
 * Record the patched landing document into a worker's home through the real `reading record`, true as of now.
 *
 * @param document the patched document's path
 * @param home the worker's throwaway home
 * @param storeUrl the run's store
 */
function recordLanding({ document, home, storeUrl }: { document: string; home: string; storeUrl: string }): void {
  runCli({
    args: [
      "reading",
      "record",
      "--producer",
      "github landing",
      "--from",
      document,
      "--by",
      "desktop-e2e",
      "--observed-at",
      new Date().toISOString(),
      "--home",
      home,
    ],
    env: { ...process.env, SLOPWEAVER_HOME: home, SLOPWEAVER_STORE_URL: storeUrl },
  });
}
