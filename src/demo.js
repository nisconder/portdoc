import { analyze } from "./analyze.js";
import { buildNextActions } from "./advice.js";

// Reproducible example, never presented as evidence from the user's computer.
export function createDemoReport() {
  const connect = (address, reachable, latencyMs = 1) => ({
    status: "ok", reachable, address,
    family: address.includes(":") ? 6 : 4, latencyMs,
    ...(reachable ? {} : { reason: "ECONNREFUSED" }),
  });
  const windows = {
    localhost: connect("::1", false),
    ipv4: connect("127.0.0.1", true, 2),
    ipv6: connect("::1", false),
  };
  const wsl = {
    localhost: connect("::1", false),
    ipv4: connect("127.0.0.1", false),
    ipv6: connect("::1", false),
  };
  const report = {
    schemaVersion: 3,
    kind: "diagnosis",
    sample: true,
    checkedAt: "2026-10-28T00:00:00.000Z",
    port: 5173,
    protocol: "tcp",
    target: "127.0.0.1",
    sources: {
      windows: {
        status: "ok",
        listeners: [{
          address: "127.0.0.1", port: 5173, pid: 4180, process: "node",
          path: "C:\\Program Files\\nodejs\\node.exe",
          commandLine: "node D:\\work\\storefront\\server.mjs",
          cwd: null, projectPath: "D:\\work\\storefront", identitySource: "commandLine",
        }],
      },
      wsl: { status: "ok", distro: "Ubuntu", listeners: [] },
      docker: { status: "ok", executable: "docker", mappings: [] },
    },
    probes: { windows: windows.ipv4, wsl: wsl.ipv4 },
    endpointMatrix: { windows, wsl },
    reservations: { status: "ok", ranges: [], matches: [], families: { ipv4: { status: "ok" }, ipv6: { status: "ok" } } },
  };
  report.assessment = analyze(report);
  report.nextActions = buildNextActions(report);
  return report;
}
