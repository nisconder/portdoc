# Changelog

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
