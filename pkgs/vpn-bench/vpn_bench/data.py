from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import TypedDict

from clan_lib.async_run import AsyncRuntime
from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine


@dataclass
class BenchMachine:
    cmachine: Machine
    vpn_ip: str


# type Provider = Literal["gcloud", "hetzner"]


class Provider(Enum):
    GCloud = "gcloud"
    Hetzner = "hetzner"
    Chameleon = "chameleon"
    Hardware = "hardware"

    @staticmethod
    def from_str(label: str) -> "Provider":
        if label in Provider._value2member_map_:
            return Provider(Provider._value2member_map_[label])
        msg = f"Unknown provider: {label}"
        raise ValueError(msg)


class TrMachine(TypedDict):
    name: str
    location: str | None
    server_type: str
    ipv4: str | None
    ipv6: str | None
    internal_ipv6: str | None
    provider: Provider


class VPN(Enum):
    Internal = "internal"
    Zerotier = "zerotier"
    Mycelium = "mycelium"
    Hyprspace = "hyprspace"
    Yggdrasil = "yggdrasil"
    VpnCloud = "vpncloud"
    Wireguard = "wireguard"
    Easytier = "easytier"
    Nebula = "nebula"
    Tinc = "tinc"
    Headscale = "headscale"

    @staticmethod
    def from_str(label: str) -> "VPN":
        if label in VPN._value2member_map_:
            return VPN(VPN._value2member_map_[label])
        msg = f"Unknown VPN: {label}"
        raise ValueError(msg)

    def get_state_dirs(self) -> list[str]:
        """Get the state directories for this VPN that need to be cleaned up.

        Returns a list of paths that store persistent state for the VPN.
        """
        match self:
            case VPN.Internal:
                return []
            case VPN.Zerotier:
                return ["/var/lib/zerotier-one", "/etc/zerotier"]
            case VPN.Mycelium:
                return ["/var/lib/mycelium", "/var/lib/private/mycelium/"]
            case VPN.Hyprspace:
                return ["/var/lib/hyprspace"]
            case VPN.Yggdrasil:
                return ["/var/lib/yggdrasil"]
            case VPN.VpnCloud:
                return ["/var/lib/vpncloud"]
            case VPN.Wireguard:
                return []  # Wireguard uses kernel module, no persistent state dirs
            case VPN.Easytier:
                return ["/var/lib/easytier"]
            case VPN.Nebula:
                return ["/var/lib/nebula"]
            case VPN.Tinc:
                return ["/etc/tinc"]
            case VPN.Headscale:
                return ["/var/lib/headscale", "/var/lib/tailscale"]
            case _:
                msg = f"Missing state directories for VPN: {self}"
                raise NotImplementedError(msg)

    @staticmethod
    def get_all_vpn_state_dirs() -> list[str]:
        """Get all unique state directories for all VPN types."""
        all_dirs: set[str] = set()
        for vpn in VPN:
            all_dirs.update(vpn.get_state_dirs())
        return sorted(all_dirs)


class TestType(Enum):
    IPERF3 = "iperf3"
    IPERF3_PARALLEL_TCP = "iperf3-parallel-tcp"
    QPERF = "qperf"
    NIX_CACHE = "nix-cache"
    PING = "ping"
    RIST_STREAM = "rist-stream"

    @staticmethod
    def from_str(label: str) -> "TestType":
        if label in TestType._value2member_map_:
            return TestType(TestType._value2member_map_[label])
        msg = f"Unknown BenchType: {label}"
        raise ValueError(msg)


