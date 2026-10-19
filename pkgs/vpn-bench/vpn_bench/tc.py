"""Receiver-side network impairment with tc netem on an ifb device.

Each machine redirects the traffic arriving on its primary interface to an ifb
device whose root qdisc is netem. GRO is off while a profile is active, so
netem delays and drops single wire packets instead of merged batches.
"""

import logging
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from typing import Any

from clan_lib.async_run import AsyncFuture, AsyncRuntime
from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine
from clan_lib.ssh.remote import Remote

from vpn_bench.data import JITTER_DISTRIBUTION, TCSettings
from vpn_bench.errors import VpnBenchError
from vpn_bench.remote import ssh_run

log = logging.getLogger(__name__)

IMPAIRMENT_METHOD = "receiver-ifb"
GRO_DURING_PROFILE = "off"
IFB_DEVICE = "vpbifb0"
INGRESS_HANDLE = "ffff:"
NETEM_QUEUE_LIMIT = 100_000
FALLBACK_LINK_SPEED_MBIT = 1000


@dataclass(frozen=True)
class MachineImpairment:
    """Impairment state applied to one machine."""

    interface: str
    ifb: str
    rate_mbit: int
    gro_before: str
    netem_args: str


@dataclass(frozen=True)
class AppliedImpairment:
    """Impairment applied to all machines of a profile run."""

    settings: TCSettings
    machines: dict[str, MachineImpairment]

    def to_dict(self) -> dict[str, Any]:
        """Build the settings record stored in tc_settings.json."""
        return {
            "method": IMPAIRMENT_METHOD,
            **self.settings.to_dict(),
            "gro_during_profile": GRO_DURING_PROFILE,
            "machines": {name: asdict(m) for name, m in self.machines.items()},
        }


def _format_number(value: float) -> str:
    return f"{value:g}"


def netem_rate_mbit(settings: TCSettings, link_speed_mbit: int) -> int:
    """Return the netem rate, the link speed capped by the profile's bandwidth."""
    if settings.bandwidth_mbit is None:
        return link_speed_mbit
    return min(settings.bandwidth_mbit, link_speed_mbit)


def netem_args(settings: TCSettings, rate_mbit: int) -> str:
    """Build the netem argument string for the ifb root qdisc.

    The rate makes netem send packets in order, so jitter cannot reorder them.
    """
    args: list[str] = []
    if settings.latency_ms is not None:
        args += ["delay", f"{_format_number(settings.latency_ms)}ms"]
        if settings.jitter_ms is not None:
            args += [
                f"{_format_number(settings.jitter_ms)}ms",
                "distribution",
                JITTER_DISTRIBUTION,
            ]
    if settings.packet_loss_percent is not None:
        args += ["loss", f"{_format_number(settings.packet_loss_percent)}%"]
    args += ["rate", f"{rate_mbit}mbit", "limit", str(NETEM_QUEUE_LIMIT)]
    return " ".join(args)


def _quiet() -> RunOpts:
    return RunOpts(log=Log.NONE, check=False)


def _gro_state_file(interface: str) -> str:
    return f"/run/vpb-gro-before-{interface}"


def _primary_interface(ssh: Remote) -> str:
    result = ssh_run(ssh, ["ip", "route", "show", "default"], RunOpts(log=Log.BOTH))
    parts = result.stdout.split()
    if "dev" in parts:
        dev_idx = parts.index("dev")
        if dev_idx + 1 < len(parts):
            return parts[dev_idx + 1]
    return "eth0"


def _read_gro(ssh: Remote, interface: str) -> str:
    result = ssh_run(ssh, ["ethtool", "-k", interface], RunOpts(log=Log.STDERR))
    for line in result.stdout.splitlines():
        key, _, value = line.partition(":")
        if key.strip() == "generic-receive-offload" and value.split():
            return value.split()[0]
    msg = f"ethtool -k {interface} reports no generic-receive-offload state"
    raise VpnBenchError(msg)


def _read_link_speed_mbit(ssh: Remote, interface: str) -> int:
    result = ssh_run(ssh, ["cat", f"/sys/class/net/{interface}/speed"], _quiet())
    try:
        speed = int(result.stdout.strip())
    except ValueError:
        return FALLBACK_LINK_SPEED_MBIT
    return speed if speed > 0 else FALLBACK_LINK_SPEED_MBIT


