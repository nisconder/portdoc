import { VERSION } from "./version.js";

export function getHelpText(language, topic) {
  if (topic === "snapshot" || topic === "diff") return snapshotHelp(language);
  if (topic === "scan") return scanHelp(language);
  if (topic === "doctor") return doctorHelp(language);
  if (topic === "demo") return language === "zh-CN"
    ? "portdoc demo [--lang en|zh-CN] [--json]\n\n显示明确标注的模拟报告，不检查当前系统，不发起连接。退出码为 0。"
    : "portdoc demo [--lang en|zh-CN] [--json]\n\nDisplay a labeled simulated report, without system queries or TCP connections. Exit code: 0.";
  return language === "zh-CN" ? chineseHelp() : englishHelp();
}

function scanHelp(language) {
  return language === "zh-CN" ? `portdoc scan — 查找 Windows、WSL 和 Docker 中已观察到的 TCP 端口

用法
  portdoc scan [--issues-only] [--limit 30] [选项]

示例
  portdoc scan                           汇总已监听和映射端口
  portdoc scan --issues-only             仅显示跨层可能重叠项
  portdoc scan --limit 100 --json         输出更多端口的 JSON 清单
  portdoc scan --distro Ubuntu           仅检查指定 WSL 发行版

选项
  --limit <数量>                        1 到 500（默认 30）
  --issues-only                         仅保留可能重叠的端口
  --distro <名称>                       选择 WSL 发行版
  --docker-path <文件>                  指定 Docker CLI
  --timeout <毫秒>                      每项采集超时（默认 4000）
  --lang en|zh-CN                       界面语言
  --json / --no-color                   JSON 或纯文本输出

边界
  每层一次枚举，不逐个连接全端口，也不进行可达性探测。
  WSL 查询默认或指定发行版，系统可能启动该发行版。
  可能重叠不等于确定冲突。某个来源失败时会保留其余结果并明确标注。
  --limit 也限制 JSON 的 ports 列表；truncated 表示结果被截断。

退出码
  0  检查完整，未发现可能重叠
  1  可检查结果中存在可能重叠
  2  未发现可能重叠，但来源检查不完整

下一步
  portdoc <端口>                        检查具体端口与保留范围
  portdoc doctor                        检查采集环境`
    : `portdoc scan — discover observed TCP ports across Windows, WSL and Docker

USAGE
  portdoc scan [--issues-only] [--limit 30] [options]

EXAMPLES
  portdoc scan                           List observed listeners and mappings
  portdoc scan --issues-only             Show potential cross-layer overlap
  portdoc scan --limit 100 --json         Emit a larger JSON inventory
  portdoc scan --distro Ubuntu           Select one WSL distribution

OPTIONS
  --limit <count>                       1 to 500 (default: 30)
  --issues-only                         Keep only potential overlap
  --distro <name>                       Select a WSL distribution
  --docker-path <file>                  Select a Docker CLI
  --timeout <ms>                        Collector timeout (default: 4000)
  --lang en|zh-CN                       Interface language
  --json / --no-color                   JSON or plain text output

LIMITS
  Each layer is enumerated once. No TCP connections or full-range probes.
  Querying the selected/default WSL distribution may start it.
  Potential overlap is not a confirmed conflict. Partial failures stay visible.
  --limit applies to JSON ports too; truncated marks omitted rows.

EXIT CODES
  0  Complete inventory, no potential overlap
  1  Potential overlap exists in the observed results
  2  No potential overlap found, but inspection was incomplete

NEXT
  portdoc <port>                        Inspect endpoints and reserved ranges
  portdoc doctor                        Check collector availability`;
}

