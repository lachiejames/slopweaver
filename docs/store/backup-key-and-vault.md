# The backup key, and the Vault leg it seals

Part of [the backup](backup.md). Both follow one owner ruling: the 03:00 backup opens
its key with no prompt, and Vault's table rides the nightly backup.

## The backup key

Every object a backup writes is encrypted under one key ([the object format](backup-objects.md#the-encrypted-object-format)).
The key is 32 random bytes in the macOS login Keychain, under service `slopweaver-backup-key`
(`src/store/backup/backupKeychain.ts`).

- **The 03:00 run opens it with no prompt.** `/usr/bin/security` writes the item, so that program is on its
  access list and reads it back silently while the login Keychain is unlocked. A LOCKED Keychain is never
  prompted for: `security` exits 36 and the backup refuses.
- **The trade the ruling accepted.** Code running as this user can open the key the same way, and that code
  can already read the live store. What the key defends is the destination: somebody who reaches its objects
  without reaching this laptop's unlocked Keychain gets ciphertext.
- **Creating it.** `store backup --create-key` makes the key once and prints only its fingerprint. It
  refuses to replace an existing key, because every earlier backup needs that exact key to read. The write
  goes through `security -i` on stdin, so the key never appears in the process table.
- **Another Mac opens it through the master password.** The key is random rather than derived from a
  password, so the master password wraps it (below) and no backup was ever re-encrypted to make that so.

A writing run with no key refuses. `--local-only` stages without one, and then reports the Vault leg as not
included. Only `store backup` reads the Keychain; every reader of a destination backup opens it through the
wrap.

## The master password wraps the key

The owner's ruling: ONE fleet-generated master password, kept in the operator's password manager, opens every
destination backup on any Mac.

- **Generated, never typed.** `store backup --create-master-password` draws 128 random bits, spelled as 26
  lowercase base32 characters, writes them `0600` to `secrets/backup-passphrase` and puts them on the
  clipboard through `pbcopy`'s stdin for the password manager. They are never printed, never in argv and never
  in a `--json` document or door record. `secrets set` and the wrap refuse a value under 26 characters.
  `--copy-master-password` puts the stored one on the clipboard again.
- **One name.** It is `backup-passphrase`: the same value encrypts `secrets.enc`, the credentials leg. A
  destination that already holds a wrap refuses `--create-master-password`, because its older `secrets.enc`
  was sealed under the password already saved; `secrets set backup-passphrase` puts that one back instead.
- **The wrap.** The key, wrapped under scrypt (N=2^17, r=8, p=1) and AES-256-GCM, is written in plaintext at
  `<project>/keys/<fingerprint>.wrap` on EVERY destination (`src/store/backup/keyWrap.ts`, `keyWrapStore.ts`,
  `keyWrapStep.ts`). Every `store backup` and `--sweep-only` checks it at each destination before that
  destination's first blob, so a destination holding a backup holds the wrap that opens it: an absent wrap is
  written, a present one is opened and left byte for byte, and one the password does not open FAILS that
  destination rather than being replaced, since re-wrapping would strand the password already saved — the next
  destination is still written. With no master password set the run still succeeds and says, per destination,
  that the key is NOT wrapped.
- **The readers.** `store restore --from <destination address>`, `store recover` and `store rehearse` read
  the chosen backup's manifest header for its key fingerprint, fetch that key's wrap and unwrap it — the
  Keychain is never consulted. Restore and recover ask for the password once, on a no-echo prompt or piped
  stdin; the rehearsal reads the `0600` file, so it proves the wiped-Mac path unattended. A missing wrap
  refuses naming `--create-master-password`; a wrong password refuses as such.
- **Checked.** `store backup --check` reports whether the password is set and, per destination, whether it
  holds the current key's wrap.

## The Vault leg

`vault.secrets` lives in the `vault` schema, which is outside the three schemas the dump carries. Its rows
are also encrypted under a key the database server holds outside any dump, so a copy of the table restored
anywhere else is rows nothing can open.

- **How it is read.** The leg reads `vault.decrypted_secrets` instead, writes the rows `0600` into staging,
  seals them at once under the backup key into `vault.enc`, and removes the plaintext whatever happened
  (`src/store/backup/vault.ts`). Each field travels base64 inside CSV, so no value can spell psql's `\.`
  end-of-data line.
- **What blocks a backup.** A row whose ciphertext does not open under the database's own key fails the
  backup: it would be a secret silently lost.
- **What a restore checks.** It refuses a target whose `vault.secrets` already holds rows, then re-creates
  each secret with `vault.create_secret` and checks the count. The rehearsal does the same in its throwaway,
  and fails a manifest that records no Vault leg.
- **The manifest records it either way.** Manifest version 3 makes `vault` a REQUIRED field, `null` or not,
  the same both-directions rule as `secrets`. A version-1 or version-2 manifest reads as `vault: null`.

MEASURED on a throwaway `supabase/postgres:17.6.1.143`: the `postgres` role, which is not a
superuser there, can create the extension in a fresh database, call `vault.create_secret` and read
`decrypted_secret`, which is every privilege the leg uses. The repro is in `src/store/backup/vault.ts`'s
header.
