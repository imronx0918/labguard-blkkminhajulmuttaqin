// Generator kebijakan browser (Chrome & Edge Enterprise) — TERPISAH dari kebijakan DNS.
// Menghasilkan: JSON managed policy (Linux), file .reg dan PowerShell installer (Windows).
import type { CompiledPolicy } from './policyCompiler.js';

export type BrowserPolicyMap = Record<string, string | number | boolean | string[]>;

/** Daftar browser alternatif yang dibatasi lewat kebijakan Windows DisallowRun (lapisan tambahan; gunakan AppLocker untuk penegakan kuat). */
export const ALT_BROWSER_EXECUTABLES = ['firefox.exe', 'opera.exe', 'launcher.exe', 'brave.exe', 'vivaldi.exe', 'tor.exe', 'browser.exe', 'chromium.exe', 'iexplore.exe', 'waterfox.exe', 'yandex.exe', 'ucbrowser.exe'];

export function browserPolicyMap(p: CompiledPolicy): BrowserPolicyMap {
  const b = p.browser;
  return {
    URLBlocklist: b.URLBlocklist,
    URLAllowlist: b.URLAllowlist,
    ForceGoogleSafeSearch: b.ForceGoogleSafeSearch,
    ForceYouTubeRestrict: b.ForceYouTubeRestrict,
    IncognitoModeAvailability: b.IncognitoModeAvailability,
    BrowserGuestModeEnabled: b.BrowserGuestModeEnabled,
    BrowserAddPersonEnabled: b.BrowserAddPersonEnabled,
    DeveloperToolsAvailability: b.DeveloperToolsAvailability,
    ExtensionInstallBlocklist: b.ExtensionInstallBlocklist,
    DnsOverHttpsMode: b.DnsOverHttpsMode,
    ProxyMode: b.ProxyMode,
    HomepageLocation: b.HomepageLocation,
    HomepageIsNewTabPage: b.HomepageIsNewTabPage,
    RestoreOnStartup: b.RestoreOnStartup,
    RestoreOnStartupURLs: b.RestoreOnStartupURLs,
    DefaultSearchProviderEnabled: b.DefaultSearchProviderEnabled,
    DefaultSearchProviderName: b.DefaultSearchProviderName,
    DefaultSearchProviderSearchURL: b.DefaultSearchProviderSearchURL,
    BrowserSignin: b.BrowserSignin,
    SyncDisabled: b.SyncDisabled,
    PasswordManagerEnabled: b.PasswordManagerEnabled,
    QuicAllowed: b.QuicAllowed,
    AllowDinosaurEasterEgg: b.AllowDinosaurEasterEgg,
  };
}

export function linuxPolicyJson(p: CompiledPolicy): string {
  return JSON.stringify(browserPolicyMap(p), null, 2) + '\n';
}

const regEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function windowsRegFile(p: CompiledPolicy, version: string): string {
  const map = browserPolicyMap(p);
  const out: string[] = ['Windows Registry Editor Version 5.00', '', `; LABGUARD EDU — kebijakan browser (${p.profileName}) versi ${version}`, '; Terapkan sebagai Administrator. Verifikasi di chrome://policy dan edge://policy', ''];
  for (const vendor of ['Google\\Chrome', 'Microsoft\\Edge']) {
    const root = `HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\${vendor}`;
    // Hapus daftar lama agar tidak tercampur
    for (const [k, v] of Object.entries(map)) if (Array.isArray(v)) out.push(`[-${root}\\${k}]`);
    out.push('', `[${root}]`);
    for (const [k, v] of Object.entries(map)) {
      if (Array.isArray(v)) continue;
      if (typeof v === 'boolean') out.push(`"${k}"=dword:${v ? '00000001' : '00000000'}`);
      else if (typeof v === 'number') out.push(`"${k}"=dword:${v.toString(16).padStart(8, '0')}`);
      else out.push(`"${k}"="${regEsc(v)}"`);
    }
    for (const [k, v] of Object.entries(map)) {
      if (!Array.isArray(v)) continue;
      out.push('', `[${root}\\${k}]`);
      v.forEach((item, i) => out.push(`"${i + 1}"="${regEsc(item)}"`));
    }
    out.push('');
  }
  out.push('[HKEY_LOCAL_MACHINE\\SOFTWARE\\LabGuardEdu]', `"PolicyVersion"="${regEsc(version)}"`, `"PolicyProfile"="${regEsc(p.profileName)}"`, '');
  return out.join('\r\n');
}

