import { diagnose } from "./diagnose.js";
import { formatText } from "./format.js";
import { VERSION } from "./version.js";

export async function main(argv, dependencies = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    (dependencies.stderr ?? console.error)(error.message);
    (dependencies.stderr ?? console.error)("Run portdoc --help for usage.");
    return 2;
  }

  if (options.help) {
    (dependencies.stdout ?? console.log)(HELP_TEXT);
    return 0;
  }
  if (options.version) {
    (dependencies.stdout ?? console.log)(VERSION);
    return 0;
  }

  const report = await (dependencies.diagnose ?? diagnose)(options.port, options);
  const output = options.json
    ? JSON.stringify(report, null, 2)
    : formatText(report, {
        color: options.color ?? Boolean(process.stdout.isTTY && !process.env.NO_COLOR),
        width: process.stdout.columns,
      });
  (dependencies.stdout ?? console.log)(output);
  return exitCodeFor(report.assessment.verdict);
}

export function parseArgs(argv) {
  const options = { json: false, probe: true, timeoutMs: 4_000 };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "help" || value === "--help" || value === "-h" || value === "-?") options.help = true;
    else if (value === "--version" || value === "-v") options.version = true;
    else if (value === "--json") options.json = true;
    else if (value === "--color") options.color = true;
    else if (value === "--no-color") options.color = false;
    else if (value === "--no-probe") options.probe = false;
    else if (value === "--distro" || value === "-d") options.distro = requireValue(argv, ++index, value);
    else if (value === "--docker-path") options.dockerPath = requireValue(argv, ++index, value);
    else if (value === "--timeout") options.timeoutMs = parseTimeout(requireValue(argv, ++index, value));
    else if (value.startsWith("-")) throw new Error(`Unknown option: ${value}`);
    else positional.push(value);
  }

  if (options.help || options.version) return options;
  if (positional.length !== 1) throw new Error("Provide exactly one TCP port number.");
  const port = Number(positional[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid TCP port: ${positional[0]}`);
  }
  options.port = port;
  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value.`);
  return value;
}

function parseTimeout(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 250 || number > 30_000) {
    throw new Error("--timeout must be an integer from 250 to 30000 milliseconds.");
  }
  return number;
}

function exitCodeFor(verdict) {
  if (verdict === "CONFLICT") return 1;
  if (verdict === "UNKNOWN") return 2;
  return 0;
}

export const HELP_TEXT = `portdoc ${VERSION} — explain a TCP port across Windows, WSL and Docker

ABOUT
  Windows, WSL2 and Docker Desktop do not share one simple port table.
  portdoc combines their listener and port-mapping evidence, then checks
  whether Windows and WSL can actually connect to the requested port.

  Use it when a server reports EADDRINUSE, localhost opens the wrong app,
  a WSL service is unreachable from Windows, or a Docker-published port does
  not behave as expected.

USAGE
  portdoc <port> [options]
  portdoc help
  portdoc --version

ARGUMENT
  <port>               Any TCP port from 1 to 65535.
                       3000 is only an example, not a default or requirement.

EXAMPLES
  portdoc 80                         Inspect an HTTP port
  portdoc 5173                       Inspect a Vite development server
  portdoc 8080 --distro Ubuntu      Select a WSL distribution
  portdoc 5432 --no-probe           Inspect PostgreSQL without connecting
  portdoc 3000 --json               Emit a machine-readable report
  portdoc 3000 --timeout 10000      Allow slower collectors ten seconds
  portdoc 3000 --docker-path C:\\Docker\\docker.exe
                                     Use a non-standard Docker CLI location

WHAT GETS CHECKED
  Windows              Listening address, PID, process name and executable
  WSL                  Listening address, PID and process from ss
  Docker               Published host port, container port, name and image
  Reachability         TCP connection from Windows and separately from WSL

OPTIONS
  -d, --distro <name>  Inspect this WSL distribution instead of the default
      --docker-path <file>
                       Use this Docker CLI instead of automatic discovery
      --json           Emit JSON matching schema/report.schema.json
      --color          Always use terminal colors
      --no-color       Never use terminal colors
      --no-probe       Collect ownership evidence without opening TCP probes
      --timeout <ms>   Collector timeout from 250 to 30000 (default: 4000)
  -h, -?, --help       Show this help
  -v, --version        Show the installed version

VERDICTS
  FREE                 Every collector succeeded and found no owner
  OK                   One effective ownership path was identified
  CONFLICT             Independent Windows, WSL or Docker layers claim it
  UNKNOWN              Evidence is unavailable, incomplete or contradictory

EXIT CODES
  0                    FREE or OK
  1                    CONFLICT
  2                    UNKNOWN or invalid invocation

SAFETY AND LIMITS
  portdoc is read-only. It never kills a process or changes networking.
  A successful TCP probe proves reachability, not which process accepted the
  connection. The current release inspects TCP only, not UDP.

FROM THIS SOURCE CHECKOUT
  .\\portdoc.cmd <port>               Run with an explicit port
  .\\portdoc.cmd                      Open the interactive Windows launcher`;
