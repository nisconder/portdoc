# portdoc

**localhost 连不上，但 127.0.0.1 能连接？一张表看清 Windows 和 WSL 的差异。**

同时对比 IPv4、IPv6 和 localhost 的 TCP 连接结果，并显示监听进程、
项目路径和 Docker Compose 服务。
用 `portdoc scan` 先发现端口，再检查具体端口及 Windows TCP 排除范围。

[English](README.md) · [下载 Windows 独立版](https://github.com/nisconder/portdoc/releases/latest) · [npm](https://www.npmjs.com/package/portdoc)

![端点矩阵与项目身份演示](https://raw.githubusercontent.com/nisconder/portdoc/main/docs/demo.gif)

动图为明确标注的模拟样例。运行 `portdoc demo --lang zh-CN` 可查看中文样例，
不会检查当前机器。

## 安装

### Windows 独立 EXE（无需 Node.js）

1. 下载 [portdoc-win-x64.zip](https://github.com/nisconder/portdoc/releases/latest/download/portdoc-win-x64.zip)。
2. 解压后，在该文件夹打开 Windows PowerShell 或 CMD。
3. 运行：

```powershell
.\portdoc.exe
.\portdoc.exe demo --lang zh-CN
.\portdoc.exe 5173
```

单独运行会打开帮助。把文件夹加入 PATH 后，可在其他目录直接运行 `portdoc`。
独立版尚未签名，发布页提供 SHA-256 校验和；ZIP 内的 `portdoc.exe` 与
独立下载的 `portdoc-win-x64.exe` 内容相同。可运行
`Get-FileHash .\portdoc.exe -Algorithm SHA256` 核对。

### npm（已在 Windows 安装 Node.js 的用户）

需要 Node.js 18 或更高版本，请在 **Windows PowerShell 或 CMD** 运行：

```powershell
npm install --global portdoc@latest
portdoc --version
portdoc
portdoc 5173
```

`npm i portdoc` 是项目局部安装，不会把命令加入全局 PATH。当前工具需要从
Windows 访问 Windows、WSL 和 Docker，暂不支持安装在 WSL 内运行。

免全局安装运行：

```powershell
npx --yes portdoc@latest 5173
```

镜像尚未同步时，仅对本次安装使用官方源，不改全局配置：

```powershell
npm install --global portdoc@latest --registry=https://registry.npmjs.org/
```

## 能解决什么问题

- 不知道查哪个端口时，用 `scan` 一次汇总三层监听和映射，标出可能重叠项。
- 用 `doctor` 检查本机采集环境，区分必需的 Windows 查询与可选的 WSL/Docker。
- 对比 Windows、WSL 两侧的 `localhost`、`127.0.0.1`、`::1` 是否可以连接。
- 显示 localhost 实际采用的首选解析地址，解释地址族差异。
- Windows 显示 PID、程序和脱敏命令行；有绝对脚本路径时推断项目目录。
- WSL 读取 `/proc` 获取实际工作目录、可执行文件和命令行。
- Docker 显示映射端口、镜像及 Compose 项目、服务、目录标签。
- 根据证据给出下一步检查建议和可复制的验证命令。
- 检查包含目标端口的 Windows IPv4/IPv6 TCP 排除范围，解释潜在绑定限制。

Windows 无法读取实际工作目录，推断路径会明确标注。WSL 详细身份信息需要
Python 3 和进程访问权限，缺少时仍保留基本 `ss` 监听证据。
Docker Compose 信息取决于容器标签。

## 常用命令

```powershell
portdoc                             # 完整帮助
portdoc scan                        # 默认显示前 30 个已观察端口
portdoc scan --issues-only          # 仅查看跨层可能重叠项
portdoc scan --limit 100 --json     # 显示更多端口，保留完整计数
portdoc doctor                      # 检查本机采集环境
portdoc scan --help                 # scan 专属帮助
portdoc demo --lang zh-CN            # 离线模拟样例
portdoc 8080 --distro Ubuntu         # 指定 WSL 发行版
portdoc 5173 --lang zh-CN            # 中文
portdoc 5173 --lang en               # 英文
portdoc 5432 --no-probe              # 仅采集归属，不发起 TCP 连接
portdoc 5173 --json                  # 语言无关诊断 JSON，schemaVersion 3
```

端口可取 `1` 到 `65535`；`5173` 只是示例。默认跟随系统语言，可用
`$env:PORTDOC_LANG = "zh-CN"` 设置当前 PowerShell 会话偏好。

## 排查流程

`doctor` 不启动 WSL 发行版或 Docker，仅检查本机环境。Windows 查询可用时
退出码为 0，可选组件仍可能有警告；必需检查失败时为 2。

`scan` 每层枚举一次，不逐个连接全端口。查询默认或所选 WSL 发行版时，系统
可能启动该发行版。`--limit` 为 1 到 500，限制包括 JSON 在内的 `ports` 列表；
`totalPorts`、`overlapCount`、`truncated` 反映截断前计数，JSON `sources` 保留原证据。
完整列表有可能重叠时退出码为 1，否则检查不完整为 2，完整且无重叠为 0。
scan 不检查可达性或保留范围，需要进一步运行 `portdoc <端口>`。

Docker 仅通过本机 `docker_engine` 或 `dockerDesktopLinuxEngine` named pipe 查询，
不会将远程 Docker context 中的端口映射混入本机结果，也不修改 Docker 配置。

检查单个端口时，同时读取 Windows IPv4/IPv6 TCP 排除范围。无监听但命中排除
范围会显示 `UNKNOWN` 和范围证据。命中并不表示必然无法绑定，也不能证明有
进程占用；已有监听和范围并存也不会自动判为冲突。

只读验证命令会指向实际 PID、WSL 发行版、容器和命中范围。命令只展示，不会
自动执行；窄终端折行时，可从 JSON `nextActions` 取得完整命令字符串。

## 保存快照与比较变化

```powershell
portdoc snapshot --out before.json
# 完成需要观察的环境操作后：
portdoc snapshot --out after.json
portdoc diff before.json after.json

portdoc snapshot 5173 --out port-before.json --distro Ubuntu
# 调整服务后，对同一端口与发行版再次采集：
portdoc snapshot 5173 --out port-after.json --distro Ubuntu
portdoc diff port-before.json port-after.json --json
```

不指定端口时，只枚举各层监听和映射，不发起连接；指定端口时保存完整诊断，
包括 localhost、IPv4、IPv6 可达性及 Windows TCP 排除范围。不会对全部端口逐个
探测；单端口快照支持 `--no-probe`。WSL 查询可能启动所选发行版。

`--out` 必须是新文件路径，不覆盖已有文件。采集不完整仍保存真实结果。
snapshot 退出码 **0** 表示已保存且所选检查完整，**2** 表示已保存但不完整，
或参数/文件错误；它不表示端口健康程度。`--json` 会同时在标准输出显示快照。

diff 完全离线，比较监听身份与项目路径、容器和 Compose 映射、单端口的
可达性和排除范围。时间戳、探测耗时、数组顺序不作为环境变化。采集失败、
身份信息缺失会明确标为证据不足，不会把它们当作监听消失或问题修复。
切换 WSL 发行版或 Docker 端点后，对应来源标为无法比较；缺失或未知的来源身份
也标为无法核实。两次都禁用的探测
列为跳过，不代表已经验证可达性。

diff 退出码：**0** 所选可比证据未发现变化；**1** 有变化；**2** 证据不完整
或输入错误。2 优先于 1，但仍输出能够比较的变化。文本最多显示前 100 项，
`--json` 包含全部变化与无法比较项。观察变化不等于确认根因或修复结果。

[snapshot v1](schema/snapshot.schema.json) 在 `report` 内保存原样的 scan v1 或
diagnosis v3 报告，附带主机和发行版上下文。diff 也接受原有 `scan --json`、
`<端口> --json` 输出，但旧 JSON 不含主机上下文，需要自行确认来自同一机器。
两份输入必须类型和端口一致；已知主机不一致会拒绝比较。清单的显示截断不影响
对完整 `sources` 数组的比较。输入上限 32 MiB，输出契约为
[diff v1](schema/diff.schema.json)。

快照包含本机名称、本地路径和脱敏后的命令行，分享前应检查内容。
可复现的真实机器验证步骤及限制见 [snapshot validation](docs/snapshot-validation.md)。

## 结果边界

| 结果 | 退出码 | 含义 |
| --- | ---: | --- |
| FREE | 0 | 所有采集完成，未发现监听、映射或可连接端点 |
| OK | 0 | 发现归属，未观察到需要处理的异常 |
| CONFLICT | 1 | 多层可能重叠，需要核对是否属于同一服务 |
| UNKNOWN | 2 | 部分检查未完成、地址可达性异常，或无监听但命中排除范围 |

服务只绑定 IPv4 可能是正常配置。localhost 仅测试首选解析地址，不自动回退；
浏览器的选择可能不同。TCP 可以连接也不能证明哪个应用最终接收了连接。
WSL 或 Docker 无法检查时，不会把未检查的端口冒报为空闲。

工具只读诊断，不会结束发现的监听进程、修改网络或上传报告。超时后会尽力
清理本工具启动的采集命令：Windows 使用 `taskkill /T /F`，POSIX 使用独立
进程组。清理另有 250 ms 期限，到期关闭管道、停止等待子进程句柄并将采集命令标为超时；
系统调度可能增加延迟。不能保证结束已脱离进程树或 WSL 内部的后代进程。
常见密钥参数会脱敏，
但路径和命令行仍可能包含私人信息，分享前请复查。

本版尚未包含：主动逐端口探测、HTTP 指纹、网络模式识别、
自动修复、UDP、Podman 和 `wslc`。

开发与 EXE 构建请参阅 [英文说明](README.md#development) 和
[构建文档](docs/build.md)。许可证：[MIT](LICENSE)。

真实环境的启动命令、预期报告和待验证项见[可复现诊断案例](docs/validation.md)。
即使 Windows 与 Linux CI 的单元测试通过，也不代表 Windows／WSL／Docker 组合均已验证。
