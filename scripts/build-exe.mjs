import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Node 26.9+ can load the original ESM sources from its embedded read-only VFS.
// Pin the runtime so local and CI releases embed the same official binary.
// https://nodejs.org/api/single-executable-applications.html
const runtimeVersion = "26.12.1";
const pinnedRuntimeSha256 = "1c63f1417e2e26d83ca9a9ec1d548524ab1305bc7209d90ebca56257ff0d84ed";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(root, ".build", `node-v${runtimeVersion}-win-x64`);
const work = path.join(root, ".build", "sea");
const archiveStage = path.join(root, ".build", "archive");
const dist = path.join(root, "dist");
const runtime = path.join(cache, "node.exe");
const executable = path.join(dist, "portdoc-win-x64.exe");
const archive = path.join(dist, "portdoc-win-x64.zip");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The release EXE must be built on Windows x64.");
}

await Promise.all([mkdir(cache, { recursive: true }), mkdir(work, { recursive: true }), mkdir(archiveStage, { recursive: true }), mkdir(dist, { recursive: true })]);

const releaseUrl = `https://nodejs.org/dist/v${runtimeVersion}`;
const checksums = await downloadText(`${releaseUrl}/SHASUMS256.txt`);
const runtimeSha256 = checksums.split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/))
  .find(([, file]) => file === "win-x64/node.exe")?.[0];
if (runtimeSha256 !== pinnedRuntimeSha256) {
  throw new Error("The official Node release manifest does not match the pinned Windows x64 runtime SHA-256.");
}

if (!existsSync(runtime) || sha256(await readFile(runtime)) !== runtimeSha256) {
  console.log(`Downloading official Node.js v${runtimeVersion} for Windows x64...`);
  const response = await fetch(`${releaseUrl}/win-x64/node.exe`, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== runtimeSha256) throw new Error("Official Node binary SHA-256 verification failed.");
  await writeFile(runtime, bytes);
}
console.log(`Verified Node runtime SHA-256: ${runtimeSha256}`);

const nodeLicense = await downloadText(`https://raw.githubusercontent.com/nodejs/node/v${runtimeVersion}/LICENSE`);
await writeFile(path.join(dist, "LICENSE-NODE.txt"), nodeLicense);
await writeFile(path.join(dist, "LICENSE.txt"), await readFile(path.join(root, "LICENSE")));

const assets = { "package.json": path.join(root, "package.json") };
for (const directory of ["bin", "src"]) {
  for (const file of await filesIn(path.join(root, directory))) {
    assets[path.relative(root, file).split(path.sep).join("/")] = file;
  }
}

// The injected entry point lives at the VFS root; source imports keep their
// original relative paths and cannot accidentally read a checkout from cwd.
const entry = path.join(work, "entry.mjs");
await writeFile(entry, 'import "./bin/portdoc.js";\n');
const config = path.join(work, "sea-config.json");
await writeFile(config, JSON.stringify({
  main: entry,
  mainFormat: "module",
  executable: runtime,
  output: executable,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  useVfs: true,
  execArgvExtension: "none",
  assets,
}, null, 2));

run(runtime, ["--build-sea", config]);
run(process.execPath, [path.join(root, "scripts", "smoke-exe.mjs"), executable]);

// Keep the downloaded runtime's license with the redistributable. The EXE
// itself needs no sibling files, Node installation, npm, or extracted sources.
const archiveInputs = [path.join(archiveStage, "portdoc.exe"), path.join(archiveStage, "LICENSE.txt"), path.join(archiveStage, "LICENSE-NODE.txt")];
await Promise.all([
  copyFile(executable, archiveInputs[0]),
  copyFile(path.join(dist, "LICENSE.txt"), archiveInputs[1]),
  copyFile(path.join(dist, "LICENSE-NODE.txt"), archiveInputs[2]),
]);
const quotePowerShell = (value) => `'${value.replace(/'/g, "''")}'`;
run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", [
  "$ErrorActionPreference = 'Stop'",
  `Compress-Archive -LiteralPath ${archiveInputs.map(quotePowerShell).join(", ")} -DestinationPath ${quotePowerShell(archive)} -CompressionLevel Optimal -Force`,
].join("; ")]);

const sums = [];
for (const file of [executable, archive]) sums.push(`${sha256(await readFile(file))}  ${path.basename(file)}`);
await writeFile(path.join(dist, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
await writeFile(path.join(dist, "build-info.json"), `${JSON.stringify({
  package: manifest.name,
  version: manifest.version,
  runtime: `Node.js ${runtimeVersion}`,
  runtimeUrl: `${releaseUrl}/win-x64/node.exe`,
  runtimeSha256,
  signature: "unsigned",
  sourceModules: Object.keys(assets).length - 1,
}, null, 2)}\n`);
console.log(`Built ${executable} (${Math.round((await stat(executable)).size / 1024 / 1024)} MiB)`);
console.log(`Release ZIP and SHA256SUMS.txt are in ${dist}`);

async function downloadText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} (${url})`);
  return response.text();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function filesIn(directory) {
  const result = [];
  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await filesIn(file));
    else if (item.isFile() && item.name.endsWith(".js")) result.push(file);
  }
  return result;
}

function run(file, args) {
  const result = spawnSync(file, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(file)} exited ${result.status}.`);
}
