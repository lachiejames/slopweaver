/**
 * Read an installation's data-class rules from its state home, composed with the defaults. The one effectful leaf
 * of the sorter (`./dataClassRules.ts`): a file read, then the pure parse.
 *
 * Absent is a fact, not a fault: a fresh home has no rules of its own and gets the defaults. A file that exists
 * and cannot be read, is not JSON, or is not a valid rule set refuses the WHOLE file and returns the error, never a
 * partial or default-only set, because a store written under rules the owner did not mean is a classification
 * nobody can see is wrong. Every installation-specific value (a handle, a channel) lives in that file, never here.
 */
import { readFileSync } from "node:fs";

import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";

import {
  composeDataClassRules,
  type DataClassRule,
  type DataClassRulesError,
  DataClassRulesErrors,
  parseDataClassRules,
} from "./dataClassRules.js";

/**
 * Load the rules the sorter reads: the installation's own, then the defaults.
 *
 * @param home the Slopweaver home to read under; the ambient one when absent
 * @param readText reads a file's text; a test supplies one, production reads the disk
 * @returns the composed rules, or why the installation's file refuses
 */
export function loadDataClassRules({
  home,
  readText = ({ path }) => readFileSync(path, "utf8"),
}: {
  home?: string;
  readText?: (args: { path: string }) => string;
} = {}): Result<readonly DataClassRule[], DataClassRulesError> {
  const path = stateHomePaths(home === undefined ? {} : { home }).judgement.dataClassRulesJson;
  let text: string;
  try {
    text = readText({ path });
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok(composeDataClassRules({ installation: [] }));
    }
    return err(
      DataClassRulesErrors.unreadable({ detail: error instanceof Error ? error.message : String(error), path }),
    );
  }
  const json = parseJson({ text });
  if (json.isErr()) {
    return err(DataClassRulesErrors.notJson({ detail: json.error.message, path }));
  }
  return parseDataClassRules({ path, value: json.value }).map((installation) =>
    composeDataClassRules({ installation }),
  );
}
