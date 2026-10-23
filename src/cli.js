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
    (dependencies.stdout ?? console.log)(HELP);
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
        color: Boolean(process.stdout.isTTY && !process.env.NO_COLOR),
      });
  (dependencies.stdout ?? console.log)(output);
  return exitCodeFor(report.assessment.verdict);
}

export function parseArgs(argv) {
  const options = { json: false, probe: true, timeoutMs: 4_000 };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") options.help = true;
    else if (value === "--version" || value === "-v") options.version = true;
    else if (value === "--json") options.json = true;
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

const HELP = `portdoc ${VERSION}

Find which process really owns a TCP port across Windows, WSL and Docker.

Usage:
  portdoc <port> [options]

Options:
  -d, --distro <name>  Inspect a specific WSL distribution
      --docker-path <file>
                       Use a specific Docker CLI executable
      --json           Emit the stable JSON report (schemaVersion 1)
      --no-probe       Do not make TCP reachability probes
      --timeout <ms>   Collector timeout, from 250 to 30000 (default: 4000)
  -h, --help           Show help
  -v, --version        Show version

Exit codes:
  0  FREE or OK
  1  CONFLICT
  2  UNKNOWN or invalid invocation

This tool is read-only. A reachability probe proves that a TCP connection can
be opened; it does not by itself identify which process accepted it.`;
