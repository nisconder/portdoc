import { analyze } from "./analyze.js";
import { collectDocker } from "./collectors/docker.js";
import { collectWindows } from "./collectors/windows.js";
import { collectWsl } from "./collectors/wsl.js";
import { probeWindowsMatrix, probeWslMatrix } from "./probes.js";

export async function diagnose(port, options = {}) {
  const timeoutMs = options.timeoutMs ?? 4_000;
  const probeTimeoutMs = Math.min(timeoutMs, 1_500);
  const collectorOptions = { timeoutMs, distro: options.distro, dockerPath: options.dockerPath };
  const collectors = options.collectors ?? {};

  const [windows, wsl, docker] = await Promise.all([
    (collectors.windows ?? collectWindows)(port, collectorOptions),
    (collectors.wsl ?? collectWsl)(port, collectorOptions),
    (collectors.docker ?? collectDocker)(port, collectorOptions),
  ]);

  let endpointMatrix;
  if (options.probe === false) {
    endpointMatrix = Object.fromEntries(["windows", "wsl"].map((side) => [side, Object.fromEntries(
      ["localhost", "ipv4", "ipv6"].map((key) => [key, { status: "skipped", reachable: null, reason: "Disabled by --no-probe." }]),
    )]));
  } else {
    const probeFunctions = options.probes ?? {};
    const [windowsMatrix, wslMatrix] = await Promise.all([
      (probeFunctions.windows ?? probeWindowsMatrix)(port, { timeoutMs: probeTimeoutMs }),
      (probeFunctions.wsl ?? probeWslMatrix)(port, { timeoutMs: probeTimeoutMs, distro: options.distro }),
    ]);
    endpointMatrix = { windows: windowsMatrix, wsl: wslMatrix };
  }

  const report = {
    schemaVersion: 2,
    checkedAt: new Date().toISOString(),
    port,
    protocol: "tcp",
    target: "127.0.0.1",
    sources: { windows, wsl, docker },
    probes: { windows: endpointMatrix.windows.ipv4, wsl: endpointMatrix.wsl.ipv4 },
    endpointMatrix,
  };
  report.assessment = analyze(report);
  return report;
}
