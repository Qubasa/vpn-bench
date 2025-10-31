import concurrent
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import TypedDict

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

    @staticmethod
    def from_str(label: str) -> "VPN":
        if label in VPN._value2member_map_:
            return VPN(VPN._value2member_map_[label])
        msg = f"Unknown VPN: {label}"
        raise ValueError(msg)


class TestType(Enum):
    IPERF3 = "iperf3"
    QPERF = "qperf"
    NIX_CACHE = "nix-cache"

    @staticmethod
    def from_str(label: str) -> "TestType":
        if label in TestType._value2member_map_:
            return TestType(TestType._value2member_map_[label])
        msg = f"Unknown BenchType: {label}"
        raise ValueError(msg)


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


def _delete_dir(machine: Machine, state_dirs: list[str]) -> None:
    host = machine.target_host().override(host_key_check="none")
    with host.host_connection() as ssh:
        ssh.run(
            ["rm", "-rf", *state_dirs],
            RunOpts(log=Log.BOTH),
        )


def delete_dirs(state_dirs: list[str], machines: list[Machine]) -> None:
    with ThreadPoolExecutor() as executor:
        futures = []
        for _index, machine in enumerate(machines):
            future = executor.submit(_delete_dir, machine, state_dirs)
            futures.append(future)
        concurrent.futures.wait(futures)

        done, not_done = concurrent.futures.wait(futures)

        for future in done:
            exc = future.exception()
            if exc is not None:
                raise exc
