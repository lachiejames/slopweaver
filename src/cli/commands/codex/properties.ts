/** Where `codex review`'s properties come from: `--property` inline, or every entry of `--properties-file`. */
import { readFileSync } from "node:fs";

import type { ReviewProperty } from "../../../codex/types.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import { type CodexReviewOptions, validatePropertiesFile } from "./core.js";
import { type CodexCommandError, CodexCommandErrors, codexCommandErrorLines } from "./errors.js";

/** What {@link resolveProperties} answers: the properties to review, or why there are none. */
export type PropertiesRead = Result<readonly ReviewProperty[], CodexCommandError>;

/**
 * The properties to review: the inline one, or every entry of the supplied file.
 *
 * @returns the properties, or the {@link CodexCommandError} saying why there are none
 */
export function resolveProperties({ options }: { options: CodexReviewOptions }): PropertiesRead {
  if (options.property !== undefined) {
    return ok([options.property]);
  }
  if (options.propertiesFile === undefined) {
    return err(CodexCommandErrors.noPropertySource());
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(options.propertiesFile, "utf8"));
  } catch (error: unknown) {
    return err(CodexCommandErrors.propertiesFileUnreadable({ cause: error, path: options.propertiesFile }));
  }
  return validatePropertiesFile({ parsed });
}

/**
 * {@link resolveProperties} for the `codex review` shell: the properties, or every line of why there are none
 * logged and the usage exit code returned.
 *
 * @returns the properties to review, or `EXIT_USAGE` once the refusal has been printed
 */
export function propertiesOrExit({ options }: { options: CodexReviewOptions }): readonly ReviewProperty[] | number {
  const properties = resolveProperties({ options });
  if (properties.isOk()) {
    return properties.value;
  }
  for (const line of codexCommandErrorLines({ error: properties.error })) {
    logger.error({ msg: line });
  }
  return EXIT_USAGE;
}
