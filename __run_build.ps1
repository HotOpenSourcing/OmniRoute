Start-Transcript -Path "C:\Users\amine\OmniRoute\__build.log" -Force
Set-Location "C:\Users\amine\OmniRoute"
& npm run build 2>&1 | Out-Null
$ec = $LASTEXITCODE
Write-Host "---BUILD_EXITCODE:$ec---"
Stop-Transcript
exit $ec
