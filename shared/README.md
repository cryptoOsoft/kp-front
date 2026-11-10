# Shared files: KP Front ↔ KP Rück

This folder is byte-identical in [kp-front](https://github.com/feuerwehr-oberwil/kp-front) and
[kp-rueck](https://github.com/feuerwehr-oberwil/kp-rueck).

The two products are separate on purpose. Each has its own database, its own image and its own
releases, and neither imports the other. A few files still have to stay the same in both, so
they are shared **by copy**. There is no package and no third repository:

| Item | What a drift would mean |
|---|---|
| `telemetry` | one app could leak what the other strips |
| `alarm-keywords` | the same alarm could be classified differently |
| `roster-snapshot` | one station's roster file could be valid for one product and refused by the other |
| `station-index` | one station's `index.json` could resolve to different files in the two products |
| `alarm-intake` | one dispatch webhook could be accepted by one app and refused by the other |
| `snail` | the two apps would show a different loading mascot |
| `shared-check` | the two repositories would check different things |

Some neighbours are left out on purpose. Of the telemetry package, only the sanitiser
(`scrub.py`) and the local crash buffer (`recent.py`) are shared: KP Front deleted its
crash-report forwarder on 09.11.2026, so `envelope.py`, `outbox.py`, `forwarder.py`,
`consent.py`, `dsn.py` and the package's `__init__.py` are KP Rück's own. Everything that
decides what a crash entry *contains* is shared.

[`MANIFEST.json`](MANIFEST.json) lists every shared file with its path in each repository,
the **owner** (the repository where an edit is made first) and its sha256.
[`scripts/check_shared.py`](../scripts/check_shared.py) checks the copies against it. It needs
only the standard library.

## The two checks

- **In-repo, offline:** `backend/tests/test_shared_files.py` runs in each repository's
  backend tests. It fails when a file here no longer matches the manifest. It cannot see the
  other repository.
- **Cross-repo, in CI:** the job «Shared files match KP Rück» (in kp-front) and «Shared files
  match KP Front» (in kp-rueck) checks out the other repository and runs
  `python3 scripts/check_shared.py --sibling <checkout>`. It compares the two manifests,
  verifies each side's files against its own manifest, and prints a diff for any file that
  differs. The job is required on `main` in both repositories.

On a pull request, the job checks out the sibling's branch **with the same name**. If no such
branch exists, it uses the sibling's default branch. On a push to `main`, it reads the merged
branch's name from the merge commit and does the same.

## Changing a shared file

1. Make the edit in the **owning** repository. For every item today that is kp-front.
   Regenerate whatever the file comes from, such as `just roster-schema`.
2. Copy the changed file **byte for byte** to the other repository, at its path from the
   manifest. The paths are the same in both repositories except where an entry lists one per
   repository, such as the snail.
3. Run `python3 scripts/check_shared.py --update` in **one** repository and copy
   `shared/MANIFEST.json` to the other. Or run `--update` in both: the result is the same bytes.
4. Run both test suites. Each repository still tests its own use of the file, for example its
   own column of the alarm intake corpus.
5. Push both changes on branches with **the same name**, such as `fix/alarm-keyword-gasleck`,
   and open both pull requests. Each CI compares against the other's branch, so both PRs go
   green together.
6. Merge them one after the other. Merge the owner first.

A change made in only one repository fails that repository's PR, because it is compared
against the other's `main`. If you merge it anyway, it fails the next PR in the other
repository. The failure names the item, the file and the owner.

Never re-record a hash on one side to turn a check green. The check exists to catch exactly
that.

## Adding or removing a shared file

Edit `MANIFEST.json` by hand: add an entry with `"sha256"` set to 64 zeros, then run
`--update`. Copy the manifest and the file to the other repository, and land both PRs on
equally named branches as above. Keep the file where each repository already has it. An entry
can name a different path per repository instead of `path`:
`{"kp-front": "public/x.svg", "kp-rueck": "frontend/public/x.svg", "sha256": "…"}`.

Removing an entry is a deliberate decision about a contract. Say why in both PRs.

## Forks

The CI job reads `SIBLING_REPO` at the top of `.github/workflows/ci.yml`. A fork points it at
its own fork of the other product. Setting it to `""` switches the job off. The job also
skips, with a notice, when the sibling cannot be checked out. It never skips when the files
differ.