@dataclass
class TCSettings:
    """Traffic control settings for network conditions simulation."""

    bandwidth_mbit: int | None = None  # Bandwidth limit in Mbit/s
    latency_ms: int | None = None  # Added latency in milliseconds
    jitter_ms: int | None = None  # Jitter (variation) in milliseconds
    packet_loss_percent: float | None = None  # Packet loss percentage (0-100)
    reorder_percent: float | None = None  # Packet reordering percentage (0-100)
    reorder_correlation: float | None = (
        None  # Reordering correlation percentage (0-100)
    )

    def __str__(self) -> str:
        """Generate a human-readable description of TC settings."""
        parts = []
        if self.bandwidth_mbit is not None:
            parts.append(f"bw{self.bandwidth_mbit}mbit")
        if self.latency_ms is not None:
            parts.append(f"lat{self.latency_ms}ms")
        if self.jitter_ms is not None:
            parts.append(f"jit{self.jitter_ms}ms")
        if self.packet_loss_percent is not None:
            parts.append(f"loss{self.packet_loss_percent}pct")
        if self.reorder_percent is not None:
            parts.append(f"reorder{self.reorder_percent}pct")
        return "_".join(parts) if parts else "baseline"

    def to_dict(self) -> dict[str, int | float | None]:
        """Convert TC settings to dictionary for JSON serialization.

        Note: Values are doubled for additive metrics because TC is applied to egress
        on all machines, so the effective end-to-end impairment is 2x the
        configured value (data path + ACK path both get impaired).
        Bandwidth is not doubled as it's a cap per direction.
        """
        return {
            "bandwidth_mbit": self.bandwidth_mbit,
            # Effective values are 2x (applied on both ends)
            "latency_ms": self.latency_ms * 2 if self.latency_ms is not None else None,
            "jitter_ms": self.jitter_ms * 2 if self.jitter_ms is not None else None,
            "packet_loss_percent": self.packet_loss_percent * 2
            if self.packet_loss_percent is not None
            else None,
            "reorder_percent": self.reorder_percent * 2
            if self.reorder_percent is not None
            else None,
            "reorder_correlation": self.reorder_correlation,
        }


@dataclass
class BenchmarkRun:
    """Configuration for a single benchmark run with optional TC settings."""

    alias: str  # Human-readable alias for this benchmark run (e.g., "baseline", "high_latency")
    tc_settings: TCSettings | None = None  # None means no TC applied (baseline)


# Predefined TC profile configurations
class TCProfile(Enum):
    """Predefined traffic control profiles for benchmark runs."""

    BASELINE = "baseline"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

    @staticmethod
    def from_str(label: str) -> "TCProfile":
        if label in TCProfile._value2member_map_:
            return TCProfile(TCProfile._value2member_map_[label])
        msg = f"Unknown TC profile: {label}"
        raise ValueError(msg)

    def to_benchmark_run(self) -> BenchmarkRun:
        """Convert TC profile to BenchmarkRun configuration."""
        match self:
            case TCProfile.BASELINE:
                return BenchmarkRun(alias="baseline", tc_settings=None)
            case TCProfile.LOW:
                return BenchmarkRun(
                    alias="low_impairment",
                    tc_settings=TCSettings(
                        latency_ms=2,
                        jitter_ms=2,
                        packet_loss_percent=0.25,
                        reorder_percent=0.5,
                        reorder_correlation=25.0,
                    ),
                )
            case TCProfile.MEDIUM:
                return BenchmarkRun(
                    alias="medium_impairment",
                    tc_settings=TCSettings(
                        latency_ms=4,
                        jitter_ms=7,
                        packet_loss_percent=1.0,
                        reorder_percent=2.5,
                        reorder_correlation=50.0,
                    ),
                )
            case TCProfile.HIGH:
                return BenchmarkRun(
                    alias="high_impairment",
                    tc_settings=TCSettings(
                        latency_ms=6,
                        jitter_ms=15,
                        packet_loss_percent=2.5,
                        reorder_percent=5.0,
                        reorder_correlation=50.0,
                    ),
                )


def get_benchmark_runs(profiles: list[TCProfile]) -> list[BenchmarkRun]:
    """Convert list of TC profiles to list of BenchmarkRun configurations."""
    return [profile.to_benchmark_run() for profile in profiles]


@dataclass
class SSHKeyPair:
    private: Path
    public: Path


@dataclass
class Config:
    debug: bool
    data_dir: Path
    cache_dir: Path
    tr_dir: Path
    clan_dir: Path
    bench_dir: Path
    ssh_keys: list[SSHKeyPair]

    def get_hardware_metadata_path(self) -> Path:
        """Get the path to the hardware machines metadata file."""
        return self.data_dir / "hardware_machines.json"


def _delete_dir(machine: Machine, state_dirs: list[str]) -> None:
    host = machine.target_host().override(host_key_check="none")
    with host.host_connection() as ssh:
        ssh.run(
            ["rm", "-rf", *state_dirs],
            RunOpts(log=Log.BOTH),
        )


def delete_dirs(state_dirs: list[str], machines: list[Machine]) -> None:
    with AsyncRuntime() as runtime:
        for machine in machines:
            runtime.async_run(None, _delete_dir, machine, state_dirs)
        runtime.join_all()
        runtime.check_all()