function doctorHelp(language) {
  return language === "zh-CN" ? `portdoc doctor — 检查本机采集环境

用法
  portdoc doctor [--json] [--lang en|zh-CN] [--timeout 4000]

检查 Windows 监听查询、已注册 WSL 发行版、本机 Docker 引擎。
Docker 仅通过本机 named pipe 检查，不访问远程 context。
不会启动 WSL 发行版、Docker 服务，不安装软件或修改配置。
WSL 内的 ss、Python 或 nc 在检查具体端口时验证。

退出码
  0  Windows 监听检查可用；可选的 WSL/Docker 仍可能有警告
  2  当前平台或 Windows 监听查询不可用

下一步
  portdoc scan
  portdoc 5173`
    : `portdoc doctor — check local collector availability

USAGE
  portdoc doctor [--json] [--lang en|zh-CN] [--timeout 4000]

Checks Windows listener queries, registered WSL distributions and the local
Docker Engine. Docker uses local named pipes, not a remote context.
Does not start WSL distributions or Docker, install software or change settings.
Guest ss, Python or nc are checked during specific port inspection.

EXIT CODES
  0  Windows inspection is ready; optional WSL/Docker warnings may remain
  2  Unsupported host or Windows listener queries are unavailable

NEXT
  portdoc scan
  portdoc 5173`;
}

function englishHelp() {
  return `portdoc ${VERSION} — explain a TCP port across Windows, WSL and Docker

ABOUT
  Windows, WSL2 and Docker Desktop do not share one simple port table.
  portdoc combines listener and project identity evidence, then compares
  localhost, 127.0.0.1 and ::1 from both Windows and WSL.

  Use it when a server reports EADDRINUSE, localhost opens the wrong app,
  a WSL service is unreachable from Windows, or a Docker-published port does
  not behave as expected.

USAGE
  portdoc                            Show this help
  portdoc <port> [options]
  portdoc scan [--issues-only]        Discover observed TCP ports
  portdoc doctor                     Check local collector availability
  portdoc snapshot [port] --out <file> Save inventory or one-port evidence
  portdoc diff <before> <after>       Compare saved evidence offline
  portdoc demo [--lang en|zh-CN]      Simulated example; no system checks
  portdoc help [--lang en|zh-CN]
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
  portdoc 3000 --lang zh-CN         Use Simplified Chinese
  portdoc 3000 --timeout 10000      Allow slower collectors ten seconds
  portdoc scan --help              Detailed inventory help
  portdoc doctor --help            Detailed environment-check help

WHAT GETS CHECKED
  Windows              Listener, PID, executable and redacted command line
  WSL                  Listener, PID, /proc command line and working directory
  Docker               Published ports, Compose project/service and path
  Endpoint matrix      localhost / 127.0.0.1 / ::1 from Windows and WSL
                       localhost tests the first resolved address, without
                       IPv4/IPv6 fallback. Browsers may select differently.
  Excluded ranges      Windows IPv4/IPv6 TCP exclusions that contain this port
  Verification         Read-only commands for the actual PID or container

OPTIONS
  -d, --distro <name>  Inspect this WSL distribution instead of the default
      --docker-path <file>
                       Use this Docker CLI instead of automatic discovery
  -l, --lang <locale>  Interface language: auto, en, or zh-CN (default: auto)
      --json           Diagnosis schemaVersion 3; scan/doctor have own schemas
      --color          Always use terminal colors
      --no-color       Never use terminal colors
      --no-probe       Collect ownership evidence without opening TCP probes
      --timeout <ms>   Collector timeout from 250 to 30000 (default: 4000)
  -h, -?, --help       Show this help
  -v, --version        Show the installed version

VERDICTS
  FREE                 Every collector succeeded and found no owner
  OK                   An owner was found and no issue was observed
  CONFLICT             Potential overlap across layers; review the evidence
  UNKNOWN              Evidence is incomplete or endpoints behave differently

EXIT CODES
  0                    FREE or OK
  1                    CONFLICT
  2                    UNKNOWN or invalid invocation

SAFETY AND LIMITS
  portdoc is read-only. It never kills a process or changes networking.
  A successful TCP probe proves reachability, not which process accepted the
  connection. The current release inspects TCP only, not UDP.
  A single-family bind can be intentional. Neither a port overlap nor an
  IPv4/IPv6 difference proves a forwarding fault or the accepting process.
  Windows working directories are not available via this collector; project
  paths inferred from absolute script arguments are explicitly labeled.
  An excluded range can restrict a new bind, but does not prove bind failure.

WINDOWS STANDALONE
  Download portdoc-win-x64.zip from github.com/nisconder/portdoc/releases.
  Extract it, open a terminal there and run .\\portdoc.exe.
  Node.js is not needed for the EXE. The npm package needs Node.js >=18.

FROM THIS SOURCE CHECKOUT
  .\\portdoc.cmd <port>               Run with an explicit port
  .\\portdoc.cmd                      Show this help
  .\\portdoc-launcher.cmd             Open the interactive Windows launcher`;
}

