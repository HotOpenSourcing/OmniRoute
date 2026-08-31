$ErrorActionPreference = "SilentlyContinue"
$home = $env:USERPROFILE
$candidates = @(
    "$home\.omniroute",
    "$home\AppData\Local\omniroute",
    "$home\AppData\Roaming\omniroute",
    "$home\.config\omniroute"
)
foreach ($p in $candidates) {
    if (Test-Path $p) {
        Write-Host "FOUND: $p"
        Get-ChildItem -Path $p | Select-Object Name, Length | Format-Table -AutoSize | Out-String | Write-Host
    } else {
        Write-Host "missing: $p"
    }
}
