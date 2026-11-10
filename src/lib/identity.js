import path from "node:path";

// Keep the keyword check inside a lookahead so a missing separator does not
// retry every keyword/name split in long identifiers containing repeated tokens.
const SECRET_NAME = "(?=[\\w.-]*(?:password|passwd|pwd|token|secret|api[-_]?key|access[-_]?key|credential|authorization|cookie))[\\w.-]+";
const QUOTED_VALUE = String.raw`(?:"(?:\\[\s\S]?|[^"\\])*(?:"|$)|'(?:\\[\s\S]?|[^'\\])*(?:'|$))`;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

// Reports can be copied into public issues. Keep common credentials out of
// both the human-readable command and the JSON evidence.
export function redactCommandLine(value) {
  if (!value) return null;
  // Redact before limiting the display length: cutting a quoted credential
  // first removes its closing quote and can expose the remaining words.
  // Start secret names only at a complete name boundary. A word boundary
  // retries within every dot/dash in long identifiers and causes quadratic work.
  const redacted = String(value).replace(CONTROL_CHARACTERS, " ")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/(\bAuthorization\s*:\s*)(?:Bearer|Basic)\s+[^\s"']+/gi, "$1[REDACTED]")
    .replace(new RegExp(`(?<![\\w.-])((?:--?)?${SECRET_NAME}\\s*(?:=|:)\\s*)(?:${QUOTED_VALUE}|[^\\s;&]+)`, "gi"), "$1[REDACTED]")
    .replace(new RegExp(`(?<![\\w.-])(--?${SECRET_NAME}\\s+)(?:${QUOTED_VALUE}|[^\\s]+)`, "gi"), "$1[REDACTED]")
    .replace(/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9+/_.=-]{8,}/gi, "$1[REDACTED]")
    .replace(new RegExp(`([?&]${SECRET_NAME}=)[^&\\s"']+`, "gi"), "$1[REDACTED]");
  return cleanIdentityText(redacted);
}

export function cleanIdentityText(value) {
  if (!value) return null;
  return String(value).replace(CONTROL_CHARACTERS, " ").slice(0, 8192).trim() || null;
}

export function inferProjectPath(commandLine, platform = "win32") {
  if (!commandLine) return null;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const args = (String(commandLine).match(/"([^"\r\n]*)"|'([^'\r\n]*)'|[^\s]+/g) ?? [])
    .map((arg) => arg.replace(/^["']|["']$/g, ""));
  const interpreter = pathApi.basename(args[0] ?? "").replace(/\.exe$/i, "").toLowerCase();
  if (!/^(?:node|nodejs|bun|deno|python[\d.]*|ruby|php|tsx|ts-node|powershell|pwsh|bash|sh)$/.test(interpreter)) return null;
  const noValueFlags = /^(?:--(?:inspect(?:-brk)?|trace-warnings|trace-deprecation|enable-source-maps|no-warnings|no-deprecation|experimental-strip-types|watch)|-[uBOOIsSv]|-(?:NoProfile|NonInteractive|NoLogo))$/i;
  const valueFlags = /^(?:-r|--require|--loader|--import|--conditions|--title|-X|-W|-ExecutionPolicy)$/i;
  for (let index = 1; index < args.length; index += 1) {
    const candidate = args[index];
    // Eval/module launch modes have no file entry point. Hook/config paths
    // and a script's later arguments must not masquerade as the project.
    if (/^(?:-e|-p|-c|-m|--eval|--print|--command|--module)(?:=|$)/i.test(candidate)) return null;
    if (/^-file$/i.test(candidate) || candidate === "--") continue;
    if (valueFlags.test(candidate)) { index += 1; continue; }
    if (noValueFlags.test(candidate) || /^--[\w-]+=/.test(candidate)) continue;
    if (candidate.startsWith("-")) return null;
    if (!pathApi.isAbsolute(candidate) || candidate.includes("[REDACTED]")) return null;
    const nodeModules = candidate.match(/^(.*?)[\\/]node_modules(?:[\\/]|$)/i);
    if (nodeModules?.[1]) return nodeModules[1];
    if (/\.(?:[cm]?js|[cm]?ts|tsx|jsx|py|sh|ps1|rb|php)$/i.test(candidate)) {
      return pathApi.dirname(candidate);
    }
    return null;
  }
  return null;
}

export function processIdentity(commandLine, cwd, platform = "win32") {
  const safeCommand = redactCommandLine(commandLine);
  const safeCwd = cleanIdentityText(cwd);
  return {
    commandLine: safeCommand,
    cwd: safeCwd,
    projectPath: safeCwd ?? inferProjectPath(safeCommand, platform),
    identitySource: safeCwd ? "proc" : safeCommand ? "commandLine" : null,
  };
}
