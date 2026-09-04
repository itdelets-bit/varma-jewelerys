$root = $PSScriptRoot
$listener = New-Object Net.HttpListener
$listener.Prefixes.Add('http://localhost:8765/')
$listener.Start()
Start-Process 'http://localhost:8765/offline.html'
Write-Host 'Varma Jewellers is running at http://localhost:8765/offline.html'
Write-Host 'Close this window to stop the offline app.'
$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.svg'='image/svg+xml'; '.ico'='image/x-icon'
}
try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'offline.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      $context.Response.StatusCode = 404
      $context.Response.Close()
      continue
    }
    $bytes = [IO.File]::ReadAllBytes($file)
    $extension = [IO.Path]::GetExtension($file).ToLowerInvariant()
    $context.Response.ContentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { 'application/octet-stream' }
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
  }
} finally { $listener.Stop() }
