/**
 * What one card snapshot says — headroom, the latest declines and what the page proves about them, and the
 * charged totals per merchant and per month. Pure.
 *
 * A charge's merchant is the install's own register (`./merchants/core.ts`), passed in: a registered merchant's
 * charges group under its slug, and every other charge under its own merchant string, never one shared bucket.
 *
 * ## What a decline reading can and cannot claim
 *
 * The page shows the monthly used figure on the CAPTURE day and gives no reason for any decline. So a
 * decline is set against two things the page does prove: the headroom today, and a floor on the headroom it
 * had then — today's headroom plus everything charged on a later day, because each of those went through
 * after it, minus any cancelled or verification hold from before it, which may have been holding headroom
 * then and released since. When every decline is in the limit's currency, inside the capture day's period
 * and under that floor, the monthly limit was not what declined it, and the report says so rather than
 * letting a reader infer the obvious wrong story; anything short of that is `possible`, with the reason.
 * For example, a decline of 50.00 followed by a 200.00 charge on a later day puts the floor at today's headroom
 * plus 200.00, above the declined amount even when today's headroom alone is below it.
 */
import {
  type MerchantIdentity,
  merchantIdentityKey,
  merchantIdentityOf,
  type SpendMerchant,
} from "./merchants/core.js";
import { sumByCurrency } from "./money.js";
import type {
  CardReport,
  CardSnapshot,
  LatestDeclines,
  LimitVerdict,
  MerchantTotal,
  Money,
  MonthTotal,
} from "./types.js";

/**
 * Where the capture day's monthly period could have opened. The page says only "resets <Mon> <day>", so the previous
 * reset is read BOTH ways it could be — the same day a month earlier (clamped to that month's length), or the end
 * of the previous month — and each bound takes the reading that is safe for its use.
 *
 * @param resetsOn the capture-day period's reset day, `YYYY-MM-DD`
 * @returns `opensAfter`: the last day a decline could still belong to the PREVIOUS period — the later reading, plus
 *   a day for a reset that lands "the following day"; `earliest`: the first day a hold could belong to THIS one —
 *   the earlier reading
 */
function periodBounds({ resetsOn }: { resetsOn: string }): { opensAfter: string; earliest: string } {
  const reset = new Date(`${resetsOn}T00:00:00Z`);
  const year = reset.getUTCFullYear();
  const month = reset.getUTCMonth() + 1;
  const day = reset.getUTCDate();
  const previousMonthEnd = Date.UTC(year, month - 1, 0);
  const sameDay = Date.UTC(year, month - 2, Math.min(day, new Date(previousMonthEnd).getUTCDate()));
  const iso = ({ ms }: { ms: number }): string => new Date(ms).toISOString().slice(0, 10);
  const later = new Date(Math.max(sameDay, previousMonthEnd));
  later.setUTCDate(later.getUTCDate() + 1);
  return { earliest: iso({ ms: Math.min(sameDay, previousMonthEnd) }), opensAfter: iso({ ms: later.getTime() }) };
}

/**
 * Why the page cannot rule the monthly limit out, one reason per failed condition — none when it can.
 *
 * @param reading the declines, with their floor
 * @param currency the limit's currency
 * @param heldElsewhere currencies of earlier holds the floor could not subtract
 * @returns the reasons, empty when the limit is ruled out
 */
function unprovenBecause({
  currency,
  heldElsewhere,
  reading,
}: {
  currency: string;
  heldElsewhere: readonly string[];
  reading: Omit<LatestDeclines, "limitVerdict">;
}): readonly string[] {
  if (reading.date <= reading.periodOpensAfter) {
    return [`they may fall in the monthly period before the one the page's used figure covers`];
  }
  const reasons: string[] = [];
  const otherCurrency = reading.rows.filter((row) => row.amount.currency !== currency);
  if (otherCurrency.length > 0) {
    reasons.push(`${String(otherCurrency.length)} of them cannot be set against a ${currency} limit without a rate`);
  }
  if (heldElsewhere.length > 0) {
    reasons.push(
      `an earlier hold in ${heldElsewhere.join(", ")} lowered the headroom by an amount the page cannot price`,
    );
  }
  const over = reading.rows.filter(
    (row) => row.amount.currency === currency && row.amount.minor > reading.headroomThenAtLeast.minor,
  );
  if (over.length > 0) {
    reasons.push(`that floor is below ${String(over.length)} of them`);
  }
  return reasons;
}

/**
 * One declined row as the reading reports it: against the capture-day headroom, under its register identity.
 *
 * @param row the declined transaction
 * @param headroom the capture-day headroom
 * @param merchants the install's registered merchants
 * @returns the reported row
 */
function declineRow({
  headroom,
  merchants,
  row,
}: {
  headroom: Money;
  merchants: readonly SpendMerchant[];
  row: CardSnapshot["transactions"][number];
}): LatestDeclines["rows"][number] {
  let exceedsHeadroomAsOf: "yes" | "no" | "different-currency" = "no";
  if (row.amount.currency !== headroom.currency) {
    exceedsHeadroomAsOf = "different-currency";
  } else if (row.amount.minor > headroom.minor) {
    exceedsHeadroomAsOf = "yes";
  }
  let reason: string | null = null;
  if (row.declineReason !== undefined) {
    reason = row.declineReason;
  }
  return {
    amount: row.amount,
    exceedsHeadroomAsOf,
    identity: merchantIdentityOf({ merchant: row.merchant, merchants }),
    merchant: row.merchant,
    reason,
  };
}

/**
 * The most recent decline date and what the page proves about the limit on it.
 *
 * @param snapshot the card snapshot
 * @param headroom the capture-day headroom
 * @param merchants the install's registered merchants
 * @returns the reading, or null when the page shows no decline
 */
