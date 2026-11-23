/**
 * The pure half of `slopweaver policy render` — its option grammar.
 *
 * Everything here is a function of plain values, so every refusal message is settled by a unit test rather
 * than by running the verb.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagTailSpec, parseFlagTail, requiredFlagValue } from "../../optionParsers.js";

/** What `policy render` was asked to do. */
export interface PolicyRenderOptions {
  /** The policy or evidence markdown file to render. */
  readonly file: string;
  /** Where the PDF is written. */
  readonly out: string;
  readonly json: boolean;
}

/** Every flag `render` knows, so an unknown one — or a value flag with none — is refused by name rather than ignored. */
export const POLICY_RENDER_FLAGS: FlagTailSpec = { boolean: ["json"], value: ["file", "out"] };

/**
 * Parse `policy render`'s flags.
 *
 * @param rest the verb tail
 * @returns the options, or every reason they were refused
 */
export function parsePolicyRender({ rest }: { rest: readonly string[] }): Result<PolicyRenderOptions> {
  const parsed = parseFlagTail({ rest, spec: POLICY_RENDER_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const file = requiredFlagValue({
    missing: "--file <path> is required: the policy markdown to render",
    name: "file",
    parsed: parsed.value,
  });
  const out = requiredFlagValue({
    missing: "--out <path> is required: where to write the PDF",
    name: "out",
    parsed: parsed.value,
  });
  if (file.isErr() || out.isErr()) {
    return err([...(file.isErr() ? file.error : []), ...(out.isErr() ? out.error : [])]);
  }
  return ok({ file: file.value, json: parsed.value.flags.has("json"), out: out.value });
}
