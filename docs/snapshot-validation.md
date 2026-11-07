# Snapshot / diff validation

The deterministic tests in `test/snapshot.test.js` use explicitly synthetic
fixtures. They cover process/project and Compose identity changes, listener
removal, IPv4/IPv6 and localhost changes, exclusions, incomplete evidence,
disabled probes, context mismatches, truncated display rows, invalid inputs,
file roundtrips, overwrite protection and CLI exit codes. They do not establish
real Windows/WSL/Docker compatibility.

## Reproduce a live Windows listener lifecycle

From a source checkout on Windows:

```powershell
node scripts/validate-snapshot-live.mjs --out .build/snapshot-live-new
```

The parent `.build` directory must exist; the output directory must be new.
The script creates its own IPv4 loopback listener on an OS-assigned port,
checks it independently with Node TCP, captures a snapshot, closes only that
listener, independently checks refusal, captures again and runs the actual
CLI `diff --json`. It asserts the listener removal and IPv4 reachability
transition while preserving the incomplete exit code if another source fails.
It does not launch Docker, change network configuration or end observed user
services. Normal snapshot WSL collection may start the default distribution.

Raw JSON and command output remain in the chosen local directory. They can
contain hostnames, paths, redacted command lines and container labels. Review
and redact before sharing; a sanitized summary is enough for a public report.

## Scope

A pass proves this one listener lifecycle and the CLI save/read/diff path on
the recorded host. It does not establish IPv6 policy behavior, Docker container
lifecycle, WSL NAT/mirrored transitions, multi-host comparison or a root cause.
Unavailable sources stay unavailable. See [the broader live checklist](validation.md)
for additional environment cases.

## Observed run: 2026-11-07

- Windows x64, OS release `10.0.26300`, Node `v24.22.1`.
- Independent IPv4 connection: reachable before closing the owned listener,
  refused after closing it. The actual CLI diff recorded the listener removal
  and `windows.ipv4` transition from true to false.
- Windows and WSL sources succeeded in both captures; Docker was unavailable
  in both. Both snapshots and the diff returned 2, preserving incomplete
  evidence while still showing the two comparable changes.
- All six harness assertions passed. The original snapshots and command
  output were retained locally and are not committed because they contain
  host/process metadata. No simulated fixtures were substituted for this run.
- The full Windows test suite passed, with only the POSIX-specific process-group
  check skipped. Deterministic fixture tests also cover absent/unknown source
  identities, which must not imply a service was added or removed.
