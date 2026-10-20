import tomllib
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import TypedDict

from clan_lib.async_run import AsyncRuntime
from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine

from vpn_bench.remote import machine_connection, ssh_run


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
    Tincr = "tincr"
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
            case VPN.Tincr:
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


JITTER_DISTRIBUTION = "normal"


@dataclass(frozen=True)
class TCSettings:
    """Per-direction network impairment, applied to the traffic each machine receives.

    A round trip crosses two impaired directions, so it gains twice the delay.
    """

    latency_ms: float | None = None
    jitter_ms: float | None = None
    packet_loss_percent: float | None = None
    bandwidth_mbit: int | None = None

    def __post_init__(self) -> None:
        if self.jitter_ms is not None and (
            self.latency_ms is None or self.jitter_ms > self.latency_ms
        ):
            msg = (
                f"Jitter ({self.jitter_ms} ms) exceeds the delay ({self.latency_ms} ms)"
            )
            raise ValueError(msg)

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
        return "_".join(parts) if parts else "baseline"

    @property
    def added_rtt_ms(self) -> float | None:
        """Round-trip time added by the delay of both directions."""
        return 2 * self.latency_ms if self.latency_ms is not None else None

    def to_dict(self) -> dict[str, float | str | None]:
        """Convert the per-direction values to a dictionary for JSON serialization."""
        return {
            "latency_ms": self.latency_ms,
            "jitter_ms": self.jitter_ms,
            "jitter_distribution": JITTER_DISTRIBUTION
            if self.jitter_ms is not None
            else None,
            "packet_loss_percent": self.packet_loss_percent,
            "added_rtt_ms": self.added_rtt_ms,
            "bandwidth_mbit": self.bandwidth_mbit,
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
                        latency_ms=2.5, jitter_ms=0.625, packet_loss_percent=0.01
                    ),
                )
            case TCProfile.MEDIUM:
                return BenchmarkRun(
                    alias="medium_impairment",
                    tc_settings=TCSettings(
                        latency_ms=10, jitter_ms=2.5, packet_loss_percent=0.01
                    ),
                )
            case TCProfile.HIGH:
                return BenchmarkRun(
                    alias="high_impairment",
                    tc_settings=TCSettings(
                        latency_ms=20, jitter_ms=5, packet_loss_percent=0.05
                    ),
                )


def get_benchmark_runs(profiles: list[TCProfile]) -> list[BenchmarkRun]:
    """Convert list of TC profiles to list of BenchmarkRun configurations."""
    return [profile.to_benchmark_run() for profile in profiles]


@dataclass
class ProfileConfig:
    """Per-profile configuration overrides."""

    name: str  # Must match a TCProfile value
    tests: list[TestType] | None = None  # If None, use parent's tests
    skip_con_times: bool | None = None  # If None, use parent's value


@dataclass
class BenchmarkEntry:
    """Configuration for a single VPN benchmark with its tests and settings."""

    vpn: "VPN"
    tests: list[TestType] = field(default_factory=list)
    tc_profiles: list[TCProfile] = field(default_factory=lambda: [TCProfile.BASELINE])
    skip_con_times: bool = False
    profile_overrides: dict[str, ProfileConfig] = field(default_factory=dict)

    def get_benchmark_runs(self) -> list[BenchmarkRun]:
        """Convert tc_profiles to BenchmarkRun configurations."""
        return get_benchmark_runs(self.tc_profiles)

    def get_tests_for_profile(self, profile: TCProfile) -> list[TestType]:
        """Get tests for a specific profile, applying overrides if present."""
        override = self.profile_overrides.get(profile.value)
        if override and override.tests is not None:
            return override.tests
        return self.tests

    def get_skip_con_times_for_profile(self, profile: TCProfile) -> bool:
        """Get skip_con_times for a specific profile, applying overrides if present."""
        override = self.profile_overrides.get(profile.value)
        if override and override.skip_con_times is not None:
            return override.skip_con_times
        return self.skip_con_times


def parse_benchmark_config(config_path: Path) -> list["BenchmarkEntry"]:
    """Parse a TOML configuration file for benchmark settings.

    Expected format:
        [[benchmark]]
        vpn = "wireguard"
        tests = ["ping", "iperf3"]
        tc_profiles = ["baseline", "low", "high"]
        skip_con_times = false

        # Optional per-profile overrides
        [[benchmark.profile]]
        name = "high"
        tests = ["iperf3", "rist-stream"]  # Override tests for this profile
        skip_con_times = true  # Override skip_con_times for this profile

    Args:
        config_path: Path to the TOML configuration file

    Returns:
        List of BenchmarkEntry objects
    """
    with config_path.open("rb") as f:
        data = tomllib.load(f)

    entries: list[BenchmarkEntry] = []
    for item in data.get("benchmark", []):
        vpn = VPN.from_str(item["vpn"])
        tests = [TestType.from_str(t) for t in item.get("tests", [])]
        tc_profiles_raw = item.get("tc_profiles", ["baseline"])
        tc_profiles = [TCProfile.from_str(p) for p in tc_profiles_raw]
        skip_con_times = item.get("skip_con_times", False)

        # Parse per-profile overrides
        profile_overrides: dict[str, ProfileConfig] = {}
        for profile_item in item.get("profile", []):
            profile_name = profile_item["name"]
            # Validate profile name matches one of the tc_profiles
            if profile_name not in [p.value for p in tc_profiles]:
                msg = (
                    f"Profile override '{profile_name}' not in tc_profiles "
                    f"{[p.value for p in tc_profiles]} for VPN {vpn.value}"
                )
                raise ValueError(msg)

            profile_tests: list[TestType] | None = None
            if "tests" in profile_item:
                profile_tests = [TestType.from_str(t) for t in profile_item["tests"]]

            profile_skip_con_times: bool | None = None
            if "skip_con_times" in profile_item:
                profile_skip_con_times = profile_item["skip_con_times"]

            profile_overrides[profile_name] = ProfileConfig(
                name=profile_name,
                tests=profile_tests,
                skip_con_times=profile_skip_con_times,
            )

        entries.append(
            BenchmarkEntry(
                vpn=vpn,
                tests=tests,
                tc_profiles=tc_profiles,
                skip_con_times=skip_con_times,
                profile_overrides=profile_overrides,
            )
        )
    return entries


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
    no_sandbox: bool = False

    def get_hardware_metadata_path(self) -> Path:
        """Get the path to the hardware machines metadata file."""
        return self.data_dir / "hardware_machines.json"


def _delete_dir(machine: Machine, state_dirs: list[str]) -> None:
    ssh_run(
        machine_connection(machine),
        ["rm", "-rf", *state_dirs],
        RunOpts(log=Log.BOTH),
    )


def delete_dirs(state_dirs: list[str], machines: list[Machine]) -> None:
    with AsyncRuntime() as runtime:
        for machine in machines:
            runtime.async_run(None, _delete_dir, machine, state_dirs)
        runtime.join_all()
        runtime.check_all()
