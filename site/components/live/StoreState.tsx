"use client";

import { type ReactElement } from "react";

import { StaleMark } from "../console/StaleMark";
import { ReadMark, ReadStandIn } from "./LiveMarks";
import { type HomeShare, type HygieneReport, readHygiene, readShare } from "./readStoreState";
import { useLive } from "./useLive";

/**
 * The two tiles on the atlas page that are about the machine's STATE rather than about its code: what each
 * record kind still holds under `~/.slopweaver` against the store table it mirrors into, and how long since
 * the memory hygiene pass last ran.
 *
 * A sibling of `./CodebaseHealth.tsx` rather than more of it, for the reason the page it renders is about:
 * that file crossed the 300 code-line bar the owner named while rendering the count of files that
 * cross it. The split is by SUBJECT and not by size — these two tiles read two different verbs, share every
 * helper below with each other and none with the code half, and both render ABSENCE as a first-class value
 * where the code half never has to.
 */

/** Bytes per mebibyte. */
const MIB = 1024 * 1024;

/**
 * A size, or the word that says none was taken.
 *
 * @param bytes the measured size, absent when the register was declared-only
 * @returns the cell text
 */
function sizeOf({ bytes }: { bytes: number | undefined }): string {
  if (bytes === undefined) {
    return "not measured";
  }
  if (bytes >= MIB) {
    return `${(bytes / MIB).toFixed(1)} MiB`;
  }
  return `${String(Math.round(bytes / 1024))} KiB`;
}

/**
 * What a register's store cell says.
 *
 * A function rather than a nested ternary in the JSX, per the house rule and per the steer this page is
 * about: three outcomes read as three `if`s and as nothing else when spelled inline.
 *
 * @param table the store table it mirrors into, absent when nothing does
 * @param storeRows that table's live row count, absent when the store could not be read or holds no such table
 * @param storeUnreadBecause why the store could not be read for it — drawn as the table and a staleness mark whose
 *   hover says so, never a word in the count's place
 * @returns the cell
 */
function storeCellOf({
  table,
  storeRows,
  storeUnreadBecause,
}: {
  table: string | undefined;
  storeRows: number | undefined;
  storeUnreadBecause: string | undefined;
}): string | ReactElement {
  if (table === undefined) {
    return "no table";
  }
  if (storeRows === undefined && storeUnreadBecause !== undefined) {
    return (
      <span className="inline-flex items-center gap-[0.35rem]">
        {table}
        <StaleMark facts={[{ subject: `${table}'s row count`, why: storeUnreadBecause }]} />
      </span>
    );
  }
  // Nothing failed and no count came back: the store holds no such table, which is the data.
  if (storeRows === undefined) {
    return `${table} · no such table in the store`;
  }
  return `${table} · ${String(storeRows)} rows`;
}

/**
 * Why a register is not fully accounted for, when it is not.
 *
 * @param unmirroredBecause why nothing mirrors it
 * @param unmeasuredBecause why no size was taken
 * @returns the reason, or an empty cell when neither applies
 */
function caveatOf({
  unmirroredBecause,
  unmeasuredBecause,
}: {
  unmirroredBecause: string | undefined;
  unmeasuredBecause: string | undefined;
}): string {
  if (unmirroredBecause !== undefined) {
    return unmirroredBecause;
  }
  if (unmeasuredBecause !== undefined) {
    return unmeasuredBecause;
  }
  return "";
}

/**
 * What a register's home cell says.
 *
 * @param present whether the path is there at all
 * @param homeBytes its size, absent when it was never walked
 * @param homeRecords its record count, absent for the same reason
 * @returns the cell text
 */
function homeCellOf({
  present,
  homeBytes,
  homeRecords,
}: {
  present: boolean;
  homeBytes: number | undefined;
  homeRecords: number | undefined;
}): string {
  if (!present) {
    return "absent";
  }
  if (homeRecords === undefined) {
    return sizeOf({ bytes: homeBytes });
  }
  return `${sizeOf({ bytes: homeBytes })} / ${String(homeRecords)} rec`;
}

/**
 * How stale the newest hygiene pass is, in words.
 *
 * @param days whole days since it ran, absent when no pass has ever run
 * @returns the phrase
 */