function chineseHelp() {
  return `portdoc ${VERSION} — 解释 Windows、WSL 和 Docker 中的 TCP 端口

作用
  Windows、WSL2 和 Docker Desktop 并不共享一张简单的端口表。
  portdoc 会合并监听、项目路径和端口映射证据，并从 Windows 和 WSL
  分别对比 localhost、127.0.0.1 和 ::1 的连接结果。

  适用于 EADDRINUSE、localhost 打开了错误程序、WSL 服务无法从 Windows
  访问，或者 Docker 已发布端口但连接行为不符合预期等情况。

用法
  portdoc                            显示此帮助
  portdoc <端口> [选项]
  portdoc scan [--issues-only]        汇总已观察到的 TCP 端口
  portdoc doctor                     检查本机采集环境
  portdoc snapshot [端口] --out <文件> 保存清单或单端口证据
  portdoc diff <之前> <之后>          离线比较已保存的证据
  portdoc demo [--lang en|zh-CN]      模拟样例，不检查当前系统
  portdoc help [--lang en|zh-CN]
  portdoc --version

参数
  <端口>               1 到 65535 之间的任意 TCP 端口。
                       3000 只是示例，不是默认值或固定要求。

示例
  portdoc 80                         检查 HTTP 端口
  portdoc 5173                       检查 Vite 开发服务器
  portdoc 8080 --distro Ubuntu      指定 WSL 发行版
  portdoc 5432 --no-probe           不发起连接，仅检查 PostgreSQL 归属
  portdoc 3000 --json               输出机器可读报告
  portdoc 3000 --lang en            使用英文界面
  portdoc 3000 --timeout 10000      将采集超时设为十秒
  portdoc scan --help              端口概览的详细帮助
  portdoc doctor --help            环境检查的详细帮助

检查内容
  Windows              监听地址、PID、程序和脱敏后的命令行
  WSL                  监听地址、PID、/proc 命令行和工作目录
  Docker               映射端口、Compose 项目、服务和项目路径
  端点矩阵              两侧分别测试 localhost / 127.0.0.1 / ::1
                       localhost 仅测试首选解析地址，不自动回退到另一地址族。
                       浏览器的地址选择可能与本次探测不同。
  排除范围              包含此端口的 Windows IPv4/IPv6 TCP 排除范围
  验证命令              对应实际 PID、容器或排除范围的只读命令

选项
  -d, --distro <名称>  检查指定 WSL 发行版，而不是默认发行版
      --docker-path <文件>
                       使用指定 Docker CLI，不进行自动发现
  -l, --lang <语言>    界面语言：auto、en 或 zh-CN（默认：auto）
      --json           诊断 schemaVersion 3；scan/doctor 有独立 schema
      --color          始终使用终端颜色
      --no-color       禁用终端颜色
      --no-probe       收集端口归属，但不发起 TCP 连接
      --timeout <毫秒> 采集超时，范围 250 到 30000（默认：4000）
  -h, -?, --help       显示此帮助
  -v, --version        显示版本

诊断结果
  FREE                 所有检查完成，未发现占用者
  OK                   已发现归属，未观察到异常
  CONFLICT             多层可能存在重叠，请核对证据
  UNKNOWN              部分证据缺失或不同端点的行为有差异

退出码
  0                    FREE 或 OK
  1                    CONFLICT
  2                    UNKNOWN 或调用参数错误

安全边界
  portdoc 只读运行，不会结束进程或修改网络设置。TCP 探测成功只能证明
  端口可达，不能单独证明由哪个进程接受了连接。当前版本仅检查 TCP。
  仅绑定单个地址族可能是预期行为。端口重叠或 IPv4/IPv6 差异不能单独
  证明转发故障。Windows 无法读取工作目录；从绝对脚本路径推断出的
  项目目录会明确标注来源。
  排除范围可能限制新服务绑定，但不能证明绑定必然失败。

Windows 独立版
  从 github.com/nisconder/portdoc/releases 下载 portdoc-win-x64.zip。
  解压后在该目录打开终端，运行 .\\portdoc.exe；无需安装 Node.js。
  npm 安装方式需要 Node.js >=18。

在源码目录运行
  .\\portdoc.cmd <端口>               检查指定端口
  .\\portdoc.cmd                      显示此帮助
  .\\portdoc-launcher.cmd             打开 Windows 交互启动器`;
}

