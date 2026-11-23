# How a backup's bytes are stored: blobs and chunks

The object layout under [the backup](backup.md): what a night sends, what it skips, and what a restore checks.

**A file's BYTES live at `<project>/blobs/<sha256>`, not under the prefix.** Content-addressed, so a bronze
window that did not change tonight costs one size check rather than a re-upload, and two paths with the
same bytes share one object. That is what makes a nightly backup of 8.4 GB of bronze affordable.

**The upload reads a BOUNDED prefix and re-hashes what it sent, because half the backed-up files are being
written while it runs.** The walk measures each file's length and digest when the manifest is written; the
upload streams the file off disk much later. MEASURED on the first real backup:
`knowledge/lessons.jsonl` was walked at about a megabyte and streamed at the end of a roughly two-hour upload, by which
time the fleet had appended to it and it held a few percent more. The object landed under `blobs/<sha256>` named for
the digest of the SHORTER content, carrying the longer. Three things follow, and each
is the rule rather than a note:

- **The read is bounded to the length the walk measured.** For an append-only file that prefix IS the content
  that was digested, so the blob matches its own name. `slopweaver knowledge` and every ledger under the
  backed-up roots are append-only, which is why this is the common case rather than the exotic one. The
  exception is `atlas`, and it is the first root on the list where a file is REWRITTEN IN PLACE. A publish
  replaces a kind file through `writeFileAtomic`; most artifacts are named for their own SHA-256 and so
  are written once, but not all of them are. `atlas/vanta/policyDocuments.ts` puts a policy document at
  `artifacts/policy-document/<providerId>/source.pdf` — or `source.bin`, when the downloaded bytes turn out
  not to be a PDF at all — a stable path a re-sync overwrites with whatever the provider now serves. MEASURED: most of some three and a half thousand artifact files carry a 64-hex basename
  and a few hundred do not. Reproduce with
  `find "$SLOPWEAVER_HOME/atlas" -path '*artifacts*' -type f | grep -cE '/[0-9a-f]{64}\.[a-z]+$'`.
  So the bound does NOT cover this root, and the next bullet is what does.
- **Every blob the destination lacks is FROZEN before it is hashed.** The walk's digest only decides which files
  the destination lacks; each of those is cloned into `<staging>/snapshot/` (`COPYFILE_FICLONE` — an APFS clone
  costs no bytes, another filesystem falls back to a copy) and the CLONE is digested, named and sent, so an
  object's name is the digest of bytes nothing else can touch. When the clone digests differently from the
  walk, the file changed in between, and `files.json` is rewritten to name the clone. MEASURED:
  before the freeze, a resync rewrote `atlas/linear/manifest.json` under a nightly run and failed the whole
  night, dump included. Only the missing blobs are frozen, because the roots are over ten thousand files and tens of GB on
  this install and a copy of all of them is what a filesystem with no clone would pay. The bound above is
  a second line behind this one.
- **A file that is GONE by its digest or its freeze is left out and counted, never failed.** MEASURED on one
  run: a Trelica walk wrote a page screenshot as `atlas/trelica/artifacts/pages/<epoch-ms>.png`
  and removed it a moment later (`src/browser/playwrightCli.ts`), the walk had already listed it, and the
  digest's `stat` failed `ENOENT` — the whole night, dump included. So an exact `ENOENT` at the walk's digest
  (`ARTEFACT_VANISHED`), a small file's clone or a large file's clone, WITH the live file confirmed absent,
  omits that file from `files.json` and adds it to the leg's `vanished` count — one `skipped N file(s)` line
  under `files first`, silent at zero. The confirmation is because a clone names two paths: a snapshot
  directory gone from under the leg throws the same `ENOENT` with the source still there, and that is a
  failure. Every other failure — a permission error, `ENOTDIR`, a whole root missing before its listing —
  still stops the backup (`src/store/backup/fileRace.ts`). A file listed and then REPLACED between `stat` and
  `open` is not closed by this; the freeze above is what protects the bytes that are sent.
- **The transport hashes the bytes as they stream and returns that digest**, and a blob whose digest does not
  match the name it was going to be stored under is REMOVED and the backup refuses. With the freeze in place a
  resync cannot cause that; it is the check that what landed is the frozen copy it was named for.
- **The skip test compares SIZE, not presence.** A name-only test is what would have made the poisoned blob
  permanent: every later backup would have found the name, skipped it, and trusted bytes that do not hash to
  it. A wrong length re-uploads.

**Its residue, stated rather than discovered**: the ONE path that can still leave a wrong object at the
destination is a removal that itself fails, and the refusal says so in three lines — the mismatch, that the object
is still there, and that it must be deleted by hand before the next backup, because its size now matches its
name and the size test will accept it. That whole sentence is ONE message from the backup leg's own
`BackupUploadError` union, not three lines assembled at the refusal site. A refusal that printed only "deleting … failed" would leave a reader
with no reason to know that.

