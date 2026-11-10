# Changelog

## Unreleased

- Add `snapshot [port] --out <new-file.json>` for inventory or single-port evidence, preserving the existing embedded report schemas and refusing overwrites.
- Add offline `diff <before.json> <after.json>` with listener/project, container/Compose, reachability and exclusion-range changes.
- Keep incomplete sources, missing identity metadata, probe failures and source-context changes explicit instead of treating missing evidence as removal or repair.
- Provide bilingual help, snapshot/diff v1 JSON contracts, conservative exit codes, deterministic fixtures and a real Windows listener lifecycle validation script.
- Redact complete quoted credentials before truncating long command lines, preventing partial secrets from appearing in reports.
- Handle escaped quotes and unterminated credential values without exposing their trailing words.
- Treat blank or control-only process command lines as missing metadata instead of throwing during identity collection.
- Match credential names at complete name boundaries to avoid repeated scans of long dotted identifiers.

## 0.7.1

- Bound collector timeout cleanup to an additional 250 ms, closing pipes and unreferencing process handles at the deadline.
- Attempt Windows process-tree termination and POSIX process-group termination before falling back to direct-child cleanup.
- Add real subprocess timeout regression coverage and a real-environment validation checklist.
- Test command cleanup on Windows and Linux, and include the source commit in standalone build metadata when Git is available.

## 0.7.0

- Add `portdoc scan` to inventory observed TCP listeners and mappings once per layer.
- Add `--issues-only`, bounded `--limit`, total/overlap counts and explicit truncation.
- Add `portdoc doctor` for Windows collector readiness and optional WSL/local Docker health.
- Check active Windows IPv4/IPv6 excluded TCP ranges during single-port inspection.
- Add read-only verification commands tied to actual PIDs, containers and range matches.
- Scope Docker queries to local named pipes, ignoring remote Docker environment/context.
- Preserve partial inventory and exclusion evidence without declaring uninspected ports free.
- Add command-specific bilingual help and separate scan/doctor JSON contracts.
- Diagnosis reports use schemaVersion 3; frozen v1/v2 schemas and IPv4 aliases remain available.

## 0.6.0

- Compare localhost, IPv4 loopback and IPv6 loopback from Windows and WSL.
- Show the first resolved localhost address without silent address-family fallback.
- Detect reachability differences without claiming a specific relay failure.
- Add redacted process command lines, labeled Windows project inferences,
  WSL working directories and Docker Compose project/service metadata.
- Add `portdoc demo`, an explicitly labeled offline example.
- Ship a Windows x64 single-file EXE, ZIP, runtime licenses and SHA-256 checksums.
- Add Windows CI, reproducible EXE build scripts, bilingual documentation and a demo GIF.
- JSON reports now use schemaVersion 2; IPv4 `probes` aliases are preserved.
- Cross-layer overlap findings are potential conflicts with medium confidence,
  rather than proof that traffic reached a particular process.

## 0.5.3

- Clarify Windows global installation and npm mirror fallback.

## 0.5.2

- Link npm metadata to the public GitHub repository.
