/**
 * REFUSE `handover settle --as answered` on a bare pull request URL when the owner's words on the row ask for proof the
 * body does not carry.
 *
 * `../../../handover/proofAsk.ts` carries the measurement (acme-admin-17564, settled on a URL nothing read) and the
 * pure half: what the owner's words ask for, and what a body carries. This is the shell around it — it reads the body
 * LIVE, through the same reader `github read` uses, because a settlement claims the owner's ask was met NOW and only the body as it
 * stands can say so.
 *
 * Out of scope by construction: a witness that is not a bare pull request URL (a comment permalink, a doc slug, a
 * Slack link) is a more specific claim this does not judge, and a row whose words ask for no proof is never read.
 */
import { githubToken } from "../../../config.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import {
  barePullRequestUrl,
  judgeProof,
  proofAskedIn,
  proofCarriedIn,
  proofLacking,
  proofVerdictLine,
} from "../../../handover/proofAsk.js";
import type { AskSettlement } from "../../../handover/rowKind.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../live/github/errors.js";
import { githubReadGraphql, readGithubObject } from "../../../live/github/read.js";

/** Read a pull request's body as it stands now. */
export type PullBodyRead = (args: { address: string; home: string }) => Promise<Result<string, GithubLiveError>>;

/**
 * What the gate decided: settle, with lines for the receipt, or refuse with lines to print as they stand — the
 * hatch's own four lines already name the command, so nothing prefixes them a second time.
 */
export type ProofWitnessOutcome =
  | { readonly kind: "pass"; readonly receipt: readonly string[] }
  | { readonly kind: "refuse"; readonly lines: readonly string[] };

/**
 * The production body read: one named-object read through the token in `home`, the body field off it.
 *
 * @returns the body, `""` for a pull request with none, or the read's own failure
 */
const productionPullBodyRead: PullBodyRead = async ({ address, home }) => {
  const document = await readGithubObject({
    address,
    graphql: githubReadGraphql({ token: githubToken({ home }) }),
    limit: 1,
    nowIso: () => new Date().toISOString(),
  });
  if (document.isErr()) {
    return err(document.error);
  }
  const body = isRecord(document.value.data) ? document.value.data["body"] : undefined;
  if (typeof body !== "string") {
    return err(GithubLiveErrors.readFailed({ message: `GitHub returned no body field for ${address}` }));
  }
  return ok(body);
};

/**
 * What a thrown value says, without throwing again. Never `String(cause)`, which throws on a value with no primitive
 * conversion, and never a bare `.message`, whose getter can throw.
 *
 * @returns the Error's message when it reads as a string, else a fixed line naming that the read threw
 */
function thrownMessage({ cause }: { cause: unknown }): string {
  const fixed = "the read threw a value with no readable message";
  try {
    const message: unknown = cause instanceof Error ? cause.message : undefined;
    if (typeof message === "string") {
      return message;
    }
    return fixed;
  } catch {
    return fixed;
  }
}

/**
 * A body read whose throw — synchronous or a rejection: no token resolvable, a socket reset — is the same fact as a
 * failed read, so the settle refuses rather than rejecting.
 *
 * @param read the injected read a test supplies; GitHub's own when absent
 *
 * @returns the read's own result, or its throw as a read failure
 */
async function readAsFact({
  address,
  home,
  read,
}: {
  address: string;
  home: string;
  read: PullBodyRead | undefined;
}): Promise<Result<string, GithubLiveError>> {
  // No injected read is the production settle, by design: GitHub itself, through the token in `home`.
  if (read === undefined) {
    return readAsFact({ address, home, read: productionPullBodyRead });
  }
  try {
    return await read({ address, home });
  } catch (cause: unknown) {
    return err(GithubLiveErrors.readFailed({ cause, message: thrownMessage({ cause }) }));
  }
}

/**
 * Every quote of the owner's a row holds that can be read: its own and each held steer. An unread or defective group holds
 * no words, so it asks for nothing.
 *
 * @param row the row being settled
 * @returns the words, the row's own first
 */