function snapshotHelp(language) {
  return language === "zh-CN" ? `portdoc snapshot / diff — 保存和对比本机端口证据

用法
  portdoc snapshot --out before.json
  portdoc snapshot 5173 --out before.json [--distro Ubuntu] [--no-probe]
  portdoc diff before.json after.json [--json] [--lang en|zh-CN]

无端口时，每层枚举一次已观察到的监听和映射，不连接端口。
指定端口时，保存标准诊断，包括 localhost、IPv4/IPv6 可达性与排除范围。
snapshot 支持 --timeout、--distro、--docker-path、--json；必须提供新文件路径。
不会覆盖已有文件。即使采集不完整，也会保存实际结果并返回 2。
WSL 采集可能启动所选发行版；不会启动 Docker 或修改网络配置。

diff 完全离线，支持 snapshot v1、原 scan v1 和 diagnosis v3 JSON。
嵌入快照的原报告结构不变。显示截断不影响对完整 sources 数组的比较。
要求报告类型、端口和已知主机一致；切换 WSL 发行版或 Docker 端点的来源
标为无法比较。旧 JSON 没有主机信息，需自行确认来自同一台机器。
采集失败不是服务消失；探测错误不是不可达；两次都禁用的探测明确列为跳过。
快照含本机名称、路径与脱敏后的命令行，分享前检查内容。

退出码
  snapshot: 0 已保存且所选检查完整；2 已保存但不完整，或文件/参数错误
  diff:     0 所选可比证据无变化；1 有变化；2 证据不完整或输入错误
            2 的优先级高于 1，JSON 仍包含可比较的变化。

示例
  portdoc snapshot 5173 --out before.json --distro Ubuntu
  # 完成你要观察的环境操作后，再运行：
  portdoc snapshot 5173 --out after.json --distro Ubuntu
  portdoc diff before.json after.json`
    : `portdoc snapshot / diff — save and compare local port evidence

USAGE
  portdoc snapshot --out before.json
  portdoc snapshot 5173 --out before.json [--distro Ubuntu] [--no-probe]
  portdoc diff before.json after.json [--json] [--lang en|zh-CN]

Without a port, inventory listeners and mappings once per layer; no connections.
With a port, capture the standard diagnosis, including localhost, IPv4/IPv6
reachability and excluded ranges. snapshot accepts --timeout, --distro,
--docker-path and --json. --out must name a new file; existing files are never
overwritten. Incomplete collection is still saved, with exit code 2.
WSL queries may start the selected distribution; Docker is not started.

diff is offline and accepts snapshot v1, original scan v1 and diagnosis v3 JSON.
Snapshots embed unchanged reports. Display truncation does not truncate the
complete sources arrays used for comparison. Types, ports and known hosts must
match. A changed WSL distribution or Docker endpoint makes that source
incomparable. For legacy JSON without host context, verify the host yourself.
Collector failure is not service removal; a probe error is not unreachable.
Probes disabled in both inputs are explicitly skipped.
Snapshots contain hostnames, paths and redacted command lines; review before sharing.

EXIT CODES
  snapshot: 0 Saved, selected checks complete; 2 Saved but incomplete, or IO/usage error
  diff:     0 Selected comparable evidence unchanged; 1 Changed; 2 Incomplete/invalid
            2 takes precedence over 1; JSON still contains comparable changes.

EXAMPLE
  portdoc snapshot 5173 --out before.json --distro Ubuntu
  # Perform the environment action you want to observe, then:
  portdoc snapshot 5173 --out after.json --distro Ubuntu
  portdoc diff before.json after.json`;
}
