/**
 * The `audit publications` argv contract: the flags it accepts and the one parser that turns a tail into a validated
 * request, or every reason it is refused. Pure; the effectful shell is `./publicationsRun.ts`.
 */
import { SOURCE_REPOSITORY } from "../../../hygiene/ownRepository.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type PublicationExpectation, parsePublicationExpectation } from "../../../live/publicationAudit/expect.js";
import { collectRepeated, type FlagTailSpec, flagValueOr, parseFlagTail } from "../../optionParsers.js";

/** The flags this verb accepts; the help-truth ratchet reads them as `AUDIT_PUBLICATIONS_FLAG_NAMES`. */
const AUDIT_PUBLICATIONS_FLAGS = {
  boolean: ["fire", "json"],
  repeatable: ["expect"],
  value: ["by-session", "expect", "home", "repo"],
} as const satisfies FlagTailSpec;

/** Every accepted flag, with the `--` callers type. */
export const AUDIT_PUBLICATIONS_FLAG_NAMES: readonly string[] = [
  ...AUDIT_PUBLICATIONS_FLAGS.value,
  ...AUDIT_PUBLICATIONS_FLAGS.boolean,
].map((name) => `--${name}`);

/** What a valid invocation asks for. */
export interface AuditPublicationsOptions {
  readonly home: string | undefined;
  readonly owner: string;
  readonly repo: string;
  readonly json: boolean;
  readonly expectations: readonly PublicationExpectation[];
  /** Run the `publication-leak` monitor pass over the report once it is written, as this session. */
  readonly fireAs: string | undefined;
}

/**
 * Parse the `audit publications` tail.
 *
 * @param rest the argv tail after `audit publications`
 * @returns the validated request, or each reason it is refused
 */
export function parseAuditPublicationsArgs({ rest }: { rest: readonly string[] }): Result<AuditPublicationsOptions> {
  const parsed = parseFlagTail({ rest, spec: AUDIT_PUBLICATIONS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const named = flagValueOr({ fallback: SOURCE_REPOSITORY, name: "repo", parsed: parsed.value });
  const [owner, repo, ...extra] = named.split("/");
  if (owner === undefined || repo === undefined || owner === "" || repo === "" || extra.length > 0) {
    return err(["--repo takes owner/repo"]);
  }
  const reasons: string[] = [];
  const expectations: PublicationExpectation[] = [];
  for (const value of collectRepeated({ name: "--expect", rest })) {
    const expectation = parsePublicationExpectation({ value });
    if (expectation.isErr()) {
      reasons.push(expectation.error);
    } else {
      expectations.push(expectation.value);
    }
  }
  const fire = parsed.value.flags.has("fire");
  const bySession = parsed.value.values["by-session"];
  if (fire && (bySession === undefined || bySession.trim() === "")) {
    reasons.push("--fire takes --by-session <session>: every card the pass writes names who ran it");
  }
  if (!fire && bySession !== undefined) {
    reasons.push("--by-session names who fires the monitor pass, so it goes with --fire");
  }
  if (reasons.length > 0) {
    return err(reasons);
  }
  return ok({
    expectations,
    fireAs: fire ? bySession : undefined,
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    owner,
    repo,
  });
}
