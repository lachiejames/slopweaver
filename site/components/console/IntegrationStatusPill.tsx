/*
 * An integration's status, drawn the same way on its catalog card and on its own page: calm for connected, amber for
 * needs attention, plain for available (`../../lib/integrationCatalog.ts` says what each means).
 */
import type { ReactElement } from "react";

import type { IntegrationStatus } from "../../lib/integrationCatalog";
import { INTEGRATION_FILTER_LABELS } from "../../lib/integrationCatalog";

/** Each status's tone. */
const TONES: Readonly<Record<IntegrationStatus, string>> = {
  available: "border-border text-muted-foreground",
  connected: "border-success/50 text-success",
  "needs-attention": "border-warning/50 text-warning",
};

/**
 * The pill.
 *
 * @returns the pill
 */
export function StatusPill({ status }: { status: IntegrationStatus }): ReactElement {
  return (
    <span
      className={`inline-block rounded-full border border-solid px-2 py-0 text-[0.68rem] leading-[1.15rem] font-medium whitespace-nowrap ${TONES[status]}`}
    >
      {INTEGRATION_FILTER_LABELS[status]}
    </span>
  );
}
