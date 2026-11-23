/*
 * The secret-shaped fixtures more than one `file_read` redaction test file reads: a Slack token and a GitHub
 * token. Each is assembled at run time, so this file is not itself a hit for the hygiene gate those tests
 * exercise. A plain module, not a `*.test.ts`, so no test registers twice. It was split out when the redaction
 * suite became one file per behaviour.
 */

/** A Slack bot token's shape, read by the token-shape and surviving-secret cases. */
export const SLACK: string = [["xo", "xb"].join(""), "1234567890", "0987654321abcdef"].join("-");

/** A GitHub personal access token's shape, read by the token-shape and window cases. */
export const GITHUB: string = `${["gh", "p_"].join("")}${"A1".repeat(18)}`;
