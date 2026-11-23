/**
 * The draw fold's end of file: relabel every row to the tick its `tick close` named, count each call's later
 * reads per epoch, and pair every cap refusal with its retry. `./draw.ts` carries where every number comes from.
 */
import {
  type ApiCall,
  type DrawCall,
  type DrawReading,
  type DrawRetry,
  type DrawState,
  readsOf,
} from "./drawShapes.js";

/** How many later API calls, in the same epoch, read each call's prompt. */
function laterReadsOf({ total, epochStarts }: { total: number; epochStarts: readonly number[] }): number[] {
  const starts = [...new Set([...epochStarts, total])].toSorted((left, right) => left - right);
  const reads: number[] = [];
  for (let index = 0; index < total; index += 1) {
    const end = starts.find((start) => start > index)!;
    reads.push(end - index - 1);
  }
  return reads;
}

/**
 * Turn the walk's state into the reading.
 *
 * @param state the walk, every line read
 * @returns the reading, each row stamped with its tick
 */
export function finishReading({ state }: { state: DrawState }): DrawReading {
  const label = ({ segment }: { segment: number }): number => {
    const tick = state.labels.get(segment);
    // a segment after the last `tick close` is named by no receipt, and is tick 0 by design
    if (tick === undefined) {
      return 0;
    }
    return tick;
  };
  [...state.apiCalls, ...state.calls, ...state.attachments].forEach((row) => {
    row.tick = label({ segment: row.tick });
  });
  // keyed by segment, never by label: two segments a recurring label names are two ticks, not one
  const bySegment = new Map<number, { apiCalls: number; outputTokens: number; promptTokens: number; tick: number }>();
  state.apiCalls.forEach((api) => {
    const row = bySegment.get(api.segment);
    if (row === undefined) {
      bySegment.set(api.segment, {
        apiCalls: 1,
        outputTokens: api.outputTokens,
        promptTokens: api.promptTokens,
        tick: api.tick,
      });
      return;
    }
    row.apiCalls += 1;
    row.outputTokens += api.outputTokens;
    row.promptTokens += api.promptTokens;
  });
  const laterReads = laterReadsOf({ epochStarts: state.epochStarts, total: state.apiCalls.length });
  return {
    apiCalls: state.apiCalls.length,
    apiTicks: state.apiCalls.map((api) => api.tick),
    attachments: state.attachments,
    calls: state.calls,
    compactionTicks: [...new Set(state.epochStarts)]
      .filter((index) => index > 0 && index < state.apiCalls.length)
      .map((index) => state.apiCalls[index]!.tick),
    laterReads,
    outputTokens: state.apiCalls.reduce((sum, api) => sum + api.outputTokens, 0),
    retries: retriesOf({ apiCalls: state.apiCalls, calls: state.calls, laterReads }),
    ticks: [...bySegment.entries()]
      .map(([segment, row]) => ({ ...row, segment }))
      .toSorted((left, right) => left.tick - right.tick || left.segment - right.segment),
  };
}

/**
 * Every cap refusal, paired with the next call of the same head in the same segment when one came — so a lap's
 * cost always lands in the tick that is counted for it.
 *
 * The lap counts only the API calls that ARE the rewrite: from the one that read the refusal to the one that
 * retried, each that made no tool call (it only thought and wrote) or only rewrote — a `Write` or `Edit`, or the
 * retry itself. A call in between doing unrelated work (a `talk unread`, a board read) is the tick's ordinary
 * cost and is not charged to the refusal, so a lap that spans forty calls is not reported as forty calls' cost.
 *
 * @param calls every main-thread call, in order
 * @param apiCalls every main-thread API call, in order
 * @param laterReads per API call, how many later calls in its epoch read its prompt
 * @returns one row per refusal
 */
function retriesOf({
  calls,
  apiCalls,
  laterReads,
}: {
  calls: readonly DrawCall[];
  apiCalls: readonly ApiCall[];
  laterReads: readonly number[];
}): DrawRetry[] {
  const apiTicks = apiCalls.map((api) => api.tick);
  const byApi = callsByApi({ calls });
  const rows: DrawRetry[] = [];
  calls.forEach((call, position) => {
    if (!call.capRefusal) {
      return;
    }
    // a second call in a later segment is that tick's work: the lap ends where its segment does, and a segment's
    // API calls are contiguous, so every call the lap scans sits in the refusal's own segment
    const laterIndex = calls.findIndex(
      (other, at) => at > position && other.head === call.head && other.segment === call.segment,
    );
    const again = laterIndex === -1 ? undefined : calls[laterIndex];
    const lap = lapOf({ again, apiCalls, byApi, refused: call });
    rows.push({
      callsBetween: again === undefined ? 0 : laterIndex - position - 1,
      head: call.head,
      ...lap,
      refusal: call.refusalLine,
      refusalCarried:
        call.measuredTokens *
        readsOf({
          kept: () => true,
          readIndex: call.readIndex,
          reading: { apiTicks, laterReads },
        }),
      refusalMeasured: call.measured,
      refusalReadIndex: call.readIndex,
      refusalTokens: call.measuredTokens,
      retried: again !== undefined,
      tick: call.tick,
    });
  });
  return rows;
}

/** Every main-thread call, grouped by the API call that issued it. */
function callsByApi({ calls }: { calls: readonly DrawCall[] }): ReadonlyMap<number, readonly DrawCall[]> {
  const byApi = new Map<number, DrawCall[]>();
  calls.forEach((call) => {
    const issued = byApi.get(call.apiIndex);
    if (issued === undefined) {
      byApi.set(call.apiIndex, [call]);
      return;
    }
    issued.push(call);
  });
  return byApi;
}

/**
 * The rewrite one refusal cost: every API call from the one that read the refusal to the one that made the call
 * again, that issued nothing, or only a `Write`, an `Edit` or the same head.
 */
function lapOf({
  refused,
  again,
  apiCalls,
  byApi,
}: {
  refused: DrawCall;
  again: DrawCall | undefined;
  apiCalls: readonly ApiCall[];
  byApi: ReadonlyMap<number, readonly DrawCall[]>;
}): { lapApiCalls: number; lapOutputTokens: number; lapPromptTokens: number } {
  const lap = { lapApiCalls: 0, lapOutputTokens: 0, lapPromptTokens: 0 };
  if (again === undefined || refused.readIndex < 0) {
    return lap;
  }
  const last = Math.min(again.apiIndex, apiCalls.length - 1);
  for (let index = refused.readIndex; index <= last; index += 1) {
    const issued = byApi.get(index);
    const rewriting =
      issued === undefined ||
      issued.every((one) => one.tool === "Write" || one.tool === "Edit" || one.head === refused.head);
    if (rewriting) {
      lap.lapOutputTokens += apiCalls[index]!.outputTokens;
      lap.lapPromptTokens += apiCalls[index]!.promptTokens;
      lap.lapApiCalls += 1;
    }
  }
  return lap;
}
