from pathlib import Path

from vpn_bench.data import Provider


def get_cloud_asset(provider: Provider, asset_name: str) -> Path:
    curr = Path(__file__).parent
    asset = curr / provider.value / asset_name
    if not asset.exists():
        msg = f"{asset} does not exist"
        raise ValueError(msg)
    return asset


def get_script_asset(asset_name: str) -> Path:
    curr = Path(__file__).parent
    asset = curr / "scripts" / asset_name
    if not asset.exists():
        msg = f"{asset} does not exist"
        raise ValueError(msg)
    return asset


def get_iperf_asset(asset_name: str) -> Path:
    curr = Path(__file__).parent
    asset = curr / "iperf3" / asset_name
    if not asset.exists():
        msg = f"{asset} does not exist"
        raise ValueError(msg)
    return asset
