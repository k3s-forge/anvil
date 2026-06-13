#!/bin/sh
# ============================================================================
# anvil/collect.sh — FreeBSD system info gatherer
# Usage: curl -s https://k3s-forge.github.io/anvil/collect.sh | sh
# Output: JSON on stdout (status on stderr)
# ============================================================================
set -e
exec 3>&2 2>/dev/null

# ── Utilities ──────────────────────────────────────────────

_json_esc() { sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/$/\\n/' | tr -d '\n' | sed 's/\\n$//'; }

sluggish() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9-][^a-z0-9-]*/-/g; s/-\{2,\}/-/g; s/^-\+//; s/-\+$//' \
    | sed 's/^\(.\{63\}\).*/\1/' | sed 's/-$//'
}

rand8() {
  local out
  out=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom 2>/dev/null | head -c 8 || true)
  if [ -z "$out" ] || [ ${#out} -lt 8 ]; then out="12345678"; fi
  printf '%s' "$out"
}

region_code() {
  local c="$1" n="$2"
  case "$c" in
    us)
      case "$n" in california|los-angeles|la|san-francisco|sf|ca) echo "ca"; return ;; esac
      case "$n" in *new-york*|*newyork*|nyc|ny) echo "ny"; return ;; esac ;;
    cn)
      case "$n" in *beijing*|*bei-jing*|bj) echo "bj"; return ;; esac
      case "$n" in *shanghai*|*shang-hai*|sh) echo "sh"; return ;; esac ;;
    jp)
      case "$n" in *tokyo*|tyo|tokyo-to) echo "13"; return ;; esac ;;
    gb)
      case "$n" in *london*|ldn|england) echo "lon"; return ;; esac ;;
  esac
  echo ""
}

# ── OS ─────────────────────────────────────────────────────

OS="freebsd"
OS_PRETTY="FreeBSD $(freebsd-version 2>/dev/null || uname -r)"
PKG_MGR="pkg"

HN=$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || echo "unknown")
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
KERNEL=$(uname -sr)

TZ="UTC"
if [ -f /etc/localtime ]; then
  TZ=$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || echo "UTC")
fi

# ── Network ─────────────────────────────────────────────────

BEST_IFACE=""; BEST_IP=""; BEST_GW=""; NET_TYPE="dhcp"
BEST_IFACE=$(ifconfig -l ether 2>/dev/null | awk '{print $1}')
if [ -n "$BEST_IFACE" ]; then
  BEST_IP=$(ifconfig "$BEST_IFACE" 2>/dev/null | awk '/inet /{print $2; exit}')
  BEST_GW=$(netstat -rn 2>/dev/null | awk '/^default/{print $2; exit}')
fi
if [ -n "$BEST_IP" ] && [ -n "$BEST_GW" ]; then NET_TYPE="static"; fi

# ── Hardware ────────────────────────────────────────────────

MEM_MB=$(sysctl -n hw.physmem 2>/dev/null | awk '{printf "%d", $1/1024/1024}' || echo 0)
DISK_GB=$(df -g / 2>/dev/null | awk 'NR==2{print $2}' || echo 0)
DISK_TYPE="unknown"
CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo 0)
VIRT_TYPE="none"
VT=$(sysctl -n hw.vmm.vcpu_count 2>/dev/null || true)
if [ -n "$VT" ] && [ "$VT" -gt 0 ] 2>/dev/null; then VIRT_TYPE="vm"; fi

NOMAD_VER=""
command -v nomad >/dev/null 2>&1 && NOMAD_VER=$(nomad version 2>/dev/null | head -1 | grep -o 'v[0-9.]*' || echo "installed") || true

# ── Geo-IP ──────────────────────────────────────────────────

