$ErrorActionPreference = "Stop"
try {
    $resp = Invoke-WebRequest -Uri 'http://localhost:20128/api/oauth/freebuff/import-token' -Method POST -ContentType 'application/json' -InFile 'C:\Users\amine\OmniRoute\scratch\freebuff-import-body.json' -UseBasicParsing -TimeoutSec 30
    Write-Host "STATUS: $($resp.StatusCode)"
    Write-Host "BODY: $($resp.Content)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "RESP: $($reader.ReadToEnd())"
    }
}
