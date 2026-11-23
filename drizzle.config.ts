/**
 * How `drizzle-kit` finds the schema and where it writes migrations.
 *
 * The schema path is the BARREL rather than the directory, so the migrations drizzle-kit generates and
 * the types the query layer is built from come from one module. Pointing it at `schema/*.ts` would let a
 * table exist in a migration and not in the barrel, which is the drift this file's placement prevents.
 *
 * The connection string is read from the environment and has no default, for the reason `migrate.ts`
 * gives: a tool that picks its own database is a tool that can run against the wrong one.
 *
 * It is the one reader of `SLOPWEAVER_STORE_URL` outside `src/store/config.ts`, so it repeats that file's
 * local-only rule rather than leave drizzle-kit a way to a remote host: the owner's ruling is that the store is
 * always a local database on this machine, with no escape hatch. A blank value stays allowed, because
 * `src/store/generate.ts` runs `drizzle-kit generate` with it blank and no connection is made. The loopback set
 * mirrors `isLocalStoreUrl` (`src/store/localStoreUrl.ts`), kept inline so this config imports nothing from
 * `src/`. That function also asks postgres.js which hosts a string names; this file cannot know which driver
 * drizzle-kit picks, so it refuses every shape where a driver and the URL standard can disagree instead: a host
 * list (a comma), a second `@` or a `#` in the authority, and a `host` or `hostaddr` parameter.
 */
import { defineConfig } from "drizzle-kit";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/**
 * The connection string, refused when it names a host that is not this machine.
 *
 * @param url the raw environment value, blank when generation runs without a database
 * @returns the value unchanged when blank or loopback
 */
function localStoreUrl({ url }: { url: string }): string {
  if (url.trim() === "") {
    return url;
  }
  const parsed = URL.canParse(url) ? new URL(url) : null;
  const host = parsed === null ? "(unparseable)" : parsed.hostname;
  // The span a postgres client reads its host from: after `://`, up to the first `/` or `?`. `split` always
  // yields at least one element, so the first is there.
  const authority = url.slice(url.indexOf("://") + 3).split(/[?/]/u)[0]!;
  const ambiguous =
    authority.includes(",") ||
    authority.includes("#") ||
    authority.split("@").length > 2 ||
    parsed?.searchParams.has("host") === true ||
    parsed?.searchParams.has("hostaddr") === true;
  if (!LOOPBACK_HOSTS.has(host) || ambiguous) {
    throw new Error(
      `drizzle-kit refuses SLOPWEAVER_STORE_URL: it names host ${host}, or a host list or host parameter a driver ` +
        `could read differently, and only this machine is allowed. The store is always a local database on this ` +
        `machine, the owner's hard rule, and no escape hatch opens this.`,
    );
  }
  return url;
}

export default defineConfig({
  dbCredentials: { url: localStoreUrl({ url: process.env["SLOPWEAVER_STORE_URL"] ?? "" }) },
  dialect: "postgresql",
  out: "./supabase/migrations",
  schema: "./src/store/schema.ts",
  strict: true,
  verbose: true,
});
