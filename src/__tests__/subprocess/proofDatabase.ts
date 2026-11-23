/**
 * A throwaway, freshly migrated store database for a subprocess-lane file that spawns the shipped CLI against a REAL
 * store. Handed the local stack's (or CI's service's) ADMIN connection in `STORE_PROOF_ADMIN_URL`, it creates one
 * template per file, migrates it once with the production migrator, copies it into a fresh database per case, and
 * drops all of them afterwards; it never touches the database the admin URL itself names.
 *
 * REQUIRED in CI and opt-in locally, the `profileSteersContract.test.ts` precedent: {@link proofAdminUrl} throws at
 * collection when `CI=true` and the URL is unset, so a lane that lost the service reads red rather than skipped.
 * Locally:
 *
 *   STORE_PROOF_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/identity/identityRosterCli.test.ts
 */
import { randomUUID } from "node:crypto";

import postgres from "postgres";

import { unwrap } from "../../lib/result.js";
import { applyStore } from "../../store/migrate.js";

/** The variable naming the admin connection this helper creates its databases through. */
const PROOF_ADMIN_URL_ENV = "STORE_PROOF_ADMIN_URL";

/**
 * The admin connection, or `undefined` when the lane runs without one — which CI never may.
 *
 * @returns the admin URL a describe block passes to {@link openProofDatabase}, or `undefined` to skip locally
 */
export function proofAdminUrl(): string | undefined {
  const url = process.env[PROOF_ADMIN_URL_ENV];
  if (process.env["CI"] === "true" && url === undefined) {
    throw new Error(
      `${PROOF_ADMIN_URL_ENV} is unset in CI: the subprocess job's Postgres service is what a real-store proof runs on, so a lane without it must fail rather than skip`,
    );
  }
  return url;
}

/** One migrated throwaway database: the URL a spawned verb is handed, and how to drop it. */
export interface ProofDatabase {
  /** The connection a spawned verb receives as `SLOPWEAVER_STORE_URL`. */
  readonly storeUrl: string;
  /** Drop the database, forcing off any connection a spawned verb left open. */
  readonly drop: () => Promise<void>;
}

/** One file's migrated template: each case copies it rather than re-running every migration. */
export interface ProofTemplate {
  /** Copy the template into a fresh database for one case. */
  readonly open: () => Promise<ProofDatabase>;
  /** Drop the template and close the admin connection, once every case's copy is dropped. */
  readonly drop: () => Promise<void>;
}

/** The URL naming `database` on the admin connection's server. */
function databaseUrl({ adminUrl, database }: { adminUrl: string; database: string }): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Create and migrate one template database beside the one the admin URL names. Each case then copies it with
 * `create database … template`, which copies files and runs no migration, so a file with five cases migrates once
 * instead of five times, and every case still starts from a fresh, fully migrated store.
 *
 * @param adminUrl the admin connection {@link proofAdminUrl} returned
 * @param prefix the database names' prefix, a lower-case identifier naming the file that owns them
 * @returns the template, whose `open` hands one case its own database
 */
export async function openProofTemplate({
  adminUrl,
  prefix,
}: {
  adminUrl: string;
  prefix: string;
}): Promise<ProofTemplate> {
  const template = `${prefix}_${randomUUID().slice(0, 8)}_template`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${template}`);
  // `applyStore` ends its own connection, so nothing holds the template open when a case copies it.
  unwrap(await applyStore({ url: databaseUrl({ adminUrl, database: template }) }));
  return {
    drop: async () => {
      await admin.unsafe(`drop database if exists ${template} with (force)`);
      await admin.end();
    },
    open: async () => {
      const database = `${prefix}_${randomUUID().slice(0, 8)}`;
      await admin.unsafe(`create database ${database} template ${template}`);
      return {
        drop: async () => {
          await admin.unsafe(`drop database if exists ${database} with (force)`);
        },
        storeUrl: databaseUrl({ adminUrl, database }),
      };
    },
  };
}
