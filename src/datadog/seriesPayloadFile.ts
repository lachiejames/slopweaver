/**
 * Write a `{ "series": [...] }` payload file — the shape `datadog submit --series FILE` reads — one series at a
 * time, so no whole-file string is ever held.
 *
 * Written by `datadog produce`, the generic produce leg of a `metrics-push` row. Local disk only: the submission
 * the file prepares is the separate, door-routed `datadog submit`.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomicStream } from "#lib/writeAtomic.js";

import type { SubmittedSeries } from "./seriesPayload.js";

/**
 * Write the payload atomically, creating its directory.
 *
 * @param out the file to write
 * @param series the gauge and count series it carries, written in the order given
 */
export function writeSeriesPayload({
  out,
  series,
}: {
  readonly out: string;
  readonly series: readonly SubmittedSeries[];
}): void {
  mkdirSync(dirname(out), { recursive: true });
  writeFileAtomicStream({
    path: out,
    produce: (sink) => {
      sink.write({ text: '{"series":[' });
      series.forEach((one, index) => {
        sink.write({ text: index === 0 ? "" : "," });
        sink.write({ text: safeJsonStringify({ label: "one series", value: one }) });
      });
      sink.write({ text: "]}\n" });
    },
  });
}