const psEsc = (s: string) => s.replace(/'/g, "''");

/** Fungsi PowerShell yang menulis peta kebijakan ke registry Chrome & Edge. */
function psApplyFunction(): string {
  return `
function Set-LabGuardBrowserPolicy([hashtable]$Policy, [string]$Version, [string]$Profile) {
  foreach ($vendor in @('Google\\Chrome','Microsoft\\Edge')) {
    $root = "HKLM:\\SOFTWARE\\Policies\\$vendor"
    New-Item -Path $root -Force | Out-Null
    foreach ($k in $Policy.Keys) {
      $v = $Policy[$k]
      if ($v -is [System.Array]) {
        $sub = Join-Path $root $k
        if (Test-Path $sub) { Remove-Item -Path $sub -Recurse -Force }
        New-Item -Path $sub -Force | Out-Null
        for ($i = 0; $i -lt $v.Count; $i++) { New-ItemProperty -Path $sub -Name ([string]($i + 1)) -Value ([string]$v[$i]) -PropertyType String -Force | Out-Null }
      } elseif ($v -is [bool]) {
        New-ItemProperty -Path $root -Name $k -Value ([int]$v) -PropertyType DWord -Force | Out-Null
      } elseif ($v -is [int] -or $v -is [long]) {
        New-ItemProperty -Path $root -Name $k -Value ([int]$v) -PropertyType DWord -Force | Out-Null
      } else {
        New-ItemProperty -Path $root -Name $k -Value ([string]$v) -PropertyType String -Force | Out-Null
      }
    }
  }
  New-Item -Path 'HKLM:\\SOFTWARE\\LabGuardEdu' -Force | Out-Null
  New-ItemProperty -Path 'HKLM:\\SOFTWARE\\LabGuardEdu' -Name 'PolicyVersion' -Value $Version -PropertyType String -Force | Out-Null
  New-ItemProperty -Path 'HKLM:\\SOFTWARE\\LabGuardEdu' -Name 'PolicyProfile' -Value $Profile -PropertyType String -Force | Out-Null
}`;
}

function psHashtable(map: BrowserPolicyMap): string {
  const lines = Object.entries(map).map(([k, v]) => {
    if (Array.isArray(v)) return `  '${k}' = @(${v.map((x) => `'${psEsc(x)}'`).join(', ')})`;
    if (typeof v === 'boolean') return `  '${k}' = $${v}`;
    if (typeof v === 'number') return `  '${k}' = [int]${v}`;
    return `  '${k}' = '${psEsc(v)}'`;
  });
  return `@{\n${lines.join('\n')}\n}`;
}

export interface DeviceInstallerOptions { baseUrl: string; deviceId?: string; deviceToken?: string; blockAltBrowsers?: boolean }

export function windowsPowerShellInstaller(p: CompiledPolicy, version: string, opt: DeviceInstallerOptions): string {
  const map = browserPolicyMap(p);
  const withAgent = !!(opt.deviceId && opt.deviceToken);
  return `#Requires -RunAsAdministrator
# =====================================================================
# LABGUARD EDU — Installer Kebijakan Browser Windows (Chrome & Edge)
# Profil : ${p.profileName}
# Versi  : ${version}
# Jalankan: PowerShell (Run as Administrator) ->  Set-ExecutionPolicy -Scope Process Bypass; .\\labguard-install.ps1
# Verifikasi: buka chrome://policy lalu klik "Reload policies".
# =====================================================================
$ErrorActionPreference = 'Stop'
${psApplyFunction()}

$Policy = ${psHashtable(map)}

# Cadangan kebijakan sebelumnya (untuk pemulihan)
$backupDir = "$env:ProgramData\\LabGuardEdu\\backup"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
& reg.exe export 'HKLM\\SOFTWARE\\Policies\\Google\\Chrome' "$backupDir\\chrome-$stamp.reg" /y 2>$null | Out-Null
& reg.exe export 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge' "$backupDir\\edge-$stamp.reg" /y 2>$null | Out-Null

Set-LabGuardBrowserPolicy -Policy $Policy -Version '${psEsc(version)}' -Profile '${psEsc(p.profileName)}'
Write-Host "[LABGUARD] Kebijakan browser versi ${version} diterapkan." -ForegroundColor Green
${opt.blockAltBrowsers !== false ? `
# Batasi browser alternatif (lapisan dasar; untuk penegakan kuat gunakan AppLocker/WDAC via GPO)
$dr = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer'
New-Item -Path $dr -Force | Out-Null
New-ItemProperty -Path $dr -Name 'DisallowRun' -Value 1 -PropertyType DWord -Force | Out-Null
$list = "$dr\\DisallowRun"; New-Item -Path $list -Force | Out-Null
$i = 1; foreach ($exe in @(${ALT_BROWSER_EXECUTABLES.map((e) => `'${e}'`).join(', ')})) { New-ItemProperty -Path $list -Name ([string]$i) -Value $exe -PropertyType String -Force | Out-Null; $i++ }
Write-Host "[LABGUARD] Pembatasan browser alternatif (DisallowRun) aktif. Catatan: dapat dilewati bila file di-rename; gunakan AppLocker." -ForegroundColor Yellow
` : ''}
${withAgent ? `
# ---------------- Agen sinkronisasi perangkat (tarik kebijakan terbaru tiap 5 menit) ----------------
$agentDir = "$env:ProgramData\\LabGuardEdu"
New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
$cfg = @{ baseUrl = '${psEsc(opt.baseUrl)}'; deviceId = '${psEsc(opt.deviceId!)}'; token = '${psEsc(opt.deviceToken!)}' } | ConvertTo-Json
Set-Content -Path "$agentDir\\device.json" -Value $cfg -Encoding UTF8
# Hanya SYSTEM & Administrators yang boleh membaca token perangkat
& icacls.exe "$agentDir\\device.json" /inheritance:r /grant:r 'SYSTEM:(R)' 'Administrators:(F)' | Out-Null

$agent = @'
$ErrorActionPreference = 'Stop'
${psApplyFunction()}
$cfg = Get-Content "$env:ProgramData\\LabGuardEdu\\device.json" -Raw | ConvertFrom-Json
$headers = @{ 'Authorization' = "Device $($cfg.deviceId):$($cfg.token)" }
$current = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\LabGuardEdu' -ErrorAction SilentlyContinue).PolicyVersion
$status = 'UP_TO_DATE'; $err = $null
try {
  $resp = Invoke-RestMethod -Uri "$($cfg.baseUrl)/api/device-agent/browser-policy" -Headers $headers -Method Get -TimeoutSec 20
  if ($resp.version -ne $current) {
    $h = @{}; $resp.policy.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }
    Set-LabGuardBrowserPolicy -Policy $h -Version $resp.version -Profile $resp.profileName
    $current = $resp.version
  }
} catch { $status = 'FAILED'; $err = $_.Exception.Message }
$body = @{ appliedPolicyVersion = $current; status = $status; error = $err; os = (Get-CimInstance Win32_OperatingSystem).Caption; browser = 'Chrome/Edge'; agentVersion = '1.0.0'; hostname = $env:COMPUTERNAME } | ConvertTo-Json
Invoke-RestMethod -Uri "$($cfg.baseUrl)/api/device-agent/checkin" -Headers $headers -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20 | Out-Null
'@
Set-Content -Path "$agentDir\\labguard-device-agent.ps1" -Value $agent -Encoding UTF8
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$agentDir\\labguard-device-agent.ps1\`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
$trigger2 = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName 'LabGuardEduDeviceAgent' -Action $action -Trigger @($trigger, $trigger2) -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'LabGuardEduDeviceAgent'
Write-Host "[LABGUARD] Agen sinkronisasi perangkat terpasang (Task Scheduler: LabGuardEduDeviceAgent)." -ForegroundColor Green
` : `
# Agen sinkronisasi TIDAK dipasang (installer ini tidak berisi token perangkat).
# Unduh installer per-perangkat dari menu Perangkat Komputer > Registrasi untuk sinkronisasi otomatis.
`}
Write-Host "Selesai. Pastikan akun peserta didik BUKAN Administrator lokal agar kebijakan tidak dapat diubah."
`;
}

export function linuxInstaller(p: CompiledPolicy, version: string, opt: DeviceInstallerOptions): string {
  const json = linuxPolicyJson(p);
  const withAgent = !!(opt.deviceId && opt.deviceToken);
  return `#!/usr/bin/env bash
