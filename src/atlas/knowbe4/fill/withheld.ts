/**
 * The pass between a fill and anything that publishes it: no failure's words, no bound's, and no kept row may quote
 * the token the run sent. `syncRun.ts` applies it to what `runKnowbe4Fill` returned, before the sync, a log line or
 * a coverage cell sees any of it.
 */
import { tokenWithheld } from "../../../live/knowbe4/transport.js";
import type { Knowbe4FillObservation } from "./run.js";

/**
 * The observation with every failure's words, and every bound's, passed through `tokenWithheld`. The transport is
 * not the only place they can quote the token: a bound names the provider ids it stopped under, so a body echoing
 * the token as an id would carry it into a coverage cell and a log line. A boundary's refusal never names
 * a key KnowBe4 chose at all (`publishableWords`). A kept row is never edited, so a path whose rows quote the token
 * (an `email` that echoes it, say) fails whole, carrying its earlier generation forward, rather than being stored.
 *
 * @param fill what the run brought back
 * @param token the bearer token every request carried
 * @returns the same observation, with no failure's or bound's words, and no kept row, quoting the token
 */
export function withTokenWithheld({
  fill,
  token,
}: {
  fill: Knowbe4FillObservation;
  token: string;
}): Knowbe4FillObservation {
  const quoting = fill.answered.filter((read) => read.items.some((item) => quotesToken({ token, value: item })));
  return {
    ...fill,
    answered: fill.answered
      .filter((read) => !quoting.includes(read))
      .map((read) => ({
        ...read,
        truncatedBy: read.truncatedBy === null ? null : tokenWithheld({ message: read.truncatedBy, token }),
      })),
    failed: [
      ...fill.failed.map((failure) => ({ ...failure, message: tokenWithheld({ message: failure.message, token }) })),
      ...quoting.map((read) => ({
        kind: read.kind,
        message: `${read.template} answered a row quoting the token this run sent — refused, not stored`,
        status: null,
        template: read.template,
      })),
    ],
  };
}

/** Whether any string inside a projected row, at any depth, contains the token. */
function quotesToken({ token, value }: { token: string; value: unknown }): boolean {
  if (typeof value === "string") {
    return value.includes(token);
  }
  if (Array.isArray(value)) {
    return value.some((each) => quotesToken({ token, value: each }));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((each) => quotesToken({ token, value: each }));
  }
  return false;
}
