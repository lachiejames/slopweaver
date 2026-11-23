/**
 * The typed failures of deciding what a question may be asked over — the window it covers (`window.ts`) and
 * the telemetry domain that can answer it honestly (`domain.ts`).
 *
 * A union of its own per `.claude/rules/error-handling.md`: every one of these is refused before any call
 * is spent, and none shares a caller with the query union that reads a response. Every refusal here was a
 * list of lines before it had a type and keeps them as `reasons`, and {@link datadogDomainErrorLines} is how
 * a caller prints them without re-composing the joined `message`.
 *
 * Pure: values in, values out.
 */

/** A failure whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A failure that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/** A measure routed somewhere that cannot state it, with the traffic type that decided it. */
interface SampledRefusal<C extends string> extends Listed<C> {
  readonly measure: string;
  readonly trafficType: string;
}

/** Every way a window or a measure's routing can be refused before a call is made. */
export type DatadogDomainError =
  | Listed<"WINDOW_BOUNDS_INVALID">
  | (Plain<"WINDOW_EMPTY"> & { readonly fromMs: number; readonly toMs: number })
  | (Listed<"LOGS_DOMAIN_UNSUPPORTED"> & { readonly measure: string })
  | SampledRefusal<"KNOWN_SAMPLED_COUNT_REFUSED">
  | SampledRefusal<"SAMPLED_RESPONSE_COUNT_REFUSED">;

/** One list-carrying variant, its message the lines joined the way the `string[]` it replaced was. */
function listed<C extends string>({ code, reasons }: { code: C; reasons: readonly string[] }): Listed<C> {
  return { code, message: reasons.join("; "), reasons };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const DatadogDomainErrors = {
  knownSampledCountRefused: ({
    measure,
    trafficType,
  }: {
    measure: string;
    trafficType: string;
  }): DatadogDomainError => ({
    ...listed({
      code: "KNOWN_SAMPLED_COUNT_REFUSED",
      reasons: [
        `a ${measure} from the spans domain is sampled by construction: every spans aggregate declares 'traffic_type: ${trafficType}'`,
        "refused before the call rather than after it, because the spans aggregate endpoint is tightly rate-limited and this outcome was already known",
        "measured on one closed hour, spans reported 2 where logs reported 7 for the identical query",
        `route the ${measure} to the logs domain, which is unsampled here; or pass the explicit opt-in to have it reported as a sampled ${measure}`,
      ],
    }),
    measure,
    trafficType,
  }),
  logsDomainUnsupported: ({ measure }: { measure: string }): DatadogDomainError => ({
    ...listed({
      code: "LOGS_DOMAIN_UNSUPPORTED",
      reasons: [
        `the logs domain cannot answer '${measure}': logs carry neither a duration distribution nor a span tree`,
        "this is an absence of data rather than a sampled view of it, so no caveat would make the answer honest — route it to spans",
      ],
    }),
    measure,
  }),
  sampledResponseCountRefused: ({
    measure,
    trafficType,
  }: {
    measure: string;
    trafficType: string;
  }): DatadogDomainError => ({
    ...listed({
      code: "SAMPLED_RESPONSE_COUNT_REFUSED",
      reasons: [
        `refusing to report a ${measure} taken from a response that declared 'traffic_type: ${trafficType}'`,
        "adaptive sampling drops traces upstream of every retention filter, so this number is a lower bound of unknown tightness — measured on one closed hour, spans reported 2 where logs reported 7 for the identical query",
        `route the ${measure} to the logs domain, which is unsampled here and omits the traffic_type field entirely; or pass the explicit opt-in to have it reported as a sampled ${measure}`,
      ],
    }),
    measure,
    trafficType,
  }),
  windowBoundsInvalid: ({ reasons }: { reasons: readonly string[] }): DatadogDomainError =>
    listed({ code: "WINDOW_BOUNDS_INVALID", reasons }),
  windowEmpty: ({ fromMs, toMs }: { fromMs: number; toMs: number }): DatadogDomainError => ({
    code: "WINDOW_EMPTY",
    fromMs,
    message: `the window is empty: --from resolved to ${String(fromMs)} and --to to ${String(toMs)}. A window must start before it ends`,
    toMs,
  }),
} as const;

/**
 * The lines one failure prints, one log record each, exactly as the verb printed them before it had a type:
 * a list-carrying failure as its list, and every other failure as its one message.
 *
 * @returns the lines, in order
 */
export function datadogDomainErrorLines({ error }: { error: DatadogDomainError }): readonly string[] {
  if (error.code === "WINDOW_EMPTY") {
    return [error.message];
  }
  return error.reasons;
}
