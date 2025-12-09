"""Progress tracking system for benchmark execution."""

import io
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from time import monotonic
from typing import IO

from clan_lib.async_run import AsyncContext, get_async_ctx, set_async_ctx

from vpn_bench.data import VPN, TestType


class CallbackIO(io.RawIOBase):
    """IO object that forwards writes to a callback function."""

    def __init__(
        self,
        callback: Callable[[str], None],
        should_cancel: Callable[[], bool] | None = None,
    ) -> None:
        super().__init__()
        self._callback = callback
        self._should_cancel = should_cancel or (lambda: False)
        self._buffer = ""

    def writable(self) -> bool:
        return True

    def write(self, b: bytes | str) -> int:  # type: ignore[override]
        """Write data and forward complete lines to callback."""
        if self._should_cancel():
            # App is shutting down, don't try to write
            return len(b) if isinstance(b, bytes) else len(b.encode("utf-8"))

        if isinstance(b, bytes):
            text = b.decode("utf-8", errors="replace")
        else:
            text = b

        self._buffer += text

        # Process complete lines
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if line:  # Don't send empty lines
                self._callback(line)

        return len(b) if isinstance(b, bytes) else len(b.encode("utf-8"))

    def flush(self) -> None:
        """Flush any remaining buffer content."""
        if self._should_cancel():
            # App is shutting down, discard buffer
            self._buffer = ""
            return

        if self._buffer:
            self._callback(self._buffer)
            self._buffer = ""


@dataclass
class BenchmarkProgress:
    """Tracks the current state of benchmark execution."""

    # Current state
    current_vpn: VPN | None = None
    current_profile: str | None = None
    current_test: TestType | None = None
    current_machine: str | None = None
    target_machine: str | None = None

    # Counts
    vpn_index: int = 0
    vpn_total: int = 0
    profile_index: int = 0
    profile_total: int = 0
    test_index: int = 0
    test_total: int = 0
    machine_index: int = 0
    machine_total: int = 0

    # Timing
    start_time: float = field(default_factory=monotonic)

    # Queue of upcoming (vpn, profile, tests) tuples
    upcoming: list[tuple[VPN, str, list[TestType]]] = field(default_factory=list)

    # Machine pairs for circular benchmark pattern (source, target)
    # e.g., [("A", "B"), ("B", "C"), ("C", "A")]
    machine_pairs: list[tuple[str, str]] = field(default_factory=list)

    # Phase tracking
    phase: str = "initializing"

    @property
    def elapsed_seconds(self) -> float:
        """Return elapsed time since benchmark start."""
        return monotonic() - self.start_time

    @property
    def total_steps(self) -> int:
        """Calculate total number of test steps across all VPNs/profiles/machines."""
        # Each VPN has profile_total profiles
        # Each profile runs test_total tests on machine_total machines
        return (
            self.vpn_total * self.profile_total * self.test_total * self.machine_total
        )

    @property
    def completed_steps(self) -> int:
        """Calculate number of completed test steps."""
        # Completed VPNs
        completed = (
            self.vpn_index * self.profile_total * self.test_total * self.machine_total
        )

        # Current VPN - completed profiles
        completed += self.profile_index * self.test_total * self.machine_total

        # Current profile - completed machines with all their tests
        completed += self.machine_index * self.test_total

        # Current machine - completed tests
        completed += self.test_index

        return completed

    @property
    def progress_percent(self) -> float:
        """Return progress as percentage (0-100)."""
        total = self.total_steps
        if total == 0:
            return 0.0
        return min(100.0, (self.completed_steps / total) * 100.0)

    @property
    def estimated_remaining_seconds(self) -> float | None:
        """Estimate remaining time based on current progress."""
        completed = self.completed_steps
        if completed == 0:
            return None

        elapsed = self.elapsed_seconds
        total = self.total_steps
        if total <= completed:
            return 0.0

        avg_per_step = elapsed / completed
        remaining_steps = total - completed
        return avg_per_step * remaining_steps

    def format_elapsed(self) -> str:
        """Format elapsed time as human-readable string."""
        return _format_duration(self.elapsed_seconds)

    def format_eta(self) -> str:
        """Format estimated remaining time."""
        remaining = self.estimated_remaining_seconds
        if remaining is None:
            return "calculating..."
        return f"~{_format_duration(remaining)}"


def _format_duration(seconds: float) -> str:
    """Format seconds as human-readable duration."""
    if seconds < 60:
        return f"{int(seconds)}s"
    if seconds < 3600:
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{minutes}m {secs}s"
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    return f"{hours}h {minutes}m"


# Callback type aliases
ProgressCallback = Callable[[BenchmarkProgress], None]
LogCallback = Callable[[str], None]


