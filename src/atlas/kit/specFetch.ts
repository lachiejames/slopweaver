/**
 * The HTTP seam the pinned-document atlases share (Clerk, Gemini AI Studio, Microsoft 365). Injected so every
 * branch below it is reachable without a network call.
 *
 * Declared once because three atlases each carried a byte-identical copy. The shapes that genuinely differ stay
 * with their atlas: Braze's response also reports the final `url`, and Vanta, 1Password, Datadog and Hex pass a
 * method, headers and a body.
 *
 * @internal
 */
// named-object-params-exempt: must match the real global fetch's positional shape to be substitutable for it
export type SpecFetchLike = (
  url: string,
  init: { redirect: "follow"; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;
