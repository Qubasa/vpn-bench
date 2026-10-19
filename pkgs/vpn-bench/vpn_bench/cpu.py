import logging
import re
from dataclasses import dataclass
from typing import TypedDict

from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine

from vpn_bench.errors import VpnBenchError
from vpn_bench.remote import ssh_run

log = logging.getLogger(__name__)

# Bash function `snap [unit]`: prints /proc/uptime, the aggregate /proc/stat line and,
# when a systemd unit is given, the usage_usec line of its cgroup cpu.stat.
SNAPSHOT_FUNCTION_SH = """snap() {
  cat /proc/uptime
  head -n 1 /proc/stat
  if [ -n "$1" ]; then
    cg=$(systemctl show --property ControlGroup --value "$1")
    if [ -n "$cg" ]; then
      grep '^usage_usec ' "/sys/fs/cgroup$cg/cpu.stat" 2>/dev/null
    fi
  fi
}
"""

_UPTIME_RE = re.compile(r"^(\d+\.\d+) \d+\.\d+$")


@dataclass(frozen=True)
class CpuSnapshot:
    uptime_seconds: float
    busy_ticks: int
    total_ticks: int
    unit_usage_usec: int | None


class CpuUsageDict(TypedDict):
    window_seconds: float
    host_percent: float  # busy share of all logical CPUs, 0-100
    vpn_process_percent: float | None  # VPN unit cgroup, % of one CPU like top


def parse_cpu_snapshot(lines: list[str]) -> CpuSnapshot:
    """Parse the output of `snap` from SNAPSHOT_FUNCTION_SH."""
    uptime: float | None = None
    stat_fields: list[int] | None = None
    unit_usage_usec: int | None = None
    for line in lines:
        if uptime_match := _UPTIME_RE.match(line):
            uptime = float(uptime_match.group(1))
        elif line.startswith("cpu "):
            # user nice system idle iowait irq softirq steal, guest is part of user
            stat_fields = [int(field) for field in line.split()[1:9]]
        elif line.startswith("usage_usec "):
            unit_usage_usec = int(line.split()[1])
    if uptime is None or stat_fields is None:
        msg = f"Malformed CPU snapshot: {lines!r}"
        raise VpnBenchError(msg)
    total = sum(stat_fields)
    idle = stat_fields[3] + stat_fields[4]
    return CpuSnapshot(
        uptime_seconds=uptime,
        busy_ticks=total - idle,
        total_ticks=total,
        unit_usage_usec=unit_usage_usec,
    )


def take_cpu_snapshot(machine: Machine, unit: str | None) -> CpuSnapshot:
    host = machine.target_host().override(host_key_check="none")
    with host.host_connection() as ssh:
        res = ssh_run(
            ssh,
            ["bash", "-c", SNAPSHOT_FUNCTION_SH + 'snap "$1"', "vpb-cpu", unit or ""],
            RunOpts(log=Log.STDERR),
        )
    return parse_cpu_snapshot(res.stdout.splitlines())


def cpu_usage(before: CpuSnapshot, after: CpuSnapshot) -> CpuUsageDict:
    window = after.uptime_seconds - before.uptime_seconds
    total_ticks = after.total_ticks - before.total_ticks
    if window <= 0 or total_ticks <= 0:
        msg = f"CPU snapshots do not span any time: {before} -> {after}"
        raise VpnBenchError(msg)
    host_percent = 100 * (after.busy_ticks - before.busy_ticks) / total_ticks

    vpn_process_percent: float | None = None
    if before.unit_usage_usec is not None and after.unit_usage_usec is not None:
        used_usec = after.unit_usage_usec - before.unit_usage_usec
        if used_usec < 0:
            log.warning("VPN unit CPU counter went backwards, the unit restarted")
        else:
            vpn_process_percent = 100 * used_usec / 1_000_000 / window

    return {
        "window_seconds": window,
        "host_percent": host_percent,
        "vpn_process_percent": vpn_process_percent,
    }
