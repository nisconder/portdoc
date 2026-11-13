# 真实诊断案例与复现记录

这份清单用于建立可复现证据，不是已经通过的兼容性声明。[2026-10-31 实测记录](validation-2026-10-31.md)保存了 Windows IPv4 监听、Ubuntu WSL 有监听但 Windows IPv4 不可达，以及缺失 Docker CLI 的实际观察；IPv6 策略限制和未覆盖的变体单列说明。下面五类场景是完整验证清单，不能把单机部分覆盖等同于全部通过。单元测试、故障注入、`portdoc demo` 和真实机器报告应分别记录。当前 JSON 契约为 [report.schema.json](../schema/report.schema.json)，`schemaVersion` 为 3。

从仓库运行真实验证脚本（会启动指定 WSL 发行版，不启动 Docker 或修改网络配置）：

```powershell
node scripts/validate-live.mjs --out .build/validation-new --distro Ubuntu
# 也可以通过 --entry <安装后的bin/portdoc.js或EXE> 核验实际产物。
```

输出目录必须为空。脚本保存命令参数、原始字节、解码文本、退出码、耗时、独立检查和清理记录；环境受限返回 2，证据不一致返回 1，所有检查及环境条件满足才返回 0。

## 每次运行保留什么

从仓库根目录在 Windows PowerShell 运行。将结果保存在本机临时目录，分享前复查报告中的路径、命令行、容器名称和标签。

```powershell
$caseDir = Join-Path ([System.IO.Path]::GetTempPath()) ("portdoc-validation-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $caseDir | Out-Null
node --version
node ./bin/portdoc.js --version
git rev-parse HEAD
[System.Environment]::OSVersion.VersionString
wsl.exe --status
wsl.exe --list --verbose
node ./bin/portdoc.js doctor --json | Out-File -Encoding utf8 (Join-Path $caseDir 'doctor.json')
$LASTEXITCODE
```

另存以上输出、是否管理员运行、Windows/WSL 网络模式及其信息来源、发行版与内核版本、Docker Desktop/Engine 版本、选用的本地 named pipe。只记录所需环境字段，不导出整个环境变量或 Docker 配置。`doctor` 不启动发行版或 Docker；下面的单端口诊断可能启动所选 WSL 发行版。仅在准备验证该环境时运行。

每个案例使用这份记录，不满足前置条件时写“未覆盖”，不要改写预期来冒充通过：

| 字段 | 内容 |
| --- | --- |
| 状态 | 待验证 / 通过 / 不符合预期 / 环境受限 / 未覆盖 |
| 日期、时区、代码提交 | 精确版本与本地改动说明 |
| 环境 | Windows、Node、权限、WSL 发行版/网络模式、Docker 版本/本地端点 |
| 前置条件和启动命令 | 实际绑定地址、端口、测试进程 PID 或容器 ID |
| 预期 | 下文对应证据字段，不只写最终 verdict |
| 实际 | 原始 JSON、CLI 退出码、耗时、独立核对命令输出 |
| 差异与限制 | 哪一步失败、哪些层没有检查、是否存在并发变化 |
| 清理 | 测试监听/容器是否已经停止 |

保存单端口报告的通用命令如下；将 `$port` 设为本次测试实际端口，使用有意义的文件名：

```powershell
node ./bin/portdoc.js $port --json | Out-File -Encoding utf8 (Join-Path $caseDir 'report.json')
$reportExitCode = $LASTEXITCODE
Get-Content -Raw (Join-Path $caseDir 'report.json') | ConvertFrom-Json
$reportExitCode
```

CLI 退出码 0/1/2 分别对应 `FREE` 或 `OK` / `CONFLICT` / `UNKNOWN`。收集失败时不要求报告一律为 `UNKNOWN`：已有有效监听证据时可能为 `OK`，但应保留失败来源与较低置信度。

## 1. IPv4 监听，localhost 首选 IPv6

**状态：待验证。** 在第一个 PowerShell 窗口启动本次专用监听，让系统选择空闲端口，并记录输出中的 PID 和端口：

```powershell
@'
import net from "node:net";
const server = net.createServer(socket => socket.end());
server.listen(0, "127.0.0.1", () => {
  console.log(JSON.stringify({ pid: process.pid, ...server.address() }));
});
'@ | node --input-type=module
```

在第二个窗口采集该端口的完整报告，并用 `Get-NetTCPConnection -LocalPort $port -State Listen` 独立核对地址与 PID。不要注入 DNS 返回值；以 `endpointMatrix.windows.localhost.address` 的实际地址为准。

