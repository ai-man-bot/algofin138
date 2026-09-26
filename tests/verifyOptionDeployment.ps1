param([string]$ProjectRef = 'dzboqhobrmzglyuofcyk')
$ErrorActionPreference = 'Stop'
# Read credentials only into process memory. No valid orders are submitted by this test.
function Query([string]$Sql) {
  $result = & npx supabase@latest db query --linked $Sql -o json
  if ($LASTEXITCODE -ne 0) { throw 'Database query failed' }
  return ($result | ConvertFrom-Json).rows
}
function Check($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
Add-Type -AssemblyName System.Net.Http
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(30)
function Request([string]$Method, [string]$Url, [string]$Body = '', [string]$ContentType = 'application/json', $Headers = @{}) {
  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), $Url)
  foreach ($name in $Headers.Keys) { $null = $request.Headers.TryAddWithoutValidation($name, $Headers[$name]) }
  if ($Method -ne 'GET') { $request.Content = [System.Net.Http.StringContent]::new($Body, [Text.Encoding]::UTF8, $ContentType) }
  $response = $client.SendAsync($request).GetAwaiter().GetResult()
  try {
    $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch {}
    return @{ Status = [int]$response.StatusCode; Data = $json }
  } finally { $response.Dispose(); $request.Dispose() }
}
$base = "https://$ProjectRef.supabase.co/functions/v1/webhook-listener"
$broker = @(Query "select a.id,a.user_id,a.base_url,c.api_key,c.api_secret from public.broker_accounts a join public.broker_credentials c on c.broker_account_id=a.id and c.user_id=a.user_id where a.broker_type='alpaca' and a.connected and a.base_url='https://paper-api.alpaca.markets' order by a.created_at desc limit 1;")[0]
Check ($null -ne $broker) 'No connected paper broker exists'
Check ($broker.base_url -eq 'https://paper-api.alpaca.markets') 'Refusing non-paper environment'
$alpacaHeaders = @{ 'APCA-API-KEY-ID'=$broker.api_key; 'APCA-API-SECRET-KEY'=$broker.api_secret }
$account = Request GET ($broker.base_url + '/v2/account') '' 'application/json' $alpacaHeaders
Check ($account.Status -eq 200) 'Paper account read failed'
$clock = Request GET ($broker.base_url + '/v2/clock') '' 'application/json' $alpacaHeaders
Check ($clock.Status -eq 200) 'Paper clock read failed'
Write-Output ("Paper account reachable; options level={0}; market_open={1}" -f $account.Data.options_trading_level,$clock.Data.is_open)
$fromDate = [DateTime]::UtcNow.AddDays(1).ToString('yyyy-MM-dd')
$toDate = [DateTime]::UtcNow.AddDays(28).ToString('yyyy-MM-dd')
$contracts = Request GET ($broker.base_url + "/v2/options/contracts?underlying_symbols=PLTR&expiration_date_gte=$fromDate&expiration_date_lte=$toDate&status=active&limit=1") '' 'application/json' $alpacaHeaders
Check ($contracts.Status -eq 200 -and $contracts.Data.option_contracts.Count -gt 0) 'Paper option-contract lookup failed'
Write-Output ('Contract lookup verified: ' + $contracts.Data.option_contracts[0].symbol)
$workerSecret = @(Query "select decrypted_secret from vault.decrypted_secrets where name='option_worker_secret';")[0].decrypted_secret
$workerHeaders = @{ 'x-option-worker-secret'=$workerSecret }
Check ((Request POST ($base + '/internal/options/reconcile') '{}').Status -eq 401) 'Worker allowed unauthenticated call'
Check ((Request POST ($base + '/internal/options/reconcile') '{}' 'application/json' $workerHeaders).Status -eq 200) 'Worker authenticated call failed'
Check ((Request POST $base 'not an order' 'text/plain').Status -eq 400) 'Missing route token was accepted'
$routeId = [guid]::NewGuid().ToString()
$routeToken = [guid]::NewGuid().ToString()
$userId = [string]$broker.user_id
$brokerId = ([string]$broker.id).Replace("'", "''")
$null = Query "insert into public.webhook_routes(id,token,user_id,broker_account_id,broker_type,name,status) values('$routeId','$routeToken','$userId','$brokerId','alpaca','Option deployment verification','active');"
$testUrl = $base + '?token=' + $routeToken
$plans = @()
try {
  Check ((Request POST $testUrl 'malformed' 'text/plain').Status -eq 400) 'Malformed option message was accepted'
  Check ((Request POST $testUrl '{broken' 'application/json').Status -eq 400) 'Malformed JSON was accepted'
  # Impossible strike contract: parsing and broker lookup run, but no POST /orders can occur.
  $message = 'PLTR: 99999C 10/16: BTO Buy to open at 0.01 with first target above 0.02'
  $first = Request POST $testUrl $message 'text/plain'
  Check ($first.Status -eq 202 -and $first.Data.plan_id) 'Raw-text option plan was not queued'
  $plans += [string]$first.Data.plan_id
  $duplicate = Request POST $testUrl (@{ message=$message } | ConvertTo-Json -Compress)
  Check ($duplicate.Status -eq 202 -and $duplicate.Data.duplicate -and $duplicate.Data.plan_id -eq $first.Data.plan_id) 'Raw/JSON duplicate protection failed'
  $eventId = [guid]::NewGuid().ToString()
  $event = Request POST $testUrl (@{ message=$message; event_id=$eventId } | ConvertTo-Json -Compress)
  Check ($event.Status -eq 202 -and $event.Data.plan_id) 'JSON event-ID plan was not queued'
  $plans += [string]$event.Data.plan_id
  $changed = Request POST $testUrl (@{ message=$message.Replace('0.02','0.03'); event_id=$eventId } | ConvertTo-Json -Compress)
  Check ($changed.Status -eq 409) 'Conflicting duplicate event ID was accepted'
  $mixed = Request POST $testUrl (@{ message=$message; qty=9 } | ConvertTo-Json -Compress)
  Check ($mixed.Status -eq 400) 'Conflicting quantity was accepted'
  Write-Output ('PASS deployed ingress: raw text, JSON, duplicate IDs, conflict rejection, authentication. Plans: ' + ($plans -join ', '))
  # Validate existing legacy stock path without submitting a stock order.
  $legacy = @(Query "select key,value->>'webhookToken' as token from public.kv_store_f118884a where key like 'user:$($userId):strategy:%' and value->>'webhookToken' is not null order by key limit 1;")[0]
  if ($legacy) {
    $strategyId = ($legacy.key -split ':')[-1]
    $stockUrl = $base + '/tradingview-webhook/' + $strategyId + '?token=' + $legacy.token
    $stock = Request POST $stockUrl '{"symbol":"AAPL","side":"buy","qty":1,"type":"limit","limit_price":0,"message":"stock entry note"}'
    Check ($stock.Status -eq 400 -and $stock.Data.error -match 'limit price') 'Structured stock validation regressed'
    Write-Output 'PASS deployed stock JSON validation (no stock order submitted).'
  }
} finally {
  $null = Query "update public.webhook_routes set status='inactive' where id='$routeId';"
  $client.Dispose()
  $broker=$null; $alpacaHeaders=$null; $workerSecret=$null; $workerHeaders=$null
}
