from dataclasses import dataclass, field
from pathlib import Path
from typing import List


@dataclass
class Config:
    debug: bool
    data_dir: Path
    machines: List[str] = field(
        default_factory=lambda: ["jon", "sara", "bob", "eva", "zula"]
    )