function latestDeclines({
  headroom,
  merchants,
  snapshot,
}: {
  headroom: Money;
  merchants: readonly SpendMerchant[];
  snapshot: CardSnapshot;
}): LatestDeclines | null {
  const declined = snapshot.transactions.filter((row) => row.status === "declined");
  if (declined.length === 0) {
    return null;
  }
  const date = declined
    .map((row) => row.date)
    .toSorted()
    .at(-1)!;
  const { earliest, opensAfter } = periodBounds({ resetsOn: snapshot.monthly.resetsOn });
  const chargedAfter = snapshot.transactions
    .filter((row) => row.status === "charged" && row.date > date)
    .map((row) => row.amount);
  const heldBefore = snapshot.transactions
    .filter((row) => row.status === "cancelled" || row.status === "card-verification")
    .filter((row) => row.date <= date && row.date >= earliest && row.amount.minor !== 0)
    .map((row) => row.amount);
  const inCurrency = ({ amounts }: { amounts: readonly Money[] }): number =>
    amounts.filter((amount) => amount.currency === headroom.currency).reduce((sum, amount) => sum + amount.minor, 0);
  const reading = {
    chargedAfter,
    date,
    headroomThenAtLeast: {
      currency: headroom.currency,
      minor: headroom.minor + inCurrency({ amounts: chargedAfter }) - inCurrency({ amounts: heldBefore }),
    },
    heldBefore,
    periodOpensAfter: opensAfter,
    rows: declined.filter((row) => row.date === date).map((row) => declineRow({ headroom, merchants, row })),
  };
  const heldElsewhere = [
    ...new Set(heldBefore.map((amount) => amount.currency).filter((code) => code !== headroom.currency)),
  ];
  const because = unprovenBecause({ currency: headroom.currency, heldElsewhere, reading });
  let limitVerdict: LimitVerdict = { kind: "ruled-out" };
  if (because.length > 0) {
    limitVerdict = { because, kind: "possible" };
  }
  return { ...reading, limitVerdict };
}

/**
 * Charged totals per merchant group, per currency — declines, cancellations and card verifications excluded.
 *
 * @param snapshot the card snapshot
 * @param merchants the install's registered merchants
 * @returns one row per group present, registered merchants first, then each other merchant string
 */
function totalsByMerchant({
  snapshot,
  merchants,
}: {
  snapshot: CardSnapshot;
  merchants: readonly SpendMerchant[];
}): readonly MerchantTotal[] {
  const groups = new Map<string, { identity: MerchantIdentity; merchants: Set<string>; amounts: Money[] }>();
  for (const row of snapshot.transactions.filter((candidate) => candidate.status === "charged")) {
    const identity = merchantIdentityOf({ merchant: row.merchant, merchants });
    const key = merchantIdentityKey({ identity });
    let group = groups.get(key);
    if (group === undefined) {
      group = { amounts: [], identity, merchants: new Set() };
      groups.set(key, group);
    }
    group.merchants.add(row.merchant);
    group.amounts.push(row.amount);
  }
  // A registered key opens `merchant:` and a raw one `raw:`, so key order puts every registered merchant first.
  return [...groups.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({
      charges: group.amounts.length,
      identity: group.identity,
      merchants: [...group.merchants].toSorted(),
      totals: sumByCurrency({ amounts: group.amounts }),
    }));
}

/**
 * Charged totals per calendar month and merchant group, per currency.
 *
 * @param snapshot the card snapshot
 * @param merchants the install's registered merchants
 * @returns one row per month and group, oldest month first
 */
function totalsByMonth({
  snapshot,
  merchants,
}: {
  snapshot: CardSnapshot;
  merchants: readonly SpendMerchant[];
}): readonly MonthTotal[] {
  const groups = new Map<string, { month: string; identity: MerchantIdentity; amounts: Money[] }>();
  for (const row of snapshot.transactions.filter((candidate) => candidate.status === "charged")) {
    const month = row.date.slice(0, 7);
    const identity = merchantIdentityOf({ merchant: row.merchant, merchants });
    const key = `${month} ${merchantIdentityKey({ identity })}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { amounts: [], identity, month };
      groups.set(key, group);
    }
    group.amounts.push(row.amount);
  }
  return [...groups.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({
      identity: group.identity,
      month: group.month,
      totals: sumByCurrency({ amounts: group.amounts }),
    }));
}

/**
 * Everything `spend read` says about one card.
 *
 * @param snapshot the card snapshot
 * @param merchants the install's registered merchants, empty when it registers none
 * @returns the report
 */
export function cardReport({
  snapshot,
  merchants,
}: {
  snapshot: CardSnapshot;
  merchants: readonly SpendMerchant[];
}): CardReport {
  const headroom: Money = {
    currency: snapshot.monthly.limit.currency,
    minor: snapshot.monthly.limit.minor - snapshot.monthly.used.minor,
  };
  return {
    asOf: snapshot.asOf,
    byMerchant: totalsByMerchant({ merchants, snapshot }),
    byMonth: totalsByMonth({ merchants, snapshot }),
    declineCount: snapshot.transactions.filter((row) => row.status === "declined").length,
    last4: snapshot.last4,
    latestDeclines: latestDeclines({ headroom, merchants, snapshot }),
    merchantAllow: snapshot.merchantAllow,
    monthly: { ...snapshot.monthly, headroom },
    nickname: snapshot.nickname,
    organisation: snapshot.organisation,
    provider: snapshot.provider,
    source: snapshot.source,
    transactionLimit: snapshot.transactionLimit,
  };
}