function ageOf({ days }: { days: number | undefined }): string {
  if (days === undefined) {
    return "never run";
  }
  return `${String(days)} day(s) ago`;
}

/**
 * What still sits only under `~/.slopweaver`, against the store table each kind mirrors into.
 *
 * @returns the store-share half of the page
 */
export function StoreShare(): ReactElement {
  const state = useLive<HomeShare>({ read: readShare, slug: "share" });
  if (state.phase !== "ready") {
    return <ReadStandIn state={state} subject="each register's share of the store" block />;
  }
  const share = state.value;
  const durable = share.durableMirrored + share.durableUnmirrored;
  return (
    <div className="sw-catalog">
      <ReadMark state={state} subject="The store's share" row />
      <p className="sw-tile-note">
        {String(share.durableMirrored)} of {String(durable)} durable registers are mirrored into the store;{" "}
        {String(share.durableUnmirrored)} are not, holding {sizeOf({ bytes: share.durableUnmirroredBytes })}. Derived
        live by <code>slopweaver store share --json</code>.
      </p>
      <table className="sw-tile-table sw-atlas-table">
        <thead>
          <tr>
            <th>record kind</th>
            <th>under the home</th>
            <th>in the store</th>
            <th>why not, when not</th>
          </tr>
        </thead>
        <tbody>
          {share.registers.map((register) => (
            <tr key={register.kind}>
              <td>
                <code>{register.relativePath}</code>
              </td>
              <td>
                {homeCellOf({
                  homeBytes: register.homeBytes,
                  homeRecords: register.homeRecords,
                  present: register.present,
                })}
              </td>
              <td>
                {storeCellOf({
                  storeRows: register.storeRows,
                  storeUnreadBecause: register.storeUnreadBecause,
                  table: register.table,
                })}
              </td>
              <td>
                {caveatOf({
                  unmeasuredBecause: register.unmeasuredBecause,
                  unmirroredBecause: register.unmirroredBecause,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sw-tile-note">
        Bound of the measurement, stated rather than left to be inferred: {String(share.residueUnclassified)} of{" "}
        {String(share.residueTotal)} top-level entries under the home are claimed by no register above (e.g.{" "}
        {share.residueSample.slice(0, 6).join(", ")}), and the scratch tier ({share.scratchRegisters.join(", ")}) is
        named and never walked, because walking it costs more than this whole page.
      </p>
    </div>
  );
}

/**
 * How long since the last memory hygiene pass.
 *
 * @returns the hygiene tile
 */
export function MemoryHygiene(): ReactElement {
  const state = useLive<HygieneReport>({ read: readHygiene, slug: "hygiene" });
  if (state.phase !== "ready") {
    return <ReadStandIn state={state} subject="the hygiene ledger" block />;
  }
  const report = state.value;
  if (report.lastPassIso === undefined) {
    return (
      <div className="sw-catalog">
        <ReadMark state={state} subject="The hygiene ledger" row />
        <p className="sw-tile-note">
          No hygiene pass has ever run on this home. That is a different fact from one swept this morning, so it is said
          rather than shown as zero days. Ledger: <code>{report.ledgerPath}</code>.
        </p>
      </div>
    );
  }
  return (
    <div className="sw-catalog">
      <ReadMark state={state} subject="The hygiene ledger" row />
      <p className="sw-tile-note">
        {String(report.passes.length)} pass(es) recorded; the last ran {ageOf({ days: report.daysSinceLastPass })} (
        {report.lastPassIso}). A PASS is one instant, not one row: a single run stamps every proposal it writes with the
        same timestamp. Derived live by <code>slopweaver memory passes --json</code>.
      </p>
      <table className="sw-tile-table sw-atlas-table">
        <thead>
          <tr>
            <th>pass</th>
            <th>proposals</th>
            <th>accepted</th>
            <th>refused</th>
          </tr>
        </thead>
        <tbody>
          {report.passes.map((pass) => (
            <tr key={pass.tsIso}>
              <td>{pass.tsIso}</td>
              <td>{String(pass.proposals)}</td>
              <td>{String(pass.accepted)}</td>
              <td>{String(pass.refused)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
