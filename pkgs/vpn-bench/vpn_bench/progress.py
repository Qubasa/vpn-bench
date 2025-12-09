"""Progress tracking system for benchmark execution."""

from __future__ import annotations

import io
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from time import monotonic
from typing import IO

from clan_lib.async_run import AsyncContext, get_async_ctx, set_async_ctx

from vpn_bench.data import VPN, TestType

# Default timing estimates (in seconds) for operations when no history is available
# These are conservative estimates based on typical execution times
DEFAULT_OPERATION_ESTIMATES: dict[str, float] = {
    # VPN Installation operations
    "nix_flake_update": 60.0,
    "create_base_inventory": 5.0,
    "deploy_base_machines": 180.0,
    "clean_state_dirs": 10.0,
    "install_zerotier_config": 5.0,
    "install_mycelium_config": 5.0,
    "install_hyprspace_config": 5.0,
    "install_vpncloud_config": 5.0,
    "install_yggdrasil_config": 5.0,
    "install_wireguard_config": 5.0,
    "install_easytier_config": 5.0,
    "install_nebula_config": 5.0,
    "install_tinc_config": 5.0,
    "install_internal_config": 1.0,
    "run_zerotier_generators": 30.0,
    "get_vpn_ips": 30.0,
    "install_nix_cache": 10.0,
    "install_connection_timings_service": 5.0,
    "run_generators": 30.0,
    "deploy_vpn_machines": 180.0,
    "initial_connection_timings": 120.0,
    "reboot_connection_timings": 420.0,
    # Benchmarking operations
    "tc_stabilization": 30.0,
    "run_tests": 300.0,  # Per profile, will be refined based on test count
}

# Estimated time per test type (including VPN restart)
DEFAULT_TEST_ESTIMATES: dict[str, float] = {
    "IPERF3": 90.0,  # TCP + UDP + VPN restart
    "IPERF3_PARALLEL_TCP": 60.0,  # All machines run TCP simultaneously
    "QPERF": 60.0,
    "PING": 45.0,
    "NIX_CACHE": 60.0,
    "RIST_STREAM": 60.0,
}


