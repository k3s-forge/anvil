#!/bin/sh
# ============================================================================
# anvil/collect.sh — lightweight system info gatherer
# Usage: curl -s https://k3s-forge.github.io/anvil/collect.sh | sh
# Output: JSON on stdout (status on stderr)
# ============================================================================
set -e
exec 3>&2 2>/dev/null

_json_esc() { sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/$/\\n/' | tr -d '\n' | sed 's/\\n$//'; }

OS="unknown"; OS_PRETTY="unknown"; PKG_MGR=""; IS_LINUX=0
if [ -f /etc/os-release ]; then
  . /etc/os-release 2>/dev/null || true
  OS="linux"; OS_PRETTY="${PRETTY_NAME:-Linux}"; IS_LINUX=1
  command -v apt-get >/dev/null 2>&1 && PKG_MGR="apt-get" || true
  command -v dnf     >/dev/null 2>&1 && PKG_MGR="dnf"     || true
  command -v yum     >/dev/null 2>&1 && PKG_MGR="yum"     || true
  command -v apk     >/dev/null 2>&1 && PKG_MGR="apk"     || true
elif [ "$(uname -s)" = "FreeBSD" ]; then
  OS="freebsd"
  OS_PRETTY="FreeBSD $(freebsd-version 2>/dev/null || uname -r)"
  PKG_MGR="pkg"
fi

HN=$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || echo "unknown")
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
KERNEL=$(uname -sr)

TZ="UTC"
if [ "$IS_LINUX" -eq 1 ] && command -v timedatectl >/dev/null 2>&1; then
  TZ=$(timedatectl show -p Timezone --value 2>/dev/null || echo "UTC")
elif [ -f /etc/localtime ]; then
  TZ=$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || echo "UTC")
fi

BEST_IFACE=""; BEST_IP=""; BEST_GW=""; NET_TYPE="dhcp"
if [ "$IS_LINUX" -eq 1 ]; then
  BEST_IFACE=$(ip -o link show 2>/dev/null | awk -F': ' '/state UP/ && !/lo/{print $2; exit}')
  if [ -n "$BEST_IFACE" ]; then
    BEST_IP=$(ip -4 addr show "$BEST_IFACE" 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
    BEST_GW=$(ip route show default 2>/dev/null | awk '/default via/{print $3; exit}')
  fi
else
  BEST_IFACE=$(ifconfig -l ether 2>/dev/null | awk '{print $1}')
  if [ -n "$BEST_IFACE" ]; then
    BEST_IP=$(ifconfig "$BEST_IFACE" 2>/dev/null | awk '/inet /{print $2; exit}')
    BEST_GW=$(netstat -rn 2>/dev/null | awk '/^default/{print $2; exit}')
  fi
fi
if [ -n "$BEST_IP" ] && [ -n "$BEST_GW" ]; then NET_TYPE="static"; fi

MEM_MB=0
if [ "$IS_LINUX" -eq 1 ]; then
  MEM_MB=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
else
  MEM_MB=$(sysctl -n hw.physmem 2>/dev/null | awk '{printf "%d", $1/1024/1024}' || echo 0)
fi

DISK_GB=0
if [ "$IS_LINUX" -eq 1 ]; then
  DISK_GB=$(df -BG / 2>/dev/null | awk 'NR==2{print $2}' | tr -d 'G' || echo 0)
else
  DISK_GB=$(df -g / 2>/dev/null | awk 'NR==2{print $2}' || echo 0)
fi

NOMAD_VER=""
command -v nomad >/dev/null 2>&1 && NOMAD_VER=$(nomad version 2>/dev/null | head -1 | grep -o 'v[0-9.]*' || echo "installed") || true

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
  "pkg_mgr": "$PKG_MGR",
  "nomad_installed": $(if [ -n "$NOMAD_VER" ]; then echo "true"; else echo "false"; fi),
  "nomad_version": "$NOMAD_VER"
}
JSON