@dataclass
class ProgressTracker:
    """Manages progress state and callbacks."""

    progress: BenchmarkProgress = field(default_factory=BenchmarkProgress)
    progress_callback: ProgressCallback | None = None
    log_callback: LogCallback | None = None
    _stdout_io: IO[bytes] | None = field(default=None, repr=False)
    _stderr_io: IO[bytes] | None = field(default=None, repr=False)
    _should_cancel: Callable[[], bool] = field(default=lambda: False, repr=False)

    @property
    def stdout(self) -> IO[bytes] | None:
        """Get stdout IO object for capturing command output."""
        return self._stdout_io

    @property
    def stderr(self) -> IO[bytes] | None:
        """Get stderr IO object for capturing command output."""
        return self._stderr_io

    def setup_io(
        self,
        callback: LogCallback,
        should_cancel: Callable[[], bool] | None = None,
    ) -> None:
        """Set up IO objects for capturing stdout/stderr.

        Args:
            callback: Function to call with log messages
            should_cancel: Function that returns True when the app is shutting down
        """
        self._should_cancel = should_cancel or (lambda: False)
        self._stdout_io = CallbackIO(callback, should_cancel)  # type: ignore[assignment]
        self._stderr_io = CallbackIO(callback, should_cancel)  # type: ignore[assignment]

    @contextmanager
    def capture_output_context(self) -> Iterator[None]:
        """Context manager that sets AsyncContext to capture command output.

        All clan_lib.cmd.run() calls within this context will have their
        stdout/stderr captured and forwarded to the log callback.

        Usage:
            tracker.setup_io(my_callback)
            with tracker.capture_output_context():
                # All run() calls here will have output captured
                run_benchmarks(...)
        """
        if self._stdout_io is None or self._stderr_io is None:
            # No IO setup, just yield without changing context
            yield
            return

        original_ctx = get_async_ctx()

        # Create new context with our IO streams and cancellation function
        # Use our _should_cancel to allow the TUI to signal shutdown
        ctx = AsyncContext(
            prefix=original_ctx.prefix,
            stdout=self._stdout_io,
            stderr=self._stderr_io,
            should_cancel=self._should_cancel,
            op_key=original_ctx.op_key,
        )
        set_async_ctx(ctx)

        try:
            yield
        finally:
            # Restore original context
            set_async_ctx(original_ctx)

    def _notify(self) -> None:
        """Send progress update to callback if registered."""
        if self.progress_callback is not None:
            self.progress_callback(self.progress)

    def log(self, message: str) -> None:
        """Send log message to callback if registered."""
        if self.log_callback is not None:
            self.log_callback(message)

    def initialize(
        self,
        vpns: list[VPN],
        profiles: list[str],
        tests: list[TestType],
        machines: list[str],
    ) -> None:
        """Initialize progress tracking with benchmark parameters."""
        self.progress.vpn_total = len(vpns)
        self.progress.profile_total = len(profiles)
        self.progress.test_total = len(tests)
        self.progress.machine_total = len(machines)
        self.progress.start_time = monotonic()
        self.progress.phase = "starting"

        # Build upcoming queue
        self.progress.upcoming = []
        for vpn in vpns:
            for profile in profiles:
                self.progress.upcoming.append((vpn, profile, list(tests)))

        # Build machine pairs for circular benchmark pattern
        # e.g., [A, B, C] -> [(A, B), (B, C), (C, A)]
        self.progress.machine_pairs = []
        for i, machine in enumerate(machines):
            next_machine = machines[(i + 1) % len(machines)]
            self.progress.machine_pairs.append((machine, next_machine))

        self._notify()

    def start_vpn(self, vpn: VPN, index: int) -> None:
        """Mark start of VPN installation/benchmark."""
        self.progress.current_vpn = vpn
        self.progress.vpn_index = index
        self.progress.phase = "installing"
        self.progress.current_profile = None
        self.progress.profile_index = 0
        self.progress.current_test = None
        self.progress.test_index = 0
        self.progress.current_machine = None
        self.progress.machine_index = 0
        self._notify()

    def start_profile(self, profile: str, index: int) -> None:
        """Mark start of TC profile benchmark run."""
        self.progress.current_profile = profile
        self.progress.profile_index = index
        self.progress.phase = "benchmarking"
        self.progress.current_test = None
        self.progress.test_index = 0
        self.progress.current_machine = None
        self.progress.machine_index = 0

        # Remove from upcoming queue
        if self.progress.upcoming:
            vpn = self.progress.current_vpn
            upcoming_filtered = [
                (v, p, t)
                for v, p, t in self.progress.upcoming
                if not (v == vpn and p == profile)
            ]
            self.progress.upcoming = upcoming_filtered

        self._notify()

    def start_machine(self, machine: str, target: str, index: int) -> None:
        """Mark start of benchmark on a specific machine."""
        self.progress.current_machine = machine
        self.progress.target_machine = target
        self.progress.machine_index = index
        self.progress.current_test = None
        self.progress.test_index = 0
        self._notify()

    def start_test(self, test: TestType, index: int) -> None:
        """Mark start of specific test."""
        self.progress.current_test = test
        self.progress.test_index = index
        self._notify()

    def complete_test(self) -> None:
        """Mark test as completed."""
        self.progress.test_index += 1
        self._notify()

    def complete_machine(self) -> None:
        """Mark machine benchmark as completed."""
        self.progress.machine_index += 1
        self._notify()

    def complete_profile(self) -> None:
        """Mark profile as completed."""
        self.progress.profile_index += 1
        self._notify()

    def complete_vpn(self) -> None:
        """Mark VPN benchmark as completed."""
        self.progress.vpn_index += 1
        self.progress.phase = "completed"
        self._notify()

    def set_phase(self, phase: str) -> None:
        """Set current phase description."""
        self.progress.phase = phase
        self._notify()

    def finish(self) -> None:
        """Mark entire benchmark as finished."""
        self.progress.phase = "finished"
        self._notify()
