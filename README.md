# wsl-port-doctor

> Find which process really owns a port across Windows, WSL and Docker.

```text
portdoc 3000
```

`3000` is only an example. Replace it with any TCP port from `1` to `65535`.
Run `portdoc` or `portdoc help` for scenarios, options, verdicts, exit codes,
and examples. A bare `portdoc` invocation is exactly equivalent to
`portdoc help`.

The terminal interface puts the verdict first, then shows ownership,
reachability, findings, and concrete next steps. Colors are enabled only for
interactive terminals; use `--no-color` or `NO_COLOR=1` when needed.

Windows, WSL2, and Docker Desktop each have their own view of networking. A
port can look free in one layer, be occupied in another, and be forwarded or
shadowed before a connection reaches the service you expected.

Use `portdoc` when:

- a development server fails with `EADDRINUSE`, but the process is hard to find;
- `localhost:3000` opens the wrong application;
- a service works inside WSL but cannot be reached from Windows;
- Docker publishes a port, but Windows cannot connect to it; or
- Windows, WSL, and Docker all appear to claim the same port.

Give it one port number. It answers four separate questions:

1. Which Windows process is listening?
2. Which WSL process is listening?
3. Which Docker container publishes the port?
4. Can Windows and WSL actually open a TCP connection to it?

It then explains whether the port is free, has one clear ownership path, is in
conflict, or cannot be determined from the available evidence. It never kills
a process or changes networking settings.

```text
PORTDOC  3000/tcp · 127.0.0.1

╭─ × CONFLICT
│  Multiple independent layers claim this port.
╰─────────────────────────────────────────────────────────────

OWNERSHIP
  ● Windows        node (PID 4180)
                   0.0.0.0:3000
  ● WSL · Ubuntu   vite (PID 722)
                   0.0.0.0:3000
  ○ Docker         No published mapping

REACHABILITY  127.0.0.1:3000
  ✓ Windows        Reachable · 3 ms
  ✓ WSL            Reachable · 18 ms

FINDINGS
  !                Windows and WSL both report a TCP listener on this port.

NEXT
  1. Choose one owner: stop the Windows listener or move the WSL service to
     another port.

Confidence high · read-only · no settings changed
```

## Run it

### Easiest on Windows

Double-click [`portdoc-launcher.cmd`](./portdoc-launcher.cmd). It explains when
the tool is useful, asks for a port number, and keeps the result open so it can
be read or screenshotted.

From a terminal in this repository:

```powershell
.\portdoc.cmd 3000
.\portdoc.cmd
.\portdoc.cmd help
```

The package is not on npm yet. Once published, the primary command will be:

```powershell
npx wsl-port-doctor 3000
```

After a global install, the regular command is simply `portdoc 3000`.

Requirements:

- Windows 10 or 11
- Node.js 18 or newer
- WSL2 for WSL inspection
- `ss` inside the selected WSL distribution
- Docker CLI for container mapping inspection

WSL and Docker are optional. If either is unavailable, the report says so and
reduces its confidence instead of pretending that the port is free.

Docker Desktop is discovered even when `docker.exe` is missing from `PATH`.
The tool checks Docker Desktop's standard installation locations and clearly
distinguishes “CLI not installed” from “CLI installed but daemon unavailable.”

## Usage

```text
portdoc <port> [options]

-d, --distro <name>  Inspect a specific WSL distribution
    --docker-path <file>
                     Use a specific Docker CLI executable
    --lang <locale>  Interface language: auto, en, or zh-CN
    --json           Emit the stable JSON report (schemaVersion 1)
    --color          Always use terminal colors
    --no-color       Never use terminal colors
    --no-probe       Do not make TCP reachability probes
    --timeout <ms>   Collector timeout, from 250 to 30000
-h, --help           Show help
-v, --version        Show version
```

Examples:

```powershell
# Inspect the default WSL distribution
.\portdoc.cmd 5173

# Inspect Ubuntu specifically
.\portdoc.cmd 5173 --distro Ubuntu

# Use Simplified Chinese or English explicitly
.\portdoc.cmd 5173 --lang zh-CN
.\portdoc.cmd 5173 --lang en

# Feed a stable report into another tool
.\portdoc.cmd 5173 --json

# Collect listener evidence without opening test connections
.\portdoc.cmd 5173 --no-probe
```

## Languages

`portdoc` currently includes complete English and Simplified Chinese
interfaces. The default `auto` mode follows the operating-system UI language.
Override it per command with `--lang` or persist it for the current shell:

```powershell
$env:PORTDOC_LANG = "zh-CN"
portdoc 5173
```

Localized output includes help, verdicts, section labels, findings, common
errors, recommended next steps, and the interactive Windows launcher. JSON
keys, enum values, finding codes, and schema stay language-independent.

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

