from dataclasses import dataclass, field
from pathlib import Path
from typing import List
from enum import Enum


class Provider(Enum):
    GCloud = "gcloud"

    @staticmethod
    def from_str(label: str) -> "Provider":
        if label in Provider._value2member_map_:
            return Provider._value2member_map_[label]
        else:
            raise ValueError(f"Unknown provider: {label}")


@dataclass
class Config:
    debug: bool
    data_dir: Path
    tr_dir: Path
    clan_dir: Path
