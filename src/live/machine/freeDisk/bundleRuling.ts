/**
 * Which applications this installation's owner ruled removable by `machine free-disk app`, and which kept.
 *
 * ## Why it lives outside the repository
 *
 * Which apps sit on one machine, and which its owner has ruled on, is one installation's fact, so it resolves
 * from `$SLOPWEAVER_HOME/machine/free-disk-bundles.json` — `AGENTS.md`'s "tools in the codebase, state outside
 * it". Nothing in this tree names an application.
 *
 * ## The file, and what its absence means
 *
 * `{ "removable": ["<Name>.app", …], "kept": ["<Name>.app", …] }`, strict. An absent file rules nothing
 * removable, so every `--bundle` is refused as not approved; that is absence by design. A file that is there
 * and malformed is a different refusal, never read as empty.
 */
import { z } from "zod";

import { readStrictFileIfPresent } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { stateHomePaths } from "../../../stateHome.js";
import { type FreeDiskError, FreeDiskErrors } from "./errors.js";

/** An application bundle's file name: no path, ending `.app`. */
const bundleName = z
  .string()
  .min(5)
  .refine((name) => name.endsWith(".app") && !name.includes("/"), {
    message: "a bundle name ending .app, never a path",
  });

const bundleRulingSchema = z.strictObject({
  kept: z.array(bundleName),
  removable: z.array(bundleName),
});

/** The owner's ruling over which application bundles may go to the Trash. */
export interface BundleRuling {
  readonly removable: readonly string[];
  readonly kept: readonly string[];
}

/** A ruling that names nothing: what an absent file means. */
const NO_RULING: BundleRuling = { kept: [], removable: [] };

/**
 * Parse the ruling file's text.
 *
 * @param path where the text was read, for the refusal
 * @returns the ruling, or the refusal naming what is wrong with it
 */
export function parseBundleRuling({ text, path }: { text: string; path: string }): Result<BundleRuling, FreeDiskError> {
  let json: unknown;
  try {
    json = safeJsonParse({ label: path, text });
  } catch {
    return err(FreeDiskErrors.bundleRulingInvalid({ path, why: "it is not JSON" }));
  }
  const parsed = bundleRulingSchema.safeParse(json);
  if (!parsed.success) {
    return err(FreeDiskErrors.bundleRulingInvalid({ path, why: parsed.error.issues[0]!.message }));
  }
  return ok(parsed.data);
}

/**
 * Read the owner's bundle ruling from a state home; an absent file rules nothing removable.
 *
 * @param home the state home the ruling is read from
 * @returns the ruling, or the read or parse that failed
 */
export function readBundleRuling({ home }: { home: string }): Result<BundleRuling, FreeDiskError> {
  const path = stateHomePaths({ home }).freeDiskBundlesJson;
  const read = readStrictFileIfPresent({ operation: "read free-disk bundle ruling", path });
  if (read.isErr()) {
    return err(FreeDiskErrors.readFailed({ cause: read.error, path }));
  }
  if (read.value === null) {
    return ok(NO_RULING);
  }
  return parseBundleRuling({ path, text: read.value });
}
