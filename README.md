# wsl-port-doctor

> Find which process really owns a port across Windows, WSL and Docker.

`wsl-port-doctor` is a read-only CLI for the frustrating case where the same
port appears to exist in several networking layers at once. It combines
Windows listeners, WSL listeners, Docker-published ports, and independent TCP
reachability probes into one evidence-based report.

```text
PORT 3000/TCP

WINDOWS
  LISTEN  0.0.0.0:3000  node (PID 4180)

WSL [Ubuntu-24.04]
  LISTEN  0.0.0.0:3000  vite (PID 722)

DOCKER
  — no published mapping

REACHABILITY
  Windows -> 127.0.0.1  reachable (3 ms)
  WSL     -> 127.0.0.1  reachable (36 ms)

CONFLICT
Multiple independent layers claim this port.
  ! Windows and WSL both report a TCP listener on this port; Windows localhost
    traffic may shadow the WSL service.

Confidence: high
```

## Current status

The dependency-free MVP is implemented and tested. It is not published to npm
yet, so run it from the repository for now:

```powershell
node .\bin\wsl-port-doctor.js 3000
```

After an npm release, the intended command is:

```powershell
npx wsl-port-doctor 3000
```

Requirements:

- Windows 10 or 11
- Node.js 18 or newer
- WSL2 for WSL inspection
- `ss` inside the selected WSL distribution
- Docker CLI for container mapping inspection

WSL and Docker are optional. If either is unavailable, the report says so and
reduces its confidence instead of pretending that the port is free.

## Usage

```text
wsl-port-doctor <port> [options]

-d, --distro <name>  Inspect a specific WSL distribution
    --json           Emit the stable JSON report (schemaVersion 1)
    --no-probe       Do not make TCP reachability probes
    --timeout <ms>   Collector timeout, from 250 to 30000
-h, --help           Show help
-v, --version        Show version
```

Examples:

```powershell
# Inspect the default WSL distribution
node .\bin\wsl-port-doctor.js 5173

# Inspect Ubuntu specifically
node .\bin\wsl-port-doctor.js 5173 --distro Ubuntu

# Feed a stable report into another tool
node .\bin\wsl-port-doctor.js 5173 --json

# Collect listener evidence without opening test connections
node .\bin\wsl-port-doctor.js 5173 --no-probe
```

## Verdicts and exit codes

| Verdict | Exit | Meaning |
| --- | ---: | --- |
| `FREE` | 0 | All collectors succeeded and found no owner |
| `OK` | 0 | One effective ownership path was identified |
| `CONFLICT` | 1 | Independent layers claim the same port |
| `UNKNOWN` | 2 | Evidence is missing, contradictory, or cannot identify the owner |

The JSON output contains the raw evidence under `sources`, independent
connection results under `probes`, and the derived conclusion under
`assessment`. The complete contract is in
[`schema/report.schema.json`](./schema/report.schema.json):

```json
{
  "schemaVersion": 1,
  "port": 3000,
  "protocol": "tcp",
  "sources": {
    "windows": { "status": "ok", "listeners": [] },
    "wsl": { "status": "ok", "distro": "Ubuntu", "listeners": [] },
    "docker": { "status": "ok", "mappings": [] }
  },
  "probes": {
    "windows": { "status": "ok", "reachable": false },
    "wsl": { "status": "ok", "reachable": false }
  },
  "assessment": {
    "verdict": "FREE",
    "summary": "No Windows listener, WSL listener, or Docker mapping was found.",
    "confidence": "high",
    "findings": []
  }
}
```

`checkedAt`, latency fields, and unavailable-source reasons have been omitted
from this shortened example.

## How it works

The collectors deliberately use ordinary user permissions:

- Windows listener endpoints and PIDs come from `netstat -ano`; PowerShell is
  used only to enrich those PIDs with process names and executable paths.
- WSL listeners come from `ss -H -ltnp` in the default or selected distro.
- Docker mappings come from structured `docker ps` output.
- Windows and WSL each attempt a short TCP connection to `127.0.0.1:<port>`.

The analyzer is separate from the operating-system collectors. This makes the
conflict rules deterministic and testable with fixtures.

## Important limitation

A successful TCP connection proves reachability, not identity. It cannot by
itself prove which application accepted the connection. The tool therefore
does not send HTTP requests, inspect application data, terminate processes, or
change WSL/Docker networking. When the available evidence cannot justify a
specific owner, the verdict is `UNKNOWN`.

The MVP currently handles TCP only. Docker port ranges, UDP, remote WSL
addresses, and exhaustive mirrored-networking policy inspection are outside
the first release.

## Development

There are no runtime or development dependencies:

```powershell
node --test
node --check .\bin\wsl-port-doctor.js
```

The test suite covers CLI parsing, Windows/WSL/Docker output parsing, and the
conflict decision matrix.

## License

[MIT](./LICENSE)

