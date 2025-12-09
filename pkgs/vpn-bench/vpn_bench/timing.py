"""Hierarchical timing instrumentation for benchmark execution."""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class OperationTiming:
    """Single operation timing record."""

    name: str
    duration_seconds: float
    start_timestamp: float  # Unix timestamp for ordering
    success: bool = True
    error_message: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "name": self.name,
            "duration_seconds": self.duration_seconds,
            "start_timestamp": self.start_timestamp,
            "success": self.success,
        }
        if self.error_message is not None:
            result["error_message"] = self.error_message
        if self.metadata:
            result["metadata"] = self.metadata
        return result


@dataclass
class PhaseTiming:
    """Phase-level timing with nested operations."""

    phase: str
    duration_seconds: float
    start_timestamp: float
    operations: list[OperationTiming] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "phase": self.phase,
            "duration_seconds": self.duration_seconds,
            "start_timestamp": self.start_timestamp,
            "operations": [op.to_dict() for op in self.operations],
        }
        if self.metadata:
            result["metadata"] = self.metadata
        return result


@dataclass
class TimingBreakdown:
    """Complete timing breakdown for a benchmark run."""

    vpn_name: str
    total_duration_seconds: float
    start_timestamp: float
    end_timestamp: float
    phases: list[PhaseTiming] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "vpn_name": self.vpn_name,
            "total_duration_seconds": self.total_duration_seconds,
            "start_timestamp": self.start_timestamp,
            "end_timestamp": self.end_timestamp,
            "phases": [p.to_dict() for p in self.phases],
        }

    def save(self, path: Path) -> None:
        """Save timing breakdown to JSON file."""
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w") as f:
            json.dump(self.to_dict(), f, indent=2)


class TimingTracker:
    """Hierarchical timing tracker with context manager support.

    Usage:
        tracker = TimingTracker(
            vpn_name="Zerotier",
            on_operation_complete=lambda name, dur: print(f"{name}: {dur}s"),
        )

        with tracker.phase("vpn_installation"):
            with tracker.operation("nix_flake_update"):
                # ... do work ...
                pass

            with tracker.operation("deploy_machines"):
                # ... do work ...
                pass

        breakdown = tracker.finalize()
        breakdown.save(Path("timing_breakdown.json"))
    """

    def __init__(
        self,
        vpn_name: str,
        on_operation_start: Callable[[str], None] | None = None,
        on_operation_complete: Callable[[str, float], None] | None = None,
    ) -> None:
        """Initialize timing tracker.

        Args:
            vpn_name: Name of the VPN being benchmarked
            on_operation_start: Callback when an operation starts (for TUI)
            on_operation_complete: Callback when an operation completes (for TUI)
        """
        self.vpn_name = vpn_name
        self._on_operation_start = on_operation_start
        self._on_operation_complete = on_operation_complete

        self._start_time: float = time.monotonic()
        self._start_timestamp: float = time.time()

        self._phases: list[PhaseTiming] = []
        self._current_phase: PhaseTiming | None = None

    @contextmanager
    def phase(self, name: str, **metadata: Any) -> Iterator[PhaseTiming]:
        """Context manager for timing a phase.

        Args:
            name: Phase name (e.g., "vpn_installation", "benchmarking")
            **metadata: Additional metadata to store with the phase

        Yields:
            PhaseTiming object that can be used to add metadata
        """
        phase_start = time.monotonic()
        phase_timestamp = time.time()
        phase_timing = PhaseTiming(
            phase=name,
            duration_seconds=0.0,
            start_timestamp=phase_timestamp,
            metadata=dict(metadata),
        )
        self._current_phase = phase_timing

        try:
            yield phase_timing
        finally:
            phase_timing.duration_seconds = time.monotonic() - phase_start
            self._phases.append(phase_timing)
            self._current_phase = None

    @contextmanager
    def operation(self, name: str, **metadata: Any) -> Iterator[OperationTiming]:
        """Context manager for timing an operation within current phase.

        Args:
            name: Operation name (e.g., "nix_flake_update", "deploy_machines")
            **metadata: Additional metadata to store with the operation

        Yields:
            OperationTiming object that can be modified

        Note:
            If called outside a phase context, the operation is recorded
            but not attached to any phase.
        """
        op_start = time.monotonic()
        op_timestamp = time.time()
        op_timing = OperationTiming(
            name=name,
            duration_seconds=0.0,
            start_timestamp=op_timestamp,
            metadata=dict(metadata),
        )

        # Notify callback that operation started
        if self._on_operation_start:
            self._on_operation_start(name)

        try:
            yield op_timing
        except Exception as e:
            op_timing.success = False
            op_timing.error_message = str(e)
            raise
        finally:
            op_timing.duration_seconds = time.monotonic() - op_start
            if self._current_phase is not None:
                self._current_phase.operations.append(op_timing)

            # Notify callback that operation completed
            if self._on_operation_complete:
                self._on_operation_complete(name, op_timing.duration_seconds)

    def record_operation(
        self,
        name: str,
        duration: float,
        success: bool = True,
        error_message: str | None = None,
        **metadata: Any,
    ) -> None:
        """Manually record an operation timing (for already-timed operations).

        Args:
            name: Operation name
            duration: Duration in seconds
            success: Whether the operation succeeded
            error_message: Error message if operation failed
            **metadata: Additional metadata
        """
        op = OperationTiming(
            name=name,
            duration_seconds=duration,
            start_timestamp=time.time() - duration,
            success=success,
            error_message=error_message,
            metadata=dict(metadata),
        )
        if self._current_phase is not None:
            self._current_phase.operations.append(op)

        if self._on_operation_complete:
            self._on_operation_complete(name, duration)

    def finalize(self) -> TimingBreakdown:
        """Finalize and return the complete timing breakdown.

        Returns:
            TimingBreakdown with all recorded phases and operations
        """
        end_time = time.monotonic()
        end_timestamp = time.time()

        return TimingBreakdown(
            vpn_name=self.vpn_name,
            total_duration_seconds=end_time - self._start_time,
            start_timestamp=self._start_timestamp,
            end_timestamp=end_timestamp,
            phases=self._phases,
        )

    @property
    def current_phase(self) -> PhaseTiming | None:
        """Get the current phase being timed, if any."""
        return self._current_phase
