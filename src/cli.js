import { diagnose } from "./diagnose.js";
import { createDemoReport } from "./demo.js";
import { formatText, formatScan, formatDoctor } from "./format.js";
import { scan } from "./scan.js";
import { doctor } from "./doctor.js";
import { getHelpText } from "./help.js";
import { createMessages, normalizeLanguage, resolveLanguage } from "./i18n.js";
import { VERSION } from "./version.js";

export async function main(argv, dependencies = {}) {
  const requestedLanguage = findRequestedLanguage(argv);
  const language = resolveLanguage(requestedLanguage, {
    environment: dependencies.environment,
    systemLocale: dependencies.systemLocale,
  });
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const messages = createMessages(language);
    (dependencies.stderr ?? console.error)(localizeArgumentError(error.message, messages));
    (dependencies.stderr ?? console.error)(messages.t("errorHelp"));
    return 2;
  }

  if (options.help) {
    (dependencies.stdout ?? console.log)(getHelpText(language, options.helpTopic));
    return 0;
  }
  if (options.version) {
    (dependencies.stdout ?? console.log)(VERSION);
    return 0;
  }

  const report = options.command === "scan"
    ? await (dependencies.scan ?? scan)(options)
    : options.command === "doctor"
      ? await (dependencies.doctor ?? doctor)(options)
      : options.demo ? createDemoReport() : await (dependencies.diagnose ?? diagnose)(options.port, options);
  const formatter = options.command === "scan" ? formatScan : options.command === "doctor" ? formatDoctor : formatText;
  const output = options.json
    ? JSON.stringify(report, null, 2)
    : formatter(report, {
        color: options.color ?? Boolean(process.stdout.isTTY && !process.env.NO_COLOR),
        width: process.stdout.columns,
        language,
      });
  (dependencies.stdout ?? console.log)(output);
  if (options.command === "doctor") return report.ready ? 0 : 2;
  if (options.command === "scan") {
    if (report.overlapCount > 0) return 1;
    return Object.values(report.sources).every((source) => source.status === "ok") ? 0 : 2;
  }
  return options.demo ? 0 : exitCodeFor(report.assessment.verdict);
}

export function parseArgs(argv) {
  const options = { json: false, probe: true, timeoutMs: 4_000 };
  const positional = [];

  if (argv.length === 0) return { ...options, help: true };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "help" || value === "--help" || value === "-h" || value === "-?") options.help = true;
    else if (value === "--version" || value === "-v") options.version = true;
    else if (value === "--json") options.json = true;
    else if (value === "--color") options.color = true;
    else if (value === "--no-color") options.color = false;
    else if (value === "--no-probe") options.probe = false;
    else if (value === "--issues-only") options.issuesOnly = true;
    else if (value === "--limit") options.limit = parseLimit(requireValue(argv, ++index, value));
    else if (value.startsWith("--limit=")) options.limit = parseLimit(value.slice("--limit=".length));
    else if (value === "--lang" || value === "-l") options.lang = parseLanguage(requireValue(argv, ++index, value));
    else if (value.startsWith("--lang=")) options.lang = parseLanguage(value.slice("--lang=".length));
    else if (value === "--distro" || value === "-d") options.distro = requireValue(argv, ++index, value);
    else if (value === "--docker-path") options.dockerPath = requireValue(argv, ++index, value);
    else if (value === "--timeout") options.timeoutMs = parseTimeout(requireValue(argv, ++index, value));
    else if (value.startsWith("-")) throw new Error(`Unknown option: ${value}`);
    else positional.push(value);
  }

  if (options.help) {
    const topic = positional.find((value) => ["scan", "doctor", "demo"].includes(value));
    return topic ? { ...options, helpTopic: topic } : options;
  }
  if (options.version) return options;
  if (options.limit !== undefined || options.issuesOnly !== undefined) {
    if (positional.length !== 1 || positional[0] !== "scan") throw new Error("--limit and --issues-only require the scan command.");
  }
  if (positional.length === 1 && ["scan", "doctor"].includes(positional[0])) {
    if (positional[0] === "doctor" && (options.distro || options.probe === false)) throw new Error("doctor checks the Windows host, not a selected distribution or port.");
    return { ...options, command: positional[0] };
  }
  if (positional.length === 1 && positional[0] === "demo") return { ...options, demo: true };
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

function parseLimit(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 500) throw new Error("--limit must be an integer from 1 to 500.");
  return Number(value);
}

function parseLanguage(value) {
  const language = normalizeLanguage(value);
  if (!language) throw new Error("--lang must be auto, en, or zh-CN.");
  return language;
}

function findRequestedLanguage(argv) {
  const index = argv.findIndex((value) => value === "--lang" || value === "-l");
  if (index >= 0) return argv[index + 1];
  const inline = argv.find((value) => value.startsWith("--lang="));
  return inline?.slice("--lang=".length);
}

function localizeArgumentError(message, messages) {
  if (message === "Provide exactly one TCP port number.") return messages.t("errorPortRequired");
  if (message === "--timeout must be an integer from 250 to 30000 milliseconds.") return messages.t("errorTimeout");
  if (message === "--lang must be auto, en, or zh-CN.") return messages.t("errorLanguage");
  if (message === "--limit must be an integer from 1 to 500.") return messages.t("errorLimit");
  if (message === "--limit and --issues-only require the scan command.") return messages.t("errorScanOptions");
  if (message === "doctor checks the Windows host, not a selected distribution or port.") return messages.t("errorDoctorOptions");
  const unknown = message.match(/^Unknown option: (.+)$/);
  if (unknown) return messages.t("errorUnknownOption", { value: unknown[1] });
  const invalidPort = message.match(/^Invalid TCP port: (.+)$/);
  if (invalidPort) return messages.t("errorInvalidPort", { value: invalidPort[1] });
  const missingValue = message.match(/^(\S+) requires a value\.$/);
  if (missingValue) return messages.t("errorValueRequired", { option: missingValue[1] });
  return message;
}

function exitCodeFor(verdict) {
  if (verdict === "CONFLICT") return 1;
  if (verdict === "UNKNOWN") return 2;
  return 0;
}
