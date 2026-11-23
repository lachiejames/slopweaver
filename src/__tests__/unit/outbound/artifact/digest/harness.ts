/*
 * What the outbound artifact digest test files share: the reference Knock digest form, the resolver that knows
 * everyone, and the derivation that keeps only the card. They moved here when `digest.test.ts` was split by
 * behaviour.
 */
import { digestToUpdate } from "../../../../../outbound/artifact/digest.js";
import type { DigestForm } from "../../../../../outbound/artifact/digestFields.js";
import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";

/**
 * An invented reference digest, in the shape a real one motivated, as domain data.
 *
 * @returns the reference Knock digest form
 */
export function knockForm(): DigestForm {
  return {
    items: [
      {
        citationUrl: "https://example.invalid/logs?query=knock",
        count: 355,
        severity: "orange",
        state: "easing from 403",
        ticket: { id: "SUP-9145", url: "https://example.invalid/SUP-9145" },
        title: "example-order-pending 422",
        trend: "easing",
      },
      {
        count: 0,
        severity: "green",
        state: "stale guard still live in prod",
        ticket: { id: "CCCC-1909", url: "https://example.invalid/CCCC-1909" },
        title: "notification transition race",
      },
      {
        citationUrl: "https://example.invalid/logs?query=signup",
        count: 706,
        severity: "red",
        state: "third digest, nothing moved",
        substance: "The two widget queues were never provisioned, so every example sign-up has failed since launch.",
        ticket: { id: "KK-1770", url: "https://example.invalid/KK-1770" },
        title: "example sign-up registration",
        trend: "rising",
      },
      {
        count: 721,
        severity: "orange",
        state: "merged to staging, awaits release",
        ticket: { id: "JJJJ-1316", url: "https://example.invalid/JJJJ-1316" },
        title: "chat read-receipt 422",
      },
    ],
    kind: "digest",
    label: "Knock",
    lead: "The red one is still unowned.",
    window: "24h",
  };
}

/**
 * Everyone resolves — the common case, so a test that is not about owners need not say so.
 *
 * @returns true for every person asked about
 */
export const ALL_KNOWN = (): boolean => true;

/**
 * Derive and keep only the card, which is what most assertions here are about.
 *
 * @returns the derived card, without the unresolved-owner report beside it
 */
export function derive({
  form,
  isKnownPerson = ALL_KNOWN,
}: {
  form: DigestForm;
  isKnownPerson?: () => boolean;
}): UpdateArtifact {
  return digestToUpdate({ form, isKnownPerson }).artifact;
}
