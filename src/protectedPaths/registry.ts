/**
 * The owner-protected path registry — `$SLOPWEAVER_HOME/protected-paths.json`.
 *
 * Every install has paths its owner does not want an agent session to touch, and which they are is that owner's
 * business: so the PATHS live here, in the state home, and never in the repository. What the codebase carries is
 * the mechanism — this parser, the pure decision in `./decide.ts`, the `PreToolUse` guard
 * (`../admit/protectedPathGuard.ts`) and the verbs that refuse a protected path (`slopweaver protect`, `talk file`).
 *
 * ## The shape
 *
 * ```json
 * { "schemaVersion": 1,
 *   "paths": [{ "path": "/absolute/path", "mode": "read-only", "why": "…", "addedIso": "<ISO 8601 instant>" }] }
 * ```
 *
 * `mode` is `read-only` (a session may read it and never write it) or `no-access` (neither). `path` is stored
 * absolute and normalised: `protect add` expands a `~` before it writes, so nothing downstream expands one.
 *
 * ## Absent is empty; malformed is an error, never empty
 *
 * A home with no file protects nothing, which is the right state for a fresh install. A file that will not parse
 * is the owner's protection in an unknown state, so it is a typed error the caller has to decide about — the guard
 * fails open on it (a tripwire that failed closed would wedge every tool call) and `protect list` reports it.
 */
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";

/** The two protection modes. */
export const PROTECTION_MODES = ["read-only", "no-access"] as const;

/** How strongly one path is protected. */
export type ProtectionMode = (typeof PROTECTION_MODES)[number];

/** One protected path, as the registry holds it. */
export interface ProtectedPath {
  /** The absolute, normalised path; a directory protects everything under it. */
  readonly path: string;
  /** What a session may not do there. */
  readonly mode: ProtectionMode;
  /** The owner's reason, printed in every refusal. */
  readonly why: string;
  /** When it was added. */
  readonly addedIso: string;
}

/** The registry document. */
export interface ProtectedPathRegistry {
  readonly schemaVersion: 1;
  readonly paths: readonly ProtectedPath[];
}

const ENTRY_SCHEMA = z
  .object({
    addedIso: z.iso.datetime(),
    mode: z.enum(PROTECTION_MODES),
    path: z
      .string()
      .min(1)
      .refine((value) => isAbsolute(value), { message: "a protected path is stored absolute" }),
    why: z.string().min(1),
  })
  .strict();

/** The most entries a registry holds: a list a person keeps by hand, never data. */
const MAX_ENTRIES = 500;

const REGISTRY_SCHEMA = z
  .object({
    // Two entries for one path make `remove` and a mode change ambiguous, so the registry refuses them.
    paths: z
      .array(ENTRY_SCHEMA)
      .max(MAX_ENTRIES)
      .refine((paths) => new Set(paths.map((entry) => resolve(entry.path).toLowerCase())).size === paths.length, {
        message: "a path is listed more than once",
      }),
    schemaVersion: z.literal(1),
  })
  .strict();

/** The registry could not be read, so the owner's protection is in an unknown state. */
interface RegistryUnreadableError {
  readonly code: "REGISTRY_UNREADABLE";
  readonly message: string;
  readonly file: string;
}

/** The registry was read and is not the shape above. */
interface RegistryMalformedError {
  readonly code: "REGISTRY_MALFORMED";
  readonly message: string;
  readonly file: string;
}

/** Why a registry yielded no entries it could vouch for. */
export type ProtectedPathsError = RegistryUnreadableError | RegistryMalformedError;

/** The factory for {@link ProtectedPathsError}. */
const ProtectedPathsErrors = {
  malformed: ({ file, why }: { file: string; why: string }): RegistryMalformedError => ({
    code: "REGISTRY_MALFORMED",
    file,
    message: `${file} is not a protected-path registry (${why}) — fix it with \`slopweaver protect\`, never by hand`,
  }),
  unreadable: ({ file, cause }: { file: string; cause: unknown }): RegistryUnreadableError => ({
    code: "REGISTRY_UNREADABLE",
    file,
    message: `${file} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
} as const;

/**
 * Parse a registry's text.
 *
 * @param text the file's contents
 * @param file the path it came from, named in an error
 * @returns the registry, or why it is not one
 */
export function parseProtectedPaths({
  text,
  file,
}: {
  text: string;
  file: string;
}): Result<ProtectedPathRegistry, ProtectedPathsError> {
  let raw: unknown;
  try {
    raw = safeJsonParse({ label: "protected-paths registry", text });
  } catch (cause) {
    return err(ProtectedPathsErrors.malformed({ file, why: cause instanceof Error ? cause.message : String(cause) }));
  }
  const parsed = REGISTRY_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const why = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return err(ProtectedPathsErrors.malformed({ file, why }));
  }
  return ok({
    // `resolve`, not `normalize`: it also drops a trailing separator, so `/a/b/` and `/a/b` are one path.
    paths: parsed.data.paths.map((entry) => ({ ...entry, path: resolve(entry.path) })),
    schemaVersion: 1,
  });
}

/**
 * Read the registry through an injected reader.
 *
 * @param file the registry's path
 * @param readText reads a file's text, `undefined` when there is no file there, and throws on any other failure
 * @returns the registry — empty when the file is absent — or why it could not be read
 */
export function readProtectedPaths({
  file,
  readText,
}: {
  file: string;
  readText: (args: { path: string }) => string | undefined;
}): Result<ProtectedPathRegistry, ProtectedPathsError> {
  let text: string | undefined;
  try {
    text = readText({ path: file });
  } catch (cause) {
    return err(ProtectedPathsErrors.unreadable({ cause, file }));
  }
  if (text === undefined) {
    return ok({ paths: [], schemaVersion: 1 });
  }
  return parseProtectedPaths({ file, text });
}

/**
 * The registry's text, as `protect` writes it: entries sorted by path, so a diff of the file reads as the change.
 *
 * @param registry the registry to render
 * @returns the JSON text, newline-terminated
 */
export function renderProtectedPaths({ registry }: { registry: ProtectedPathRegistry }): string {
  const paths = registry.paths.toSorted((a, b) => a.path.localeCompare(b.path));
  return `${safeJsonStringify({ label: "protected-paths registry", space: 2, value: { paths, schemaVersion: 1 } })}\n`;
}
