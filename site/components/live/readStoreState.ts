/**
 * Readers for the two verbs on the atlas page that describe the machine's STATE rather than its code:
 * `store share` and `memory passes`.
 *
 * A sibling of `./readHealth.ts` for the reason both files exist — see that file's own header for every
 * rule they share, and `./read.ts` for the originals. What is particular to these two is stated there and
 * is the whole reason they are not in `read.ts`: **both payloads carry ABSENCE as a value.** `store share`
 * reports a register it deliberately did not measure, and `memory passes` reports a home no pass has ever
 * run on. Neither is a malformed reading, so `homeBytes` and `daysSinceLastPass` are typed `| undefined`
 * and rendered as the absence they are, while the fields a tile's claim rests on still refuse.
 */

import { bags, isBag, num, str, strings, sub } from "../../lib/bag";

/** One home register, measured on both sides. */
export interface ShareRegister {
  readonly kind: string;
  readonly relativePath: string;
  readonly tier: string;
  readonly present: boolean;
  /** Absent when the register was declared-only — see `src/store/homeShare.ts` § measure. */
  readonly homeBytes: number | undefined;
  readonly homeRecords: number | undefined;
  readonly unmeasuredBecause: string | undefined;
  readonly table: string | undefined;
  readonly storeRows: number | undefined;
  /** Why the store could not be read for that count; absent on a count read, and on a table the store does not hold. */
  readonly storeUnreadBecause: string | undefined;
  readonly unmirroredBecause: string | undefined;
}

/** What `store share` reports. */
export interface HomeShare {
  readonly registers: readonly ShareRegister[];
  readonly durableMirrored: number;
  readonly durableUnmirrored: number;
  readonly durableUnmirroredBytes: number;
  readonly scratchRegisters: readonly string[];
  readonly unclassifiedTables: readonly string[];
  readonly residueTotal: number;
  readonly residueUnclassified: number;
  readonly residueSample: readonly string[];
}

/**
 * Read `store share --json`.
 *
 * @param payload the verb's parsed stdout
 * @returns the share reading, or `undefined` when the verb's shape moved
 */
export function readShare(payload: unknown): HomeShare | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "registers" });
  const residue = sub({ bag: payload, key: "residue" });
  const scratchRegisters = strings({ bag: payload, key: "scratchRegisters" });
  const unclassifiedTables = strings({ bag: payload, key: "unclassifiedTables" });
  const durableMirrored = num({ bag: payload, key: "durableMirrored" });
  const durableUnmirrored = num({ bag: payload, key: "durableUnmirrored" });
  const durableUnmirroredBytes = num({ bag: payload, key: "durableUnmirroredBytes" });
  if (
    rows === undefined ||
    residue === undefined ||
    scratchRegisters === undefined ||
    unclassifiedTables === undefined ||
    durableMirrored === undefined ||
    durableUnmirrored === undefined ||
    durableUnmirroredBytes === undefined
  ) {
    return undefined;
  }
  const residueTotal = num({ bag: residue, key: "topLevelEntries" });
  const residueUnclassified = num({ bag: residue, key: "unclassified" });
  const residueSample = strings({ bag: residue, key: "sample" });
  if (residueTotal === undefined || residueUnclassified === undefined || residueSample === undefined) {
    return undefined;
  }
  const registers: ShareRegister[] = [];
  for (const row of rows) {
    const kind = str({ bag: row, key: "kind" });
    const relativePath = str({ bag: row, key: "relativePath" });
    const tier = str({ bag: row, key: "tier" });
    const present = row["present"];
    if (kind === undefined || relativePath === undefined || tier === undefined || typeof present !== "boolean") {
      return undefined;
    }
    registers.push({
      homeBytes: num({ bag: row, key: "homeBytes" }),
      homeRecords: num({ bag: row, key: "homeRecords" }),
      kind,
      present,
      relativePath,
      storeRows: num({ bag: row, key: "storeRows" }),
      storeUnreadBecause: str({ bag: row, key: "storeUnreadBecause" }),
      table: str({ bag: row, key: "table" }),
      tier,
      unmeasuredBecause: str({ bag: row, key: "unmeasuredBecause" }),
      unmirroredBecause: str({ bag: row, key: "unmirroredBecause" }),
    });
  }
  return {
    durableMirrored,
    durableUnmirrored,
    durableUnmirroredBytes,
    registers,
    residueSample,
    residueTotal,
    residueUnclassified,
    scratchRegisters,
    unclassifiedTables,
  };
}

/** One recorded hygiene pass. */
export interface HygienePass {
  readonly tsIso: string;
  readonly proposals: number;
  readonly accepted: number;
  readonly refused: number;
}

/** What `memory passes` reports. */
export interface HygieneReport {
  readonly passes: readonly HygienePass[];
  /** Absent on a home no pass has ever run on — a different fact from a pass taken today. */
  readonly lastPassIso: string | undefined;
  readonly daysSinceLastPass: number | undefined;
  readonly ledgerPath: string;
}

/**
 * Read `memory passes --json`.
 *
 * @param payload the verb's parsed stdout
 * @returns the hygiene reading, or `undefined` when the verb's shape moved
 */
export function readHygiene(payload: unknown): HygieneReport | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const rows = bags({ bag: payload, key: "passes" });
  const ledgerPath = str({ bag: payload, key: "ledgerPath" });
  if (rows === undefined || ledgerPath === undefined) {
    return undefined;
  }
  const passes: HygienePass[] = [];
  for (const row of rows) {
    const tsIso = str({ bag: row, key: "tsIso" });
    const proposals = num({ bag: row, key: "proposals" });
    const accepted = num({ bag: row, key: "accepted" });
    const refused = num({ bag: row, key: "refused" });
    if (tsIso === undefined || proposals === undefined || accepted === undefined || refused === undefined) {
      return undefined;
    }
    passes.push({ accepted, proposals, refused, tsIso });
  }
  return {
    daysSinceLastPass: num({ bag: payload, key: "daysSinceLastPass" }),
    lastPassIso: str({ bag: payload, key: "lastPassIso" }),
    ledgerPath,
    passes,
  };
}