Each is a falsifiable witness in `src/__tests__/unit/store/backupRunFilesLeg.test.ts` or
`backupRunFilesLegVanished.test.ts` — send the live file instead
of the clone and the in-flight-rewrite test reddens, skip the `files.json` rewrite and the rewritten-after-
the-walk test reddens, drop the digest comparison and the not-the-frozen-copy test reddens, make the skip
test name-only and the wrong-length test reddens, rebuild the unsettled tail of `files.json` from
`entries.length` instead of the walk index and the vanished-before-a-rewrite test reddens. The vanished-file
witnesses for the walk itself sit in `backupFileRoots.test.ts`. Reproduce with `yarn vitest run --config
config/vitest/unit.ts src/__tests__/unit/store/backupRunFilesLeg.test.ts
src/__tests__/unit/store/backupRunFilesLegVanished.test.ts src/__tests__/unit/store/backupFileRoots.test.ts`.

**The dump and every file of 64 MiB or more go as CHUNKS, because written whole they would be written
whole every night.** MEASURED: both the nightly dump and the Slack bronze
`compact.jsonl` are multi-gigabyte objects. Sent whole, each is written again in full under a new digest
whenever it changes at all. So `src/store/backup/chunks.ts` cuts such a file by CONTENT (FastCDC, 1/4/8
MiB bounds), names each chunk by the SHA-256 of its raw bytes at `<project>/chunks/<encoding>/<sha256>`, and
the manifest (`dump.chunked`) or `files.json` entry (`chunked`) lists them in order. A night then sends only
the chunks the destination lacks, from one listing of the prefix. Replaying staged dumps through the cut, each
against the one before it, a multi-gigabyte dump cut into hundreds of chunks found almost all of them already
held and sent only tens of MB.

Cutting a dump costs seconds. The next run's own
`dump:` report line (`N chunk(s), H already held, S sent`) re-measures it. A large file goes as zstd level 3 —
the first 64 MiB of the Slack bronze stores in 12.5% of its size (`head -c 67108864 <file> | zstd -3 | wc -c`)
— and the dump, already compressed by `pg_dump -Fc`, goes as `identity`.

- **A chunk is named for its RAW bytes, and a restore checks both halves.** The held test is exact size for `identity`
  and a non-empty object for `zstd`, whose stored size the name cannot predict; a restore re-hashes every
  decoded chunk and the whole rebuilt file, and refuses — leaving no target behind — on either mismatch.
- **The file is frozen and cut BEFORE anything is sent**, so `files.json` lists the chunks of the clone that
  is read, the same promise the blob freeze above keeps.
- **A manifest written before chunks existed still restores.** Version 1 has no `chunked` field and reads as
  `null`, which fetches the whole `store.dump` or blob exactly as before.

Each is a witness in `src/__tests__/unit/store/backupChunks/` and the large-file round trip in
`backupRunRestore.test.ts` — `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/store/backupChunks/`.

## The encrypted object format

Every object above reaches the destination as ciphertext under the backup key, and every caller still speaks
plaintext. `encryptingTransport` (`src/store/backup/encryptingTransport.ts`) wraps the local transport, and
it is the only way to obtain a transport that encrypts. It returns the transport bundled with the scheme and
the key's fingerprint. A caller that must never write plaintext (the Vault leg) takes that bundle as its
type, rather than trusting a boolean passed beside a transport.

One object is laid out as follows (`src/store/backup/objectCrypto.ts`, scheme `aes-256-gcm-stream-v1`):

| bytes | what                                                                    |
| ----- | ----------------------------------------------------------------------- |
| 7     | the magic `SWOBJ1\n`                                                    |
| 8     | the first 8 bytes of the key's SHA-256 — which key it was written under |
| 12    | a fresh random IV                                                       |
| n     | the AES-256-GCM ciphertext, streamed, never held whole                  |
| 16    | the GCM tag                                                             |

The 27-byte header is the additional authenticated data, so a changed fingerprint or IV fails
authentication like a changed byte of ciphertext. The overhead is a fixed 43 bytes, so the skip test above
still compares an exact plaintext length: `objectSizes` maps each stored length back, and leaves out an
object too short to be whole, so that object reads as absent and is written again.

**A read refuses, and writes nothing, on each of these:**

- an object that does not open with `SWOBJ1` (`OBJECT_NOT_ENCRYPTED`);
- one written under another key, naming both fingerprints (`OBJECT_KEY_MISMATCH`);
- a truncated object (`OBJECT_TRUNCATED`);
- a target that resolves inside the destination, so no read can replace a stored object
  (`OBJECT_TARGET_INSIDE_DESTINATION`);
- any changed byte (`OBJECT_AUTHENTICATION_FAILED`).

Plaintext is written to a private scratch file and renamed over the target only once the tag verifies, so a
failed read leaves an existing target untouched.

**A write checks what landed against what it sealed.** The encrypting layer hashes the ciphertext as it is
written and compares the destination's reported length and SHA-256 against it. A short or substituted
object is `OBJECT_LANDED_WRONG`, because the facts handed up are the plaintext's, and no check above this
layer could otherwise see it.

Witnesses: `objectCrypto.test.ts` and `encryptingTransport.test.ts` —
`yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/store/objectCrypto.test.ts src/__tests__/unit/store/encryptingTransport.test.ts`.
