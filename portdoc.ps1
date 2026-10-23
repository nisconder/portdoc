[CmdletBinding()]
param()

$Host.UI.RawUI.WindowTitle = "portdoc"

Write-Host ""
Write-Host "  PORTDOC" -ForegroundColor Cyan
Write-Host "  One port. Windows, WSL and Docker. One answer." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Use this when:" -ForegroundColor White
Write-Host "    - localhost opens the wrong application"
Write-Host "    - a server says the port is already in use"
Write-Host "    - a WSL service works inside Linux but not from Windows"
Write-Host "    - Docker publishes a port that you cannot reach"
Write-Host ""

$port = 0
do {
  $answer = Read-Host "  TCP port to inspect"
  $valid = [int]::TryParse($answer, [ref]$port) -and $port -ge 1 -and $port -le 65535
  if (-not $valid) {
    Write-Host "  Enter a number from 1 to 65535." -ForegroundColor Yellow
  }
} until ($valid)

Write-Host ""
& node.exe (Join-Path $PSScriptRoot "bin\wsl-port-doctor.js") $port
$exitCode = $LASTEXITCODE

Write-Host ""
[void](Read-Host "  Press Enter to close")
exit $exitCode