function heldWordsOf({ row }: { row: HandoverDoc }): readonly string[] {
  const own = row.hisWords.kind === "held" ? [row.hisWords.hisWords.words] : [];
  const steers = row.hisWordsSteers.flatMap((steer) =>
    steer.group.kind === "held" ? [steer.group.hisWords.words] : [],
  );
  return [...own, ...steers];
}

/**
 * Whether the settle may proceed on this witness, reading the pull request's body when the owner's words ask for proof.
 *
 * @param row the row being settled, whose stored words are what asks
 * @param witness `--witness`, trimmed
 * @param env the environment the hatch is read from
 * @param readBody the live body read, injected so a test reads a fixture; GitHub itself when absent
 * @returns pass with the receipt lines naming what the body carries, or refuse with the lines to print
 */
export async function proofWitnessGate({
  row,
  settlement,
  witness,
  home,
  env,
  readBody,
}: {
  row: HandoverDoc;
  settlement: AskSettlement;
  witness: string;
  home: string;
  env: NodeJS.ProcessEnv;
  readBody: PullBodyRead | undefined;
}): Promise<ProofWitnessOutcome> {
  const address = barePullRequestUrl({ witness });
  if (settlement !== "answered" || address === undefined) {
    return { kind: "pass", receipt: [] };
  }
  const asked = proofAskedIn({ words: heldWordsOf({ row }) });
  if (asked.items.length === 0) {
    return { kind: "pass", receipt: [] };
  }
  // Read BEFORE the hatch is asked: the hatch waives a lack the body shows, never a body nobody could read, so an
  // unreadable one stays a FACT whose resolution is a retry with working access.
  const body = await readAsFact({ address, home, read: readBody });
  if (body.isErr()) {
    return {
      kind: "refuse",
      lines: [
        `handover settle: the row is NOT settled: the owner's words on it ask for ${asked.items.join(", ")}, and ${address} could not be read, so whether its body carries them is unknown — ${body.error.message}`,
      ],
    };
  }
  const verdicts = judgeProof({ asked, carried: proofCarriedIn({ body: body.value }) });
  const lacking = verdicts.filter((verdict) => proofLacking({ verdict }));
  if (lacking.length === 0) {
    return {
      kind: "pass",
      receipt: [
        `proof-witness: read ${address} live — each item the owner's words ask for is PRESENT (present, not judged):`,
        ...verdicts.map((verdict) => `  ${proofVerdictLine({ verdict })}`),
      ],
    };
  }
  const short = lacking.map((verdict) => proofVerdictLine({ verdict })).join("; ");
  // Spelled as the LITERAL variable: `src/devLint/escapeHatch.ts` checks the row's `reader` for this exact string. Open
  // on `1` only, as `hatchOpen` reads an ambient row, so `=0` never waives the refusal.
  if (env["SLOPWEAVER_ALLOW_UNPROVEN_ANSWER"] === "1") {
    return {
      kind: "pass",
      receipt: [`proof-witness: override in force — settling although ${address} lacks ${short}`],
    };
  }
  return {
    kind: "refuse",
    lines: hatchRefusalLines({ detail: `${address} lacks ${short}`, hatch: hatchFor({ id: "proof-witness" }) }),
  };
}

/**
 * The gate as `handover settle` asks it: a refusal printed to stderr where the settle prints its own, a pass handed
 * back as the receipt lines the settle prints after its write.
 *
 * @returns the receipt lines, or `undefined` once the refusal is printed and the settle must stop
 */
export async function proofWitnessReceipt(
  args: Parameters<typeof proofWitnessGate>[0],
): Promise<readonly string[] | undefined> {
  const outcome = await proofWitnessGate(args);
  if (outcome.kind === "pass") {
    return outcome.receipt;
  }
  outcome.lines.forEach((line) => {
    logger.error({ msg: line });
  });
  return undefined;
}
