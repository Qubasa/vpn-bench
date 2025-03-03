from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import TypedDict


class TrMachine(TypedDict):
    name: str
    location: str
    server_type: str
    ipv4: str | None


class Provider(Enum):
    GCloud = "gcloud"
    Hetzner = "hetzner"

    @staticmethod
    def from_str(label: str) -> "Provider":
        if label in Provider._value2member_map_:
            return Provider(Provider._value2member_map_[label])
        msg = f"Unknown provider: {label}"
        raise ValueError(msg)


class VPN(Enum):
    External = "external"
    Internal = "internal"
    Zerotier = "zerotier"
    Mycelium = "mycelium"

    @staticmethod
    def from_str(label: str) -> "VPN":
        if label in VPN._value2member_map_:
            return VPN(VPN._value2member_map_[label])
        msg = f"Unknown VPN: {label}"
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
