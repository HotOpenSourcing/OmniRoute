$ErrorActionPreference = "Stop"
$apiKey = "sk-8535c065351998d0-059a4e-94fdd3ad"
$headers = @{
    "Authorization" = "Bearer $apiKey"
    "Content-Type" = "application/json"
}
$body = '{"model":"freebuff/mimo/mimo-v2.5","messages":[{"role":"user","content":"sdq"}],"stream":true,"stream_options":{"include_usage":true}}'

try {
    $resp = Invoke-WebRequest -Uri 'http://localhost:20128/api/v1/chat/completions' -Method POST -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 30
    Write-Host "STATUS: $($resp.StatusCode)"
    Write-Host "BODY: $($resp.Content)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "RESP: $($reader.ReadToEnd())"
    }
}
