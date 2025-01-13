from pathlib import Path
from typing import Literal
from vpn_bench import Provider


def get_asset(provider: Provider, asset_name: str) -> Path:
    curr = Path(__file__).parent
    asset = curr / provider.value / asset_name
    if not asset.exists():
        msg = f"{asset} does not exist"
        raise ValueError(msg)
    return asset
