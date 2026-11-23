/**
 * Take the structural census `tools/generateDatadogResponseBoundaries.ts` declares every Datadog response boundary
 * from: issue each of the admitted operations once against the live organisation, exactly as the atlas's API pass
 * does (`src/atlas/datadog/apiCall.ts`), and record every answer's key paths, kinds and counts per operation
 * (`src/atlas/datadog/responseCensus.ts`) — never a value. Nothing is merged into an atlas and nothing is written
 * under the home; it is read only for the configured site and keys.
 *
 * ```bash
 * yarn tsx tools/datadogResponseCensus.ts <home> <census.json>
 * ```
 *
 * The census is a tenant measurement and is not committed; the declarations generated from it are. It is one run,
 * never merged with an earlier one.
 */
import { writeFileSync } from "node:fs";

import { DATADOG_API_ADMITTED } from "../src/atlas/datadog/apiAcquisition.js";
import { callDatadogApiOperation } from "../src/atlas/datadog/apiCall.js";
import { type DatadogResponseCensus, observeDatadogAnswer } from "../src/atlas/datadog/responseCensus.js";
import { datadogConfigErrorLines } from "../src/datadog/configErrors.js";
import { createRawTransport, type RawTransport, rawTransportFrom } from "../src/datadog/rawTransport.js";
import { loadDatadogConfig } from "../src/datadog/source.js";
import { logger } from "../src/lib/logger.js";
import { safeJsonStringify } from "../src/lib/safeJson.js";

const [home, out] = process.argv.slice(2);
if (home === undefined || out === undefined) {
  throw new Error("usage: yarn tsx tools/datadogResponseCensus.ts <home> <census.json>");
}

const config = loadDatadogConfig({ home });
if (config.isErr()) {
  throw new Error(datadogConfigErrorLines({ error: config.error }).join("; "));
}
const transport = createRawTransport({ config: config.value, logger });
const census: DatadogResponseCensus = { operations: {}, takenAt: new Date().toISOString() };

/** The live transport, with every answer it returns for one operation folded into the census on the way back. */
function observedFor({ surface }: { surface: string }): RawTransport {
  return rawTransportFrom({
    lastRateLimit: transport.lastRateLimit,
    requestRawTextWithStatus: async (input) => {
      const answered = await transport.requestRawTextWithStatus(input);
      if (answered.isOk()) {
        observeDatadogAnswer({ census, status: answered.value.status, surface, text: answered.value.bodyText });
      } else {
        observeDatadogAnswer({ census, status: answered.error.status, surface, text: null });
      }
      return answered;
    },
  });
}

for (const [index, row] of DATADOG_API_ADMITTED.entries()) {
  await callDatadogApiOperation({ row, transport: observedFor({ surface: row.name }) });
  if ((index + 1) % 25 === 0) {
    process.stderr.write(`census: ${String(index + 1)} of ${String(DATADOG_API_ADMITTED.length)} operations asked\n`);
  }
}

writeFileSync(out, safeJsonStringify({ label: "the Datadog response census", value: census }));
const answered = Object.values(census.operations).filter((tally) => Object.keys(tally.roots).length > 0).length;
process.stderr.write(`census: ${String(answered)} of ${String(DATADOG_API_ADMITTED.length)} answered 2xx → ${out}\n`);
