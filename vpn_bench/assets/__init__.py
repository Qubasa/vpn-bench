from pathlib import Path


def get_asset(asset_name: str) -> Path:
    curr = Path(__file__).parent
    return curr / asset_name
