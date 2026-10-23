[CmdletBinding()]
param()

$Host.UI.RawUI.WindowTitle = "portdoc"
$language = if ([Globalization.CultureInfo]::CurrentUICulture.Name -like "zh*") { "zh-CN" } else { "en" }
$isChinese = $language -eq "zh-CN"

Write-Host ""
Write-Host "  PORTDOC" -ForegroundColor Cyan
Write-Host $(if ($isChinese) { "  一个端口，检查 Windows、WSL 和 Docker，给出一个结论。" } else { "  One port. Windows, WSL and Docker. One answer." }) -ForegroundColor DarkGray
Write-Host ""
Write-Host $(if ($isChinese) { "  适用于：" } else { "  Use this when:" }) -ForegroundColor White
if ($isChinese) {
  Write-Host "    - localhost 打开了错误的程序"
  Write-Host "    - 服务提示端口已被占用"
  Write-Host "    - WSL 服务在 Linux 内可用，但 Windows 无法访问"
  Write-Host "    - Docker 已发布端口，但无法连接"
} else {
  Write-Host "    - localhost opens the wrong application"
  Write-Host "    - a server says the port is already in use"
  Write-Host "    - a WSL service works inside Linux but not from Windows"
  Write-Host "    - Docker publishes a port that you cannot reach"
}
Write-Host ""

$port = 0
do {
  $answer = Read-Host $(if ($isChinese) { "  要检查的 TCP 端口" } else { "  TCP port to inspect" })
  $valid = [int]::TryParse($answer, [ref]$port) -and $port -ge 1 -and $port -le 65535
  if (-not $valid) {
    Write-Host $(if ($isChinese) { "  请输入 1 到 65535 之间的数字。" } else { "  Enter a number from 1 to 65535." }) -ForegroundColor Yellow
  }
} until ($valid)

Write-Host ""
& node.exe (Join-Path $PSScriptRoot "bin\wsl-port-doctor.js") $port --lang $language
$exitCode = $LASTEXITCODE

Write-Host ""
[void](Read-Host $(if ($isChinese) { "  按 Enter 关闭" } else { "  Press Enter to close" }))
exit $exitCode