def _clear_impairment(ssh: Remote, interface: str) -> None:
    """Remove the ingress redirect and the ifb device, and restore GRO.

    Absent objects are skipped, so this also brings a clean machine to a clean state.
    """
    ingress = ssh_run(
        ssh, ["tc", "qdisc", "show", "dev", interface, "ingress"], _quiet()
    )
    if ingress.stdout.strip():
        ssh_run(
            ssh,
            ["tc", "qdisc", "del", "dev", interface, "ingress"],
            RunOpts(log=Log.BOTH),
        )
    if (
        ssh_run(ssh, ["ip", "link", "show", "dev", IFB_DEVICE], _quiet()).returncode
        == 0
    ):
        ssh_run(ssh, ["ip", "link", "del", "dev", IFB_DEVICE], RunOpts(log=Log.BOTH))
    state_file = _gro_state_file(interface)
    gro_before = ssh_run(ssh, ["cat", state_file], _quiet())
    if gro_before.returncode == 0 and gro_before.stdout.strip():
        ssh_run(
            ssh,
            ["ethtool", "-K", interface, "gro", gro_before.stdout.strip()],
            RunOpts(log=Log.BOTH),
        )
        ssh_run(ssh, ["rm", "-f", state_file], RunOpts(log=Log.BOTH))


def _apply_to_machine(machine: Machine, settings: TCSettings) -> MachineImpairment:
    host = machine.target_host().override(host_key_check="none")
    with host.host_connection() as ssh:
        interface = _primary_interface(ssh)
        _clear_impairment(ssh, interface)
        gro_before = _read_gro(ssh, interface)
        rate_mbit = netem_rate_mbit(settings, _read_link_speed_mbit(ssh, interface))
        args = netem_args(settings, rate_mbit)
        log.info(
            f"{machine.name}: netem on ingress of {interface} via {IFB_DEVICE}: {args}"
        )
        state_file = _gro_state_file(interface)
        ssh_run(
            ssh,
            ["sh", "-c", 'printf "%s\\n" "$1" > "$2"', "sh", gro_before, state_file],
            RunOpts(log=Log.BOTH),
        )
        commands = [
            "modprobe ifb numifbs=0",
            f"ip link add {IFB_DEVICE} type ifb",
            f"ip link set dev {IFB_DEVICE} up",
            f"tc qdisc add dev {IFB_DEVICE} root netem {args}",
            f"tc qdisc add dev {interface} handle {INGRESS_HANDLE} ingress",
            f"tc filter add dev {interface} parent {INGRESS_HANDLE} matchall"
            f" action mirred egress redirect dev {IFB_DEVICE}",
            f"ethtool -K {interface} gro {GRO_DURING_PROFILE}",
        ]
        for command in commands:
            ssh_run(ssh, command.split(), RunOpts(log=Log.BOTH))
        ssh_run(ssh, ["tc", "qdisc", "show", "dev", IFB_DEVICE], RunOpts(log=Log.BOTH))
    return MachineImpairment(
        interface=interface,
        ifb=IFB_DEVICE,
        rate_mbit=rate_mbit,
        gro_before=gro_before,
        netem_args=args,
    )


def _clear_machine(machine: Machine) -> None:
    host = machine.target_host().override(host_key_check="none")
    with host.host_connection() as ssh:
        interface = _primary_interface(ssh)
        log.info(f"{machine.name}: clearing impairment on {interface}")
        _clear_impairment(ssh, interface)


def _apply_to_all(
    machines: list[Machine], settings: TCSettings
) -> dict[str, MachineImpairment]:
    log.info(f"Applying impairment {settings} to {len(machines)} machines")
    with AsyncRuntime() as runtime:
        futures: dict[str, AsyncFuture[MachineImpairment]] = {
            machine.name: runtime.async_run(None, _apply_to_machine, machine, settings)
            for machine in machines
        }
        runtime.join_all()
        runtime.check_all()
        return {name: future.wait().result for name, future in futures.items()}


def clear_tc_settings(machines: list[Machine]) -> None:
    """Remove the impairment from all machines in parallel and restore their GRO state.

    Args:
        machines: Machines to clear.
    """
    log.info(f"Clearing impairment from {len(machines)} machines")
    with AsyncRuntime() as runtime:
        for machine in machines:
            runtime.async_run(None, _clear_machine, machine)
        runtime.join_all()
        runtime.check_all()


@contextmanager
def apply_tc_settings(
    machines: list[Machine], settings: TCSettings | None
) -> Generator[AppliedImpairment | None]:
    """Apply an impairment profile for the duration of the with-block.

    Every machine is cleared before and after the block, also for the Baseline
    (settings None) and when the block raises.

    Args:
        machines: Machines to impair.
        settings: Per-direction impairment, None for the Baseline.

    Yields:
        The applied impairment per machine, None for the Baseline.
    """
    try:
        if settings is None:
            clear_tc_settings(machines)
            yield None
        else:
            yield AppliedImpairment(settings, _apply_to_all(machines, settings))
    finally:
        clear_tc_settings(machines)
