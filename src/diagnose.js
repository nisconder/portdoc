import { analyze } from "./analyze.js";
import { collectDocker } from "./collectors/docker.js";
import { collectWindows } from "./collectors/windows.js";
import { collectWsl } from "./collectors/wsl.js";
import { probeWindows, probeWsl } from "./probes.js";

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

  let probes;
  if (options.probe === false) {
    probes = {
      windows: { status: "skipped", reachable: null, reason: "Disabled by --no-probe." },
      wsl: { status: "skipped", reachable: null, reason: "Disabled by --no-probe." },
    };
  } else {
    const probeFunctions = options.probes ?? {};
    const [windowsProbe, wslProbe] = await Promise.all([
      (probeFunctions.windows ?? probeWindows)(port, { timeoutMs: probeTimeoutMs }),
      (probeFunctions.wsl ?? probeWsl)(port, { timeoutMs: probeTimeoutMs, distro: options.distro }),
    ]);
    probes = { windows: windowsProbe, wsl: wslProbe };
  }

  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    port,
    protocol: "tcp",
    target: "127.0.0.1",
    sources: { windows, wsl, docker },
    probes,
  };
  report.assessment = analyze(report);
  return report;
}
