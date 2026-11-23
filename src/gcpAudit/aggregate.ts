/**
 * Count a pull's entries the way a least-privilege reading needs them: per principal, service and method, and
 * per permission Google recorded as checked. Pure — the summary shell streams entries in; nothing here reads.
 *
 * Every count is of DISTINCT events (`eventId`), because an aggregated sink can make one entry visible through
 * two searched containers.
 */
import type { GcpAuditLogKind, TrimmedGcpAuditEntry } from "./trim.js";

/** One principal × service × method row. */
export interface GcpCallRow {
  readonly principal: string;
  readonly serviceName: string;
  readonly methodName: string;
  readonly count: number;
  readonly failed: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly kinds: Readonly<Partial<Record<GcpAuditLogKind, number>>>;
  readonly origins: readonly string[];
  readonly callerIps: readonly string[];
  readonly agents: readonly string[];
}

/** One permission a principal exercised (granted) or was refused (denied) in one container. */
export interface GcpPermissionUse {
  readonly principal: string;
  readonly permission: string;
  readonly origin: string;
  readonly granted: boolean;
  readonly count: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly methods: readonly string[];
}

/** The whole count. */
export interface GcpAuditSummary {
  /** Distinct events read. */
  readonly unique: number;
  /** Stored copies of an event already counted, skipped — a diagnostic of sink overlap, never an event count. */
  readonly duplicates: number;
  readonly derivedIds: number;
  readonly byKind: Readonly<Partial<Record<GcpAuditLogKind, { count: number; firstSeen: string; lastSeen: string }>>>;
  readonly calls: readonly GcpCallRow[];
  readonly uses: readonly GcpPermissionUse[];
  readonly withoutAuthorization: number;
}

/** The written name for a field Google left unset, so a row never silently merges into another. */
const UNSET = "(unset)";

/**
 * The family a user agent belongs to — a closed vocabulary, first match wins.
 *
 * @param agent the caller-supplied user agent, or null
 * @returns `gcloud`, `terraform`, `pulumi`, `google-api-nodejs`, `google-api-go`, `google-api-python`,
 *   `google-api-java`, `cloud-console`, `curl`, `browser`, `none` or `other`
 */
