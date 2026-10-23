import { VERSION } from "./version.js";

export function getHelpText(language) {
  return language === "zh-CN" ? chineseHelp() : englishHelp();
}

function englishHelp() {
  return `portdoc ${VERSION} — explain a TCP port across Windows, WSL and Docker

ABOUT
  Windows, WSL2 and Docker Desktop do not share one simple port table.
  portdoc combines their listener and port-mapping evidence, then checks
  whether Windows and WSL can actually connect to the requested port.

  Use it when a server reports EADDRINUSE, localhost opens the wrong app,
  a WSL service is unreachable from Windows, or a Docker-published port does
  not behave as expected.

USAGE
  portdoc <port> [options]
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

WHAT GETS CHECKED
  Windows              Listening address, PID, process name and executable
  WSL                  Listening address, PID and process from ss
  Docker               Published host port, container port, name and image
  Reachability         TCP connection from Windows and separately from WSL

OPTIONS
  -d, --distro <name>  Inspect this WSL distribution instead of the default
      --docker-path <file>
                       Use this Docker CLI instead of automatic discovery
  -l, --lang <locale>  Interface language: auto, en, or zh-CN (default: auto)
      --json           Emit language-neutral JSON matching the report schema
      --color          Always use terminal colors
      --no-color       Never use terminal colors
      --no-probe       Collect ownership evidence without opening TCP probes
      --timeout <ms>   Collector timeout from 250 to 30000 (default: 4000)
  -h, -?, --help       Show this help
  -v, --version        Show the installed version

VERDICTS
  FREE                 Every collector succeeded and found no owner
  OK                   One effective ownership path was identified
  CONFLICT             Independent Windows, WSL or Docker layers claim it
  UNKNOWN              Evidence is unavailable, incomplete or contradictory

EXIT CODES
  0                    FREE or OK
  1                    CONFLICT
  2                    UNKNOWN or invalid invocation

SAFETY AND LIMITS
  portdoc is read-only. It never kills a process or changes networking.
  A successful TCP probe proves reachability, not which process accepted the
  connection. The current release inspects TCP only, not UDP.

FROM THIS SOURCE CHECKOUT
  .\\portdoc.cmd <port>               Run with an explicit port
  .\\portdoc.cmd                      Open the interactive Windows launcher`;
}

function chineseHelp() {
  return `portdoc ${VERSION} — 解释 Windows、WSL 和 Docker 中的 TCP 端口

作用
  Windows、WSL2 和 Docker Desktop 并不共享一张简单的端口表。
  portdoc 会合并三者的监听和端口映射证据，并分别检查 Windows 与 WSL
  是否真的能够连接到指定端口。

  适用于 EADDRINUSE、localhost 打开了错误程序、WSL 服务无法从 Windows
  访问，或者 Docker 已发布端口但连接行为不符合预期等情况。

用法
  portdoc <端口> [选项]
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

检查内容
  Windows              监听地址、PID、进程名和可执行文件
  WSL                  通过 ss 读取监听地址、PID 和进程
  Docker               主机端口、容器端口、容器名和镜像
  可达性                分别从 Windows 和 WSL 发起 TCP 连接

选项
  -d, --distro <名称>  检查指定 WSL 发行版，而不是默认发行版
      --docker-path <文件>
                       使用指定 Docker CLI，不进行自动发现
  -l, --lang <语言>    界面语言：auto、en 或 zh-CN（默认：auto）
      --json           输出不受界面语言影响的 JSON 报告
      --color          始终使用终端颜色
      --no-color       禁用终端颜色
      --no-probe       收集端口归属，但不发起 TCP 连接
      --timeout <毫秒> 采集超时，范围 250 到 30000（默认：4000）
  -h, -?, --help       显示此帮助
  -v, --version        显示版本

诊断结果
  FREE                 所有检查完成，未发现占用者
  OK                   找到一条明确的端口归属路径
  CONFLICT             Windows、WSL 或 Docker 存在独立的重复声明
  UNKNOWN              证据缺失、不完整或相互矛盾

退出码
  0                    FREE 或 OK
  1                    CONFLICT
  2                    UNKNOWN 或调用参数错误

安全边界
  portdoc 只读运行，不会结束进程或修改网络设置。TCP 探测成功只能证明
  端口可达，不能单独证明由哪个进程接受了连接。当前版本仅检查 TCP。

在源码目录运行
  .\\portdoc.cmd <端口>               检查指定端口
  .\\portdoc.cmd                      打开 Windows 交互启动器`;
}