当本机 localhost 首选 `::1` 且 TCP 探测可用时，预期：

- `sources.windows.listeners` 中有本次 PID，地址为 `127.0.0.1`。
- `endpointMatrix.windows.ipv4` 为 `status: "ok"`、`reachable: true`。
- `localhost` 记录 `address: "::1"`、`family: 6`，`localhost` 和 `ipv6` 为 `status: "ok"`、`reachable: false`。
- `assessment.findings` 包含 `LOCALHOST_RESOLUTION_MISMATCH` 和 `ENDPOINT_FAMILY_MISMATCH`；没有其他重叠证据时 verdict 为 `UNKNOWN`。

如果 localhost 实际首选 IPv4，则记录正常可达，本次未覆盖“首选 IPv6”条件。如果出现 `EACCES` 等错误，应记录 `reachable: null` 的探测受限结果，不能把它当成连接被拒绝或证明服务不可达。结束后在第一个窗口按 Ctrl+C；只停止自己刚启动的监听。

## 2. WSL 有监听，Windows 不可达

**状态：待验证。** 前置条件是已经准备好的 WSL 环境确实呈现此差异；这里不修改防火墙、localhost forwarding 或网络模式。

在选定发行版的终端内选择未占用端口，例如：

```sh
python3 -u -m http.server 48731 --bind 127.0.0.1
```

保持服务运行，在另一个同发行版终端记录 `ss -ltnp 'sport = :48731'` 及 `curl --max-time 2 -I http://127.0.0.1:48731/`。在 Windows 记录：

```powershell
$port = 48731
node ./bin/portdoc.js $port --distro Ubuntu --json | Out-File -Encoding utf8 (Join-Path $caseDir 'wsl-report.json')
$LASTEXITCODE
Test-NetConnection 127.0.0.1 -Port $port
```

将 `Ubuntu` 换成实际发行版。必须同时保留 WSL 内独立连接成功与 Windows 连接失败的证据。预期 `sources.wsl.status` 为 `ok`、存在对应监听，`endpointMatrix.wsl.ipv4.reachable` 为 true，而 Windows 对应端点为 `status: "ok"`、`reachable: false`。在没有其他冲突或 Windows 归属证据时，预期 `WSL_NOT_REACHABLE_FROM_WINDOWS` 与 verdict `UNKNOWN`。这只能证明观察到的可达性差异，不能单凭它确定转发或防火墙根因。

如果 Windows 也能连接，记录正常转发，本次未覆盖此条件；如果 Windows 探测为 `error`，记录环境受限。结束后在 WSL 服务终端按 Ctrl+C，不执行 `wsl --shutdown`。

## 3. Docker 发布与本地监听出现同一端口

**状态：待验证。** 仅在已运行的本机 Docker Engine 上操作，不自动启动 Docker Desktop。先选择可用的本地端点（`docker_engine` 或 `dockerDesktopLinuxEngine`），后续所有 Docker 命令都使用同一 `--host`。

```powershell
$dockerHost = 'npipe:////./pipe/dockerDesktopLinuxEngine'
docker --host $dockerHost version
docker --host $dockerHost image ls --digests
```

使用已经存在于本机、能以前台进程启动 TCP 服务的测试镜像。记录不可变镜像 ID、服务端口和完整命令；下面的镜像 ID 和端口必须替换为实际值，`--pull=never` 避免下载镜像：

```powershell
$imageId = '填入本机已有镜像的不可变ID'
docker --host $dockerHost run --pull=never --rm --name portdoc-validation-web -p 127.0.0.1:48732:80 $imageId
```

若镜像默认不监听容器 80 端口，则改用镜像实际启动命令和端口。保持该窗口运行，在另一个窗口记录 `docker --host $dockerHost ps --no-trunc`、`docker --host $dockerHost inspect portdoc-validation-web`、Windows 同端口监听和 `portdoc 48732 --json`。

预期 `sources.docker.mappings` 记录本次容器 ID、`hostAddress`、`hostPort`、`containerPort`；`sources.docker.endpoint` 为两个固定本地管道之一。采集器先尝试 `docker_engine`，成功后不会继续查询另一端点；如果报告端点与手工端点不同，先核对它们是否指向同一 Engine 和容器，不能将不同对象的结果直接比较。若 Windows 同端口监听属于 Docker 自身转发进程，不能仅因出现两次就认定独立冲突；记录 Windows PID、进程名和报告 findings。