export function agentFamily({ agent }: { agent: string | null }): string {
  if (agent === null || agent.length === 0) {
    return "none";
  }
  const families: readonly (readonly [RegExp, string])[] = [
    [/command\/gcloud|gcloud-|google-cloud-sdk/i, "gcloud"],
    [/terraform/i, "terraform"],
    [/pulumi/i, "pulumi"],
    [/gl-node|google-api-nodejs|gccl.*node|gax\/.*gl-node/i, "google-api-nodejs"],
    [/gl-go|google-api-go/i, "google-api-go"],
    [/gl-python|google-api-python/i, "google-api-python"],
    [/gl-java|google-api-java/i, "google-api-java"],
    [/curl\//i, "curl"],
    [/Mozilla\//, "browser"],
  ];
  const hit = families.find(([pattern]) => pattern.test(agent));
  return hit === undefined ? "other" : hit[1];
}

/** The first and last instant something was seen. */
interface Span {
  firstSeen: string;
  lastSeen: string;
}

/** A mutable accumulator for one call row. */
interface CallAccumulator extends Span {
  readonly principal: string;
  readonly serviceName: string;
  readonly methodName: string;
  count: number;
  failed: number;
  readonly kinds: Partial<Record<GcpAuditLogKind, number>>;
  readonly origins: Set<string>;
  readonly callerIps: Set<string>;
  readonly agents: Set<string>;
}

/** A mutable accumulator for one permission use. */
interface UseAccumulator extends Span {
  readonly principal: string;
  readonly permission: string;
  readonly origin: string;
  readonly granted: boolean;
  count: number;
  readonly methods: Set<string>;
}

/** Everything a count holds between entries. */
interface CountState {
  readonly seen: Set<string>;
  duplicates: number;
  derivedIds: number;
  withoutAuthorization: number;
  readonly byKind: Map<GcpAuditLogKind, Span & { count: number }>;
  readonly calls: Map<string, CallAccumulator>;
  readonly uses: Map<string, UseAccumulator>;
}

/** An entry's principal, service and method, each written as {@link UNSET} when Google left it unset. */
interface CallNames {
  readonly principal: string;
  readonly serviceName: string;
  readonly methodName: string;
}

/** The incremental counter the summary shell feeds one entry at a time. */
export interface GcpAuditCounter {
  readonly add: (args: { entry: TrimmedGcpAuditEntry }) => void;
  readonly result: () => GcpAuditSummary;
}

/** Widen a span to cover one more instant. */
function widen({ span, timestamp }: { span: Span; timestamp: string }): void {
  if (timestamp < span.firstSeen) {
    span.firstSeen = timestamp;
  }
  if (timestamp > span.lastSeen) {
    span.lastSeen = timestamp;
  }
}

/** A name as a call row writes it: {@link UNSET} where Google left it unset, so the gap shows in the row. */
function writtenName({ name }: { name: string | null }): string {
  if (name === null) {
    return UNSET;
  }
  return name;
}

/** The names an entry's call row is keyed by. */
function namesOf({ entry }: { entry: TrimmedGcpAuditEntry }): CallNames {
  return {
    methodName: writtenName({ name: entry.methodName }),
    principal: writtenName({ name: entry.principal }),
    serviceName: writtenName({ name: entry.serviceName }),
  };
}

/** Count one entry against its audit stream. */
function addKind({ state, entry }: { state: CountState; entry: TrimmedGcpAuditEntry }): void {
  const kind = state.byKind.get(entry.logKind);
  if (kind === undefined) {
    state.byKind.set(entry.logKind, { count: 1, firstSeen: entry.timestamp, lastSeen: entry.timestamp });
    return;
  }
  kind.count += 1;
  widen({ span: kind, timestamp: entry.timestamp });
}

/** The call row an entry belongs to, opened empty on its first entry. */
function callFor({
  state,
  entry,
  names,
}: {
  state: CountState;
  entry: TrimmedGcpAuditEntry;
  names: CallNames;
}): CallAccumulator {
  const key = `${names.principal}\u0000${names.serviceName}\u0000${names.methodName}`;
  const known = state.calls.get(key);
  if (known !== undefined) {
    return known;
  }
  const opened: CallAccumulator = {
    agents: new Set(),
    callerIps: new Set(),
    count: 0,
    failed: 0,
    firstSeen: entry.timestamp,
    kinds: {},
    lastSeen: entry.timestamp,
    methodName: names.methodName,
    origins: new Set(),
    principal: names.principal,
    serviceName: names.serviceName,
  };
  state.calls.set(key, opened);
  return opened;
}

/** Count one entry against its principal × service × method row. */
function addCall({ state, entry, names }: { state: CountState; entry: TrimmedGcpAuditEntry; names: CallNames }): void {
  const call = callFor({ entry, names, state });
  call.count += 1;
  call.failed += entry.statusCode !== null && entry.statusCode !== 0 ? 1 : 0;
  widen({ span: call, timestamp: entry.timestamp });
  const kindCount = call.kinds[entry.logKind];
  call.kinds[entry.logKind] = kindCount === undefined ? 1 : kindCount + 1;
  call.origins.add(entry.origin);
  if (entry.callerIp !== null) {
    call.callerIps.add(entry.callerIp);
  }
  call.agents.add(agentFamily({ agent: entry.userAgent }));
}

/** The permission-use row one checked permission belongs to, opened empty on its first use. */
function useFor({
  state,
  key,
  entry,
  principal,
  permission,
  granted,
}: {
  state: CountState;
  key: string;
  entry: TrimmedGcpAuditEntry;
  principal: string;
  permission: string;
  granted: boolean;
}): UseAccumulator {
  const known = state.uses.get(key);
  if (known !== undefined) {
    return known;
  }
  const opened: UseAccumulator = {
    count: 0,
    firstSeen: entry.timestamp,
    granted,
    lastSeen: entry.timestamp,
    methods: new Set(),
    origin: entry.origin,
    permission,
    principal,
  };
  state.uses.set(key, opened);
  return opened;
}

/** Count each permission one entry checked; one event checking it on two resources is still one use. */
function addUses({ state, entry, names }: { state: CountState; entry: TrimmedGcpAuditEntry; names: CallNames }): void {
  const countedHere = new Set<string>();
  for (const row of entry.authorization) {
    const permission = row.permission;
    if (permission === null) {
      continue;
    }
    const key = `${names.principal}\u0000${permission}\u0000${entry.origin}\u0000${String(row.granted)}`;
    if (countedHere.has(key)) {
      continue;
    }
    countedHere.add(key);
    const use = useFor({ entry, granted: row.granted, key, permission, principal: names.principal, state });
    use.count += 1;
    widen({ span: use, timestamp: entry.timestamp });
    use.methods.add(names.methodName);
  }
}

/** Count one stored entry, skipping a copy of an event already counted. */
function addEntry({ state, entry }: { state: CountState; entry: TrimmedGcpAuditEntry }): void {
  if (state.seen.has(entry.eventId)) {
    state.duplicates += 1;
    return;
  }
  state.seen.add(entry.eventId);
  state.derivedIds += entry.eventIdSource === "derived" ? 1 : 0;
  addKind({ entry, state });
  const names = namesOf({ entry });
  addCall({ entry, names, state });
  state.withoutAuthorization += entry.authorization.length === 0 ? 1 : 0;
  addUses({ entry, names, state });
}

/** One call row as the summary reports it, every set sorted. */
function callRowOf({ call }: { call: CallAccumulator }): GcpCallRow {
  return {
    agents: [...call.agents].toSorted(),
    callerIps: [...call.callerIps].toSorted(),
    count: call.count,
    failed: call.failed,
    firstSeen: call.firstSeen,
    kinds: { ...call.kinds },
    lastSeen: call.lastSeen,
    methodName: call.methodName,
    origins: [...call.origins].toSorted(),
    principal: call.principal,
    serviceName: call.serviceName,
  };
}

/** One permission use as the summary reports it. */
function useRowOf({ use }: { use: UseAccumulator }): GcpPermissionUse {
  return {
    count: use.count,
    firstSeen: use.firstSeen,
    granted: use.granted,
    lastSeen: use.lastSeen,
    methods: [...use.methods].toSorted(),
    origin: use.origin,
    permission: use.permission,
    principal: use.principal,
  };
}

/** The count so far, rows sorted: calls by principal then busiest first, uses by principal, origin, permission. */
function summaryOf({ state }: { state: CountState }): GcpAuditSummary {
  return {
    byKind: Object.fromEntries(state.byKind),
    calls: [...state.calls.values()]
      .map((call) => callRowOf({ call }))
      .toSorted(
        (a, b) =>
          a.principal.localeCompare(b.principal) || b.count - a.count || a.methodName.localeCompare(b.methodName),
      ),
    derivedIds: state.derivedIds,
    duplicates: state.duplicates,
    unique: state.seen.size,
    uses: [...state.uses.values()]
      .map((use) => useRowOf({ use }))
      .toSorted(
        (a, b) =>
          a.principal.localeCompare(b.principal) ||
          a.origin.localeCompare(b.origin) ||
          a.permission.localeCompare(b.permission) ||
          Number(b.granted) - Number(a.granted),
      ),
    withoutAuthorization: state.withoutAuthorization,
  };
}

/**
 * Start a count.
 *
 * @returns a counter; `add` each stored entry, then read `result`
 */
export function startCount(): GcpAuditCounter {
  const state: CountState = {
    byKind: new Map(),
    calls: new Map(),
    derivedIds: 0,
    duplicates: 0,
    seen: new Set(),
    uses: new Map(),
    withoutAuthorization: 0,
  };
  return {
    add: ({ entry }) => {
      addEntry({ entry, state });
    },
    result: () => summaryOf({ state }),
  };
}
