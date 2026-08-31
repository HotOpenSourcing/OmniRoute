$paths = @(
    "C:\Users\amine\OmniRoute\src\sse\handlers\chat.ts",
    "C:\Users\amine\OmniRoute\src\sse\handlers\chatHelpers.ts",
    "C:\Users\amine\OmniRoute\src\sse\handlers\requestBody.ts",
    "C:\Users\amine\OmniRoute\src\sse\handlers\resolveRoutingModel.ts",
    "C:\Users\amine\OmniRoute\src\sse\handlers\chatCore.ts",
    "C:\Users\amine\OmniRoute\src\sse\services\*.ts"
)
foreach ($p in $paths) {
    if (Test-Path $p) {
        Get-ChildItem $p -ErrorAction SilentlyContinue | ForEach-Object {
            Select-String -Path $_.FullName -Pattern "freebuff" -CaseSensitive:$false
        }
    }
}