另一个独立 Windows 测试监听若无法绑定相同地址/端口，应保存启动失败，而不是宣称复现了“双服务同时占用”。若只能用 IPv4/IPv6 或不同具体地址实现同端口并存，记录两个绑定地址；地址不重叠时不应仅凭端口号产生 collision。真正的独立跨层重叠才检查 `WINDOWS_DOCKER_COLLISION`，其置信度仍为 medium，不证明流量到了哪个应用。

完成后仅停止本次命名容器：`docker --host $dockerHost stop portdoc-validation-web`。`--rm` 会移除它；保留原始容器 ID 供核对。若这个名称已存在，不复用或停止它，另选唯一名称。

## 4. Windows TCP 排除范围

**状态：待验证。** 读取已有范围，不新增、删除或修改排除项：

```powershell
netsh.exe interface ipv4 show excludedportrange protocol=tcp
netsh.exe interface ipv6 show excludedportrange protocol=tcp
```

从已有范围中选一个有效 TCP 端口，记录 family、start、end 及是否带星号，并采集 `portdoc <端口> --json`。用 `Get-NetTCPConnection -LocalPort <端口> -State Listen` 核对是否已有监听；不需要为了本案例尝试绑定该端口。

预期 `reservations.matches` 含满足 `start <= port <= end` 的记录，`family` 与原始表一致，`administered` 对应星号，findings 包含 `WINDOWS_RESERVED_PORT`。没有监听/映射且没有更高优先级异常时，verdict 应为 `UNKNOWN`，不能是 `FREE`。已有监听与排除范围共存也不能单凭这一点判断冲突。

如果某个 family 查询无权限或失败，该 family 的 status/reason 应保留；不能把空 `matches` 当作已证明不存在排除范围。没有已有排除项时记录未覆盖。本案例没有系统配置需要恢复。

## 5. 采集器缺失、无权限或超时

**状态：待验证。** 将真实环境故障和受控注入分开记录。

缺失 Docker CLI 可通过显式不存在路径复现，无需改 PATH 或卸载软件：

```powershell
$missingDocker = Join-Path $caseDir 'does-not-exist-docker.exe'
Test-Path -LiteralPath $missingDocker
node ./bin/portdoc.js $port --docker-path $missingDocker --json | Out-File -Encoding utf8 (Join-Path $caseDir 'missing-docker.json')
$LASTEXITCODE
```

先确认 `Test-Path` 为 false。预期 `sources.docker.status` 为 `unavailable`、`mappings` 为空、`reason` 说明指定 CLI 未找到。它表示未采到 Docker 证据，不是 Docker 已检查且没有映射；没有其他归属时不能据此宣告 `FREE`。

无权限场景只在现有受限账户/终端实际遇到时记录：保留原命令退出码、错误及对应 `sources`、`reservations.families` 或 `endpointMatrix` 的 status/reason，不更改系统 ACL 或安全设置。`reachable: null` 与 `reachable: false` 必须区分。

`--timeout 250` 只会缩短预算，不能保证真实采集器必定超时。只有原命令确实超时才将它记为环境案例；记录 wall-clock 耗时、返回的错误原因和保留下来的其他层证据。进程调用的超时、继承输出管道、清理期限回归参见 `test/run-command.test.js`；采集器错误转换与不完整证据判定参见 `test/reservations.test.js`、`test/docker.test.js`、`test/analyze.test.js`。这些故障注入测试不能替代真实 Windows/WSL/Docker 环境验证。

上述缺失路径不创建可执行文件，无需恢复系统设置。清理报告目录前先检查其绝对路径和内容；可以保留它作为本机证据，不必自动删除。

## 进程调用回归的范围

超时实现同时处理进程退出和管道关闭。Node 的 [`close` 事件](https://nodejs.org/api/child_process.html#event-close) 会等待共享的标准输出管道关闭，因此单独结束根进程不足以保证及时返回。Windows 使用 [`taskkill /T /F`](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill) 尝试结束本工具启动的采集进程树；POSIX 使用独立进程组。清理另有 250 ms 期限，系统调度可能增加实际耗时。

`test/run-command.test.js` 将存活进程树、根进程提前退出、后代持有管道与外层 CLI 实际退出分开检查。Windows 某些情况下根进程退出后管道视图会及时关闭，不要求它复现 Linux 的同一种延迟。已脱离进程树的后代或 WSL 内部进程不保证全部终止；最终期限保证工具不会无限等待这些管道。这些测试只创建并清理自身构造进程，不结束诊断发现的监听服务。