@dataclass
class TimingHistory:
    """Tracks timing history for operations to improve ETA estimates."""

    # Operation name -> list of durations (for computing averages)
    operation_durations: dict[str, list[float]] = field(default_factory=dict)

    # Phase timing: tracks total time spent in each phase type
    phase_durations: dict[str, list[float]] = field(default_factory=dict)

    # VPN installation timing (per VPN)
    vpn_installation_durations: list[float] = field(default_factory=list)

    # Profile benchmarking timing (per profile)
    profile_benchmarking_durations: list[float] = field(default_factory=list)

    # Test timing (per test type)
    test_durations: dict[str, list[float]] = field(default_factory=dict)

    def record_operation(self, name: str, duration: float) -> None:
        """Record an operation's duration for future estimates."""
        if name not in self.operation_durations:
            self.operation_durations[name] = []
        self.operation_durations[name].append(duration)

    def record_phase(self, phase_type: str, duration: float) -> None:
        """Record a phase's duration."""
        if phase_type not in self.phase_durations:
            self.phase_durations[phase_type] = []
        self.phase_durations[phase_type].append(duration)

    def record_vpn_installation(self, duration: float) -> None:
        """Record VPN installation duration."""
        self.vpn_installation_durations.append(duration)

    def record_profile_benchmarking(self, duration: float) -> None:
        """Record profile benchmarking duration."""
        self.profile_benchmarking_durations.append(duration)

    def record_test(self, test_type: str, duration: float) -> None:
        """Record test duration (including VPN restart)."""
        if test_type not in self.test_durations:
            self.test_durations[test_type] = []
        self.test_durations[test_type].append(duration)

    def get_operation_estimate(self, name: str) -> float:
        """Get estimated duration for an operation based on history or defaults."""
        if self.operation_durations.get(name):
            # Use average of recorded durations
            durations = self.operation_durations[name]
            return sum(durations) / len(durations)

        # Check if it matches a pattern (e.g., install_*_config)
        if name.startswith("install_") and name.endswith("_config"):
            # Use average of all config installation times
            config_times = [
                d
                for op, durations in self.operation_durations.items()
                if op.startswith("install_") and op.endswith("_config")
                for d in durations
            ]
            if config_times:
                return sum(config_times) / len(config_times)

        # Fall back to default estimates
        return DEFAULT_OPERATION_ESTIMATES.get(name, 30.0)

    def get_vpn_installation_estimate(self) -> float:
        """Get estimated VPN installation duration."""
        if self.vpn_installation_durations:
            return sum(self.vpn_installation_durations) / len(
                self.vpn_installation_durations
            )
        # Sum up default operation estimates for installation
        installation_ops = [
            "nix_flake_update",
            "create_base_inventory",
            "deploy_base_machines",
            "clean_state_dirs",
            "get_vpn_ips",
            "install_nix_cache",
            "run_generators",
            "deploy_vpn_machines",
            "initial_connection_timings",
            "reboot_connection_timings",
        ]
        return sum(DEFAULT_OPERATION_ESTIMATES.get(op, 30.0) for op in installation_ops)

    def get_profile_benchmarking_estimate(
        self, test_count: int, machine_count: int
    ) -> float:
        """Get estimated profile benchmarking duration."""
        if self.profile_benchmarking_durations:
            return sum(self.profile_benchmarking_durations) / len(
                self.profile_benchmarking_durations
            )
        # Estimate based on test count and machine count
        # tc_stabilization (30s) + tests
        base = 30.0
        tests_time = 0.0
        for _test_name, estimate in DEFAULT_TEST_ESTIMATES.items():
            tests_time += estimate * machine_count
        return base + tests_time

    def get_test_estimate(self, test_type: str) -> float:
        """Get estimated test duration."""
        if self.test_durations.get(test_type):
            return sum(self.test_durations[test_type]) / len(
                self.test_durations[test_type]
            )
        return DEFAULT_TEST_ESTIMATES.get(test_type, 60.0)


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

    # Operation-level timing for TUI display
    current_operation: str | None = None
    current_operation_start: float | None = None
    last_operation_name: str | None = None
    last_operation_duration: float | None = None

    # Timing history for improved ETA calculation
    timing_history: TimingHistory = field(default_factory=TimingHistory)

    # Phase timing tracking
    vpn_install_start: float | None = None
    profile_start: float | None = None
    test_start: float | None = None

    # List of test types being run (for ETA calculation)
    test_types: list[TestType] = field(default_factory=list)

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
        """Estimate remaining time using timing history for accuracy."""
        return self._calculate_smart_eta()

    def _calculate_smart_eta(self) -> float | None:
        """Calculate ETA using phase-aware estimation.

        This method provides more accurate estimates by:
        1. Tracking actual durations of completed operations
        2. Using different estimates for installation vs benchmarking phases
        3. Refining estimates as more data becomes available
        """
        remaining = 0.0

        # Calculate remaining VPN installations
        remaining_vpns = self.vpn_total - self.vpn_index
        if remaining_vpns > 0:
            # For current VPN, check if we're still installing
            if self.phase == "installing" or "install" in self.phase.lower():
                # Estimate remaining installation time for current VPN
                # Use operation-level estimates if available
                if self.current_operation:
                    # We're mid-operation, estimate remaining ops
                    remaining += self._estimate_remaining_installation()
                else:
                    # Use full installation estimate
                    remaining += self.timing_history.get_vpn_installation_estimate()

                # Add installation time for remaining VPNs (excluding current)
                remaining += (
                    remaining_vpns - 1
                ) * self.timing_history.get_vpn_installation_estimate()

                # Add benchmarking time for all VPNs including current
                remaining += (
                    remaining_vpns
                    * self.profile_total
                    * self.timing_history.get_profile_benchmarking_estimate(
                        self.test_total, self.machine_total
                    )
                )
            else:
                # We're in benchmarking phase
                # Add remaining benchmarking time for current VPN
                remaining += self._estimate_remaining_benchmarking()

                # Add full time (install + benchmark) for remaining VPNs
                for _ in range(remaining_vpns - 1):
                    remaining += self.timing_history.get_vpn_installation_estimate()
                    remaining += (
                        self.profile_total
                        * self.timing_history.get_profile_benchmarking_estimate(
                            self.test_total, self.machine_total
                        )
                    )
        elif self.vpn_index == self.vpn_total and self.phase != "finished":
            # All VPNs done but not marked finished yet
            return 0.0

        return remaining if remaining > 0 else None

    def _estimate_remaining_installation(self) -> float:
        """Estimate remaining time in the installation phase."""
        # Order of installation operations
        installation_ops = [
            "nix_flake_update",
            "create_base_inventory",
            "deploy_base_machines",
            "clean_state_dirs",
            "get_vpn_ips",
            "install_nix_cache",
            "install_connection_timings_service",
            "run_generators",
            "deploy_vpn_machines",
            "initial_connection_timings",
            "reboot_connection_timings",
        ]

        # Find current operation index
        current_idx = -1
        if self.current_operation:
            # Handle VPN-specific config operations
            op_name = self.current_operation
            if op_name.startswith("install_") and op_name.endswith("_config"):
                # Config installation happens after deploy_base_machines
                current_idx = installation_ops.index("deploy_base_machines")
            else:
                for i, op in enumerate(installation_ops):
                    if op == op_name:
                        current_idx = i
                        break

        if current_idx < 0:
            # Unknown operation, return full estimate
            return self.timing_history.get_vpn_installation_estimate()

        # Sum estimates for remaining operations
        remaining = 0.0

        # Current operation remaining time (estimate 50% if mid-operation)
        if self.current_operation_start:
            elapsed_in_op = monotonic() - self.current_operation_start
            op_estimate = self.timing_history.get_operation_estimate(
                self.current_operation or ""
            )
            remaining += max(0, op_estimate - elapsed_in_op)
        else:
            remaining += self.timing_history.get_operation_estimate(
                installation_ops[current_idx]
            )

        # Add estimates for all operations after current
        for op in installation_ops[current_idx + 1 :]:
            remaining += self.timing_history.get_operation_estimate(op)

        return remaining

    def _estimate_remaining_benchmarking(self) -> float:
        """Estimate remaining time in the benchmarking phase."""
        remaining = 0.0

        # Remaining profiles for current VPN
        remaining_profiles = self.profile_total - self.profile_index

        if remaining_profiles > 0:
            # For current profile, estimate remaining tests
            if self.machine_total > 0 and self.test_total > 0:
                # Remaining machines in current profile
                remaining_machines = self.machine_total - self.machine_index

                if remaining_machines > 0:
                    # Remaining tests for current machine
                    remaining_tests_current = self.test_total - self.test_index

                    # Estimate time for remaining tests on current machine
                    for i in range(remaining_tests_current):
                        test_idx = self.test_index + i
                        if test_idx < len(self.test_types):
                            test_type = self.test_types[test_idx].name
                            remaining += self.timing_history.get_test_estimate(
                                test_type
                            )
                        else:
                            remaining += 60.0  # Default

                    # Add time for remaining machines (full test suite each)
                    for _ in range(remaining_machines - 1):
                        for test_type in self.test_types:
                            remaining += self.timing_history.get_test_estimate(
                                test_type.name
                            )

                # Add full profile time for remaining profiles
                remaining += (
                    remaining_profiles - 1
                ) * self.timing_history.get_profile_benchmarking_estimate(
                    self.test_total, self.machine_total
                )
            else:
                # No test/machine info, use profile estimate
                remaining += (
                    remaining_profiles
                    * self.timing_history.get_profile_benchmarking_estimate(
                        self.test_total, self.machine_total
                    )
                )

        return remaining

    def format_elapsed(self) -> str:
        """Format elapsed time as human-readable string."""
        return _format_duration(self.elapsed_seconds)

    def format_eta(self) -> str:
        """Format estimated remaining time."""
        remaining = self.estimated_remaining_seconds
        if remaining is None:
            return "calculating..."
        return f"~{_format_duration(remaining)}"

    def format_eta_breakdown(self) -> str:
        """Format ETA with phase breakdown for more detail.

        Returns a string like "Install: ~5m | Tests: ~20m" during installation,
        or "Tests: ~15m" during benchmarking.
        """
        if self.phase == "finished":
            return "done"

        parts = []

        if "install" in self.phase.lower():
            install_remaining = self._estimate_remaining_installation()
            parts.append(f"Install: ~{_format_duration(install_remaining)}")

            # Estimate benchmarking time for current + remaining VPNs
            remaining_vpns = self.vpn_total - self.vpn_index
            if remaining_vpns > 0:
                bench_time = (
                    remaining_vpns
                    * self.profile_total
                    * self.timing_history.get_profile_benchmarking_estimate(
                        self.test_total, self.machine_total
                    )
                )
                parts.append(f"Tests: ~{_format_duration(bench_time)}")
        else:
            # In benchmarking phase
            bench_remaining = self._estimate_remaining_benchmarking()
            parts.append(f"Tests: ~{_format_duration(bench_remaining)}")

            # Add time for remaining VPNs if any
            remaining_vpns = self.vpn_total - self.vpn_index - 1
            if remaining_vpns > 0:
                vpn_time = remaining_vpns * (
                    self.timing_history.get_vpn_installation_estimate()
                    + self.profile_total
                    * self.timing_history.get_profile_benchmarking_estimate(
                        self.test_total, self.machine_total
                    )
                )
                parts.append(f"+{remaining_vpns} VPNs: ~{_format_duration(vpn_time)}")

        return " | ".join(parts) if parts else "calculating..."


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

        # Store test types for ETA calculation
        self.progress.test_types = list(tests)

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
        # Track VPN installation start time
        self.progress.vpn_install_start = monotonic()
        self._notify()

    def start_profile(self, profile: str, index: int) -> None:
        """Mark start of TC profile benchmark run."""
        # Record VPN installation time if transitioning from install phase
        if (
            self.progress.vpn_install_start is not None
            and self.progress.profile_index == 0
        ):
            install_duration = monotonic() - self.progress.vpn_install_start
            self.progress.timing_history.record_vpn_installation(install_duration)
            self.progress.vpn_install_start = None

        self.progress.current_profile = profile
        self.progress.profile_index = index
        self.progress.phase = "benchmarking"
        self.progress.current_test = None
        self.progress.test_index = 0
        self.progress.current_machine = None
        self.progress.machine_index = 0
        # Track profile start time
        self.progress.profile_start = monotonic()

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
        # Track test start time
        self.progress.test_start = monotonic()
        self._notify()

    def complete_test(self) -> None:
        """Mark test as completed."""
        # Record test duration if we have a start time
        if self.progress.test_start is not None and self.progress.current_test:
            test_duration = monotonic() - self.progress.test_start
            self.progress.timing_history.record_test(
                self.progress.current_test.name, test_duration
            )
            self.progress.test_start = None

        self.progress.test_index += 1
        self._notify()

    def complete_machine(self) -> None:
        """Mark machine benchmark as completed."""
        self.progress.machine_index += 1
        self._notify()

    def complete_profile(self) -> None:
        """Mark profile as completed."""
        # Record profile benchmarking duration
        if self.progress.profile_start is not None:
            profile_duration = monotonic() - self.progress.profile_start
            self.progress.timing_history.record_profile_benchmarking(profile_duration)
            self.progress.profile_start = None

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

    def start_operation(self, name: str) -> None:
        """Mark start of an operation for TUI display.

        Args:
            name: Name of the operation (e.g., "nix_flake_update", "deploy_machines")
        """
        self.progress.current_operation = name
        self.progress.current_operation_start = monotonic()
        self._notify()

    def end_operation(self) -> None:
        """Mark end of current operation."""
        if self.progress.current_operation_start is not None:
            self.progress.last_operation_name = self.progress.current_operation
            self.progress.last_operation_duration = (
                monotonic() - self.progress.current_operation_start
            )
        self.progress.current_operation = None
        self.progress.current_operation_start = None
        self._notify()

    def update_operation_timing(self, name: str, duration: float) -> None:
        """Update the last completed operation timing.

        This is called by TimingTracker's on_operation_complete callback.

        Args:
            name: Name of the completed operation
            duration: Duration in seconds
        """
        self.progress.last_operation_name = name
        self.progress.last_operation_duration = duration
        self.progress.current_operation = None
        self.progress.current_operation_start = None

        # Record operation timing in history for improved ETA
        self.progress.timing_history.record_operation(name, duration)

        self._notify()

    def finish(self) -> None:
        """Mark entire benchmark as finished."""
        self.progress.phase = "finished"
        self._notify()