# =====================================================================
# LABGUARD EDU — Installer Kebijakan Browser Linux (Chrome, Chromium, Edge)
# Profil : ${p.profileName}
# Versi  : ${version}
# Jalankan: sudo bash labguard-install.sh
# Verifikasi: buka chrome://policy
# =====================================================================
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Jalankan sebagai root (sudo)"; exit 1; }
DIRS="/etc/opt/chrome/policies/managed /etc/chromium/policies/managed /etc/chromium-browser/policies/managed /etc/opt/edge/policies/managed"
BACKUP=/var/backups/labguard-edu; mkdir -p "$BACKUP"; STAMP=$(date +%Y%m%d-%H%M%S)
TMP=$(mktemp)
cat > "$TMP" <<'LABGUARD_POLICY_JSON'
${json}LABGUARD_POLICY_JSON
python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$TMP"   # validasi JSON sebelum dipasang
for d in $DIRS; do
  mkdir -p "$d"
  [ -f "$d/labguard.json" ] && cp "$d/labguard.json" "$BACKUP/$(echo "$d" | tr / _)-$STAMP.json"
  install -m 0644 -o root -g root "$TMP" "$d/labguard.json"
done
rm -f "$TMP"
mkdir -p /etc/labguard-edu && echo "${version}" > /etc/labguard-edu/policy-version
echo "[LABGUARD] Kebijakan browser versi ${version} dipasang."
${withAgent ? `
# ---------------- Agen sinkronisasi perangkat (systemd timer, tiap 5 menit) ----------------
umask 077
cat > /etc/labguard-edu/device.env <<EOF
LABGUARD_BASE_URL=${opt.baseUrl}
LABGUARD_DEVICE_ID=${opt.deviceId}
LABGUARD_DEVICE_TOKEN=${opt.deviceToken}
EOF
chmod 600 /etc/labguard-edu/device.env
cat > /usr/local/sbin/labguard-device-agent <<'AGENT'
#!/usr/bin/env bash
set -uo pipefail
. /etc/labguard-edu/device.env
AUTH="Authorization: Device $LABGUARD_DEVICE_ID:$LABGUARD_DEVICE_TOKEN"
CUR=$(cat /etc/labguard-edu/policy-version 2>/dev/null || echo none)
STATUS=UP_TO_DATE; ERR=""
RESP=$(curl -fsS --max-time 20 -H "$AUTH" "$LABGUARD_BASE_URL/api/device-agent/browser-policy") || { STATUS=FAILED; ERR="fetch failed"; }
if [ "$STATUS" = UP_TO_DATE ]; then
  NEWV=$(printf '%s' "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['version'])")
  if [ "$NEWV" != "$CUR" ]; then
    printf '%s' "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); open('/tmp/labguard-policy.json','w').write(json.dumps(d['policy'],indent=2))" \\
      && for d in /etc/opt/chrome/policies/managed /etc/chromium/policies/managed /etc/chromium-browser/policies/managed /etc/opt/edge/policies/managed; do mkdir -p "$d"; install -m 0644 /tmp/labguard-policy.json "$d/labguard.json"; done \\
      && echo "$NEWV" > /etc/labguard-edu/policy-version && CUR=$NEWV || { STATUS=FAILED; ERR="apply failed"; }
  fi
fi
OS=$( . /etc/os-release 2>/dev/null; echo "\${PRETTY_NAME:-Linux}")
curl -fsS --max-time 20 -H "$AUTH" -H 'Content-Type: application/json' -X POST "$LABGUARD_BASE_URL/api/device-agent/checkin" \\
  -d "{\\"appliedPolicyVersion\\":\\"$CUR\\",\\"status\\":\\"$STATUS\\",\\"error\\":\\"$ERR\\",\\"os\\":\\"$OS\\",\\"browser\\":\\"Chrome/Chromium\\",\\"agentVersion\\":\\"1.0.0\\",\\"hostname\\":\\"$(hostname)\\"}" >/dev/null || true
AGENT
chmod 0755 /usr/local/sbin/labguard-device-agent
cat > /etc/systemd/system/labguard-device-agent.service <<'EOF'
[Unit]
Description=LABGUARD EDU device policy sync
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/labguard-device-agent
EOF
cat > /etc/systemd/system/labguard-device-agent.timer <<'EOF'
[Unit]
Description=LABGUARD EDU device policy sync timer
[Timer]
OnBootSec=30s
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload && systemctl enable --now labguard-device-agent.timer
echo "[LABGUARD] Agen sinkronisasi perangkat aktif (systemctl status labguard-device-agent.timer)."
` : `
# Agen sinkronisasi TIDAK dipasang (installer ini tidak berisi token perangkat).
`}
echo "Pastikan akun peserta didik bukan anggota sudo/admin agar kebijakan tidak dapat diubah."
`;
}
