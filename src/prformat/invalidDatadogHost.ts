/**
 * The PR-format half of the dead-Datadog-host ban: a description linking a Datadog console host no site serves
 * fails CI, naming the host it should have been.
 *
 * The write transports (`../outbound/invalidDatadogHost.ts`) already refuse such a description when the GitHub
 * write lane sends it. This is the composition-time check beside them, because CI reads a description from the
 * event and never crosses a transport — a body edited in the GitHub UI reaches it only this way.
 *
 * Its escape is an inline marker with a reason, for the same cause `invented-visual-ack` is one: CI validates the
 * body and nothing else, so a hatch it cannot see would be no hatch at all. A description that has to QUOTE the
 * dead host — a bug report about this very rule — carries `<!-- invalid-datadog-host-ack: <reason> -->`.
 */
import { ACKNOWLEDGEMENT_MIN_WORDS, acknowledgementCarriesAReason } from "../admit/inventedVisual.js";
import { invalidDatadogConsoleHosts } from "../datadog/invalidConsoleHost.js";

/** The inline acknowledgement that waives {@link invalidDatadogHostErrors} for this description. */
const INVALID_DATADOG_HOST_ACK = /<!--\s*invalid-datadog-host-ack:\s*(\S+(?:\s+\S+)*)\s*-->/i;

/**
 * Every dead Datadog console host this description links, one error per distinct host.
 *
 * @param body the PR description markdown
 * @returns one error per distinct dead host, naming the host it should have been; empty when the body is clean,
 *   and empty for ANY body carrying an `invalid-datadog-host-ack` comment with a real reason
 */
export function invalidDatadogHostErrors({ body }: { body: string }): readonly string[] {
  const ack = INVALID_DATADOG_HOST_ACK.exec(body);
  if (ack !== null && acknowledgementCarriesAReason({ reason: ack[1]! })) {
    return [];
  }
  const hosts = new Map(invalidDatadogConsoleHosts({ text: body }).map((hit) => [hit.invalidHost, hit.correctHost]));
  return [...hosts].map(
    ([invalidHost, correctHost]) =>
      `The description links \`${invalidHost}\`, which is not a Datadog console — every link on it is dead. ` +
      `Use \`${correctHost}\`, or add \`<!-- invalid-datadog-host-ack: <reason, ${String(ACKNOWLEDGEMENT_MIN_WORDS)}+ words> -->\` ` +
      "if the description has to quote it.",
  );
}