COUNTRY_ISO="xx"; REGION_NAME="unknown"
if command -v curl >/dev/null 2>&1; then
  GEO=$(curl -4s --connect-timeout 3 https://ifconfig.co/json 2>/dev/null || true)
  if [ -z "$GEO" ]; then
    GEO=$(curl -4s --connect-timeout 3 https://api.ipapi.is 2>/dev/null || true)
  fi

  if [ -n "$GEO" ]; then
    C=$(printf '%s' "$GEO" | sed -n 's/.*"country_iso"[[:space:]]*:[[:space:]]*"\([A-Z][A-Z]\)".*/\1/p; t; s/.*"country_code"[[:space:]]*:[[:space:]]*"\([A-Z][A-Z]\)".*/\1/p' | head -1)
    R=$(printf '%s' "$GEO" | sed -n 's/.*"region_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p; t; s/.*"region"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    if [ -n "$C" ]; then COUNTRY_ISO=$(printf '%s' "$C" | tr '[:upper:]' '[:lower:]'); fi
    if [ -n "$R" ]; then REGION_NAME=$(sluggish "$R"); fi
  fi
fi
if [ ! "$COUNTRY_ISO" = "$(printf '%s' "$COUNTRY_ISO" | sed 's/^[a-z][a-z]$//')" ]; then COUNTRY_ISO="xx"; fi
RC=$(region_code "$COUNTRY_ISO" "$REGION_NAME")
if [ -n "$RC" ]; then REGION_NAME="$RC"; fi
[ -z "$REGION_NAME" ] && REGION_NAME="unknown"

# ── Network type probe ──────────────────────────────────────

FINAL_TYPE="v4"
HAS_V4=0; HAS_V6=0; IS_CGNAT=0

if command -v curl >/dev/null 2>&1; then
  curl -4s --connect-timeout 3 https://api.ipify.org >/dev/null 2>&1 && HAS_V4=1 || true
  curl -6s --connect-timeout 3 https://api64.ipify.org >/dev/null 2>&1 && HAS_V6=1 || true
fi

if [ "$HAS_V4" -eq 1 ] && [ -n "$BEST_IP" ]; then
  case "$BEST_IP" in
    100.[6-9][0-9].*|100.1[0-2][0-9].*|10.*|192.0.0.*|198.1[89].*) IS_CGNAT=1 ;;
  esac
fi

if [ "$HAS_V4" -eq 1 ] && [ "$HAS_V6" -eq 1 ]; then FINAL_TYPE="dual"
elif [ "$HAS_V6" -eq 1 ]; then FINAL_TYPE="v6"
elif [ "$HAS_V4" -eq 1 ] && [ "$IS_CGNAT" -eq 1 ]; then FINAL_TYPE="dual-cgnat4"
elif [ "$HAS_V4" -eq 1 ]; then FINAL_TYPE="v4"
else FINAL_TYPE="unknown"
fi

# ── Auto hostname ───────────────────────────────────────────

R8=$(rand8)
AUTO_FQDN="${COUNTRY_ISO}.${REGION_NAME}.${FINAL_TYPE}.${R8}"
if [ ${#AUTO_FQDN} -gt 253 ]; then
  OVER=$(( ${#AUTO_FQDN} - 253 ))
  if [ "$OVER" -gt 0 ] && [ ${#REGION_NAME} -gt "$OVER" ]; then
    REGION_NAME=$(printf '%s' "$REGION_NAME" | head -c $(( ${#REGION_NAME} - OVER )) | sed 's/-$//')
  fi
  AUTO_FQDN="${COUNTRY_ISO}.${REGION_NAME}.${FINAL_TYPE}.${R8}"
fi
AUTO_HOSTNAME=$(printf '%s' "$AUTO_FQDN" | tr '.' '-' | sed 's/^\(.\{63\}\).*/\1/' | sed 's/-$//')

# ── Output ──────────────────────────────────────────────────

exec 2>&3

cat <<JSON
{
  "hostname": "$(echo "$HN" | _json_esc)",
  "os": "$OS",
  "os_pretty": "$(echo "$OS_PRETTY" | _json_esc)",
  "kernel": "$(echo "$KERNEL" | _json_esc)",
  "arch": "$ARCH",
  "timezone": "$(echo "$TZ" | _json_esc)",
  "best_iface": "$BEST_IFACE",
  "best_ip": "$BEST_IP",
  "best_gateway": "$BEST_GW",
  "network_type": "$NET_TYPE",
  "mem_mb": $MEM_MB,
  "disk_gb": $DISK_GB,
  "disk_type": "$DISK_TYPE",
  "cpu_cores": $CPU_CORES,
  "virt_type": "$VIRT_TYPE",
  "pkg_mgr": "$PKG_MGR",
  "nomad_installed": $(if [ -n "$NOMAD_VER" ]; then echo "true"; else echo "false"; fi),
  "nomad_version": "$NOMAD_VER",
  "country_iso": "$COUNTRY_ISO",
  "region_name": "$(echo "$REGION_NAME" | _json_esc)",
  "final_type": "$FINAL_TYPE",
  "auto_fqdn": "$AUTO_FQDN",
  "auto_hostname": "$AUTO_HOSTNAME",
  "has_ipv4": $(if [ "$HAS_V4" -eq 1 ]; then echo "true"; else echo "false"; fi),
  "has_ipv6": $(if [ "$HAS_V6" -eq 1 ]; then echo "true"; else echo "false"; fi),
  "is_cgnat": $(if [ "$IS_CGNAT" -eq 1 ]; then echo "true"; else echo "false"; fi)
}
JSON
