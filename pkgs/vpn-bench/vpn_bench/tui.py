"""Textual TUI for VPN benchmark progress display."""

import logging
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING

from rich.text import Text
from textual import work
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal
from textual.events import MouseScrollDown, MouseScrollUp
from textual.widgets import (
    Footer,
    Header,
    Label,
    ProgressBar,
    RichLog,
    Static,
    TabbedContent,
    TabPane,
)
from textual.worker import get_current_worker

from vpn_bench.data import VPN, BenchmarkEntry, Config, TestType
from vpn_bench.progress import BenchmarkProgress, ProgressTracker
from vpn_bench.terraform import TrMachine

if TYPE_CHECKING:
    from textual.worker import Worker

log = logging.getLogger(__name__)


class SmartRichLog(RichLog):
    """RichLog with smart auto-scroll that pauses when user scrolls up."""

    def _is_at_bottom(self, threshold: int = 2) -> bool:
        """Check if scroll position is at or near the bottom."""
        return self.scroll_y >= self.max_scroll_y - threshold

    def on_mouse_scroll_up(self, event: MouseScrollUp) -> None:
        """User scrolled up - disable auto-scroll."""
        self.auto_scroll = False

    def on_mouse_scroll_down(self, event: MouseScrollDown) -> None:
        """User scrolled down - re-enable auto-scroll if at bottom."""
        # Use call_later to check position after scroll completes
        self.call_later(self._check_scroll_position)

    def _check_scroll_position(self) -> None:
        """Check scroll position and enable auto-scroll if at bottom."""
        if self._is_at_bottom():
            self.auto_scroll = True


class ProgressPanel(Static):
    """Widget displaying current benchmark progress."""

    DEFAULT_CSS = """
    ProgressPanel {
        height: auto;
        background: $surface;
        border: solid $primary;
    }

    ProgressPanel #phase-banner {
        width: 100%;
        background: $primary;
        color: $text;
        text-style: bold;
        padding: 0 1;
        text-align: center;
    }

    ProgressPanel #phase-banner.installing {
        background: $primary;
    }

    ProgressPanel #phase-banner.benchmarking {
        background: $success;
    }

    ProgressPanel #phase-banner.finished {
        background: $secondary;
    }

    ProgressPanel .info-grid {
        layout: grid;
        grid-size: 4 2;
        grid-gutter: 0 2;
        padding: 1;
        height: auto;
    }

    ProgressPanel .info-label {
        width: auto;
        text-style: bold;
        color: $text-muted;
    }

    ProgressPanel .info-value {
        width: auto;
        color: $text;
    }

    ProgressPanel .info-value-highlight {
        width: auto;
        color: $success;
        text-style: bold;
    }

    ProgressPanel ProgressBar {
        width: 100%;
        margin: 0 1;
    }

    ProgressPanel .timing-row {
        height: auto;
        padding: 0 1 1 1;
    }

    ProgressPanel .timing-label {
        color: $text-muted;
    }

    ProgressPanel .timing-value {
        color: $text;
        margin-right: 2;
    }

    ProgressPanel .operation-row {
        height: auto;
        padding: 0 1;
    }

    ProgressPanel .operation-label {
        color: $text-muted;
    }

    ProgressPanel .operation-value {
        color: $warning;
        text-style: bold;
    }

    ProgressPanel .operation-duration {
        color: $text-muted;
        margin-left: 1;
    }

    ProgressPanel .last-op-row {
        height: auto;
        padding: 0 1 1 1;
    }

    ProgressPanel .last-op-value {
        color: $success;
    }

    ProgressPanel .eta-breakdown-row {
        height: auto;
        padding: 0 1;
    }

    ProgressPanel .eta-breakdown-value {
        color: $primary;
        text-style: italic;
    }
    """

    def compose(self) -> ComposeResult:
        # Phase banner at top
        yield Label("INITIALIZING", id="phase-banner")

        # Two-column info grid
        with Container(classes="info-grid"):
            yield Label("VPN:", classes="info-label")
            yield Label("--", id="vpn-value", classes="info-value-highlight")
            yield Label("Test:", classes="info-label")
            yield Label("--", id="test-value", classes="info-value")
            yield Label("Profile:", classes="info-label")
            yield Label("--", id="profile-value", classes="info-value-highlight")
            yield Label("Machine:", classes="info-label")
            yield Label("--", id="machine-value", classes="info-value")

        # Progress bar
        yield ProgressBar(total=100, show_eta=False, id="main-progress")

        # Current operation row
        with Horizontal(classes="operation-row"):
            yield Label("Operation: ", classes="operation-label")
            yield Label("--", id="operation-value", classes="operation-value")
            yield Label("", id="operation-duration", classes="operation-duration")

        # Last completed operation row
        with Horizontal(classes="last-op-row"):
            yield Label("Last: ", classes="timing-label")
            yield Label("--", id="last-op-value", classes="last-op-value")

        # Timing row
        with Horizontal(classes="timing-row"):
            yield Label("Elapsed: ", classes="timing-label")
            yield Label("0s", id="elapsed-value", classes="timing-value")
            yield Label("ETA: ", classes="timing-label")
            yield Label("calculating...", id="eta-value", classes="timing-value")

        # ETA breakdown row (shows phase-specific estimates)
        with Horizontal(classes="eta-breakdown-row"):
            yield Label("", id="eta-breakdown-value", classes="eta-breakdown-value")

    def update_progress(self, progress: BenchmarkProgress) -> None:
        """Update the progress display with new state."""
        # Update VPN
        vpn_text = "--"
        if progress.current_vpn is not None:
            vpn_text = f"{progress.current_vpn.value} ({progress.vpn_index + 1}/{progress.vpn_total})"
        self.query_one("#vpn-value", Label).update(vpn_text)

        # Update profile
        profile_text = "--"
        if progress.current_profile is not None:
            profile_text = f"{progress.current_profile} ({progress.profile_index + 1}/{progress.profile_total})"
        self.query_one("#profile-value", Label).update(profile_text)

        # Update test
        test_text = "--"
        if progress.current_test is not None:
            test_text = f"{progress.current_test.value} ({progress.test_index + 1}/{progress.test_total})"
        self.query_one("#test-value", Label).update(test_text)

        # Update machine (source -> target)
        machine_text = "--"
        if progress.current_machine is not None and progress.target_machine is not None:
            machine_text = f"{progress.current_machine} → {progress.target_machine}"
        elif progress.current_machine is not None:
            machine_text = progress.current_machine
        self.query_one("#machine-value", Label).update(machine_text)

        # Update phase banner with appropriate styling
        phase_banner = self.query_one("#phase-banner", Label)
        phase_text = progress.phase.upper()
        phase_banner.update(phase_text)

        # Set phase-specific styling class
        phase_banner.remove_class("installing", "benchmarking", "finished")
        if "install" in progress.phase.lower():
            phase_banner.add_class("installing")
        elif "benchmark" in progress.phase.lower():
            phase_banner.add_class("benchmarking")
        elif "finish" in progress.phase.lower():
            phase_banner.add_class("finished")

        # Update progress bar
        self.query_one("#main-progress", ProgressBar).update(
            progress=progress.progress_percent
        )

        # Update timing
        self.query_one("#elapsed-value", Label).update(progress.format_elapsed())
        self.query_one("#eta-value", Label).update(progress.format_eta())

        # Update ETA breakdown
        self.query_one("#eta-breakdown-value", Label).update(
            progress.format_eta_breakdown()
        )

        # Update current operation display
        if progress.current_operation is not None:
            self.query_one("#operation-value", Label).update(progress.current_operation)
            # Calculate elapsed time for current operation
            if progress.current_operation_start is not None:
                from time import monotonic

                elapsed = monotonic() - progress.current_operation_start
                self.query_one("#operation-duration", Label).update(
                    f"({self._format_duration(elapsed)})"
                )
            else:
                self.query_one("#operation-duration", Label).update("")
        else:
            self.query_one("#operation-value", Label).update("--")
            self.query_one("#operation-duration", Label).update("")

        # Update last completed operation display
        if (
            progress.last_operation_name is not None
            and progress.last_operation_duration is not None
        ):
            last_op_text = (
                f"{progress.last_operation_name} "
                f"({self._format_duration(progress.last_operation_duration)})"
            )
            self.query_one("#last-op-value", Label).update(last_op_text)
        else:
            self.query_one("#last-op-value", Label).update("--")

    @staticmethod
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


class MachineRingPanel(Static):
    """Widget displaying machine pairs in a circular ring pattern."""

    DEFAULT_CSS = """
    MachineRingPanel {
        height: auto;
        padding: 0 1;
        background: $surface;
        border: solid $secondary;
    }

    MachineRingPanel .ring-title {
        text-style: bold;
    }

    MachineRingPanel .ring-display {
        height: auto;
        width: 100%;
    }
    """

    def compose(self) -> ComposeResult:
        yield Label("Machines:", classes="ring-title")
        yield Label("(initializing...)", id="ring-display", classes="ring-display")

    def update_ring(
        self,
        pairs: list[tuple[str, str]],
        current_index: int,
    ) -> None:
        """Update the ring visualization.

        Args:
            pairs: List of (source, target) machine pairs
            current_index: Index of the currently running pair (-1 if none)
        """
        display = self.query_one("#ring-display", Label)

        if not pairs:
            display.update("(no machines)")
            return

        # Build a single Rich Text with styled segments
        text = Text()

        for i, (source, target) in enumerate(pairs):
            # Add separator between pairs (not before first)
            if i > 0:
                text.append(" │ ", style="dim")

            # Build the pair text
            pair_text = f"{source}→{target}"

            # Style based on state
            if i < current_index:
                text.append(pair_text, style="dim strike")
            elif i == current_index:
                text.append(pair_text, style="bold green")
            else:
                text.append(pair_text, style="")

        # Show wrap-around indicator
        if len(pairs) > 1:
            text.append(" ↺", style="dim")

        display.update(text)


class UpcomingPanel(Static):
    """Widget displaying upcoming benchmarks."""

    DEFAULT_CSS = """
    UpcomingPanel {
        height: auto;
        max-height: 20;
        padding: 1;
        background: $surface;
        border: solid $secondary;
    }

    UpcomingPanel.collapsed {
        height: auto;
        max-height: 3;
        padding: 0 1;
        border: none;
        background: transparent;
    }

    UpcomingPanel .upcoming-header {
        height: auto;
    }

    UpcomingPanel .upcoming-title {
        text-style: bold;
    }

    UpcomingPanel .upcoming-empty {
        color: $text-muted;
        text-style: italic;
    }

    UpcomingPanel .upcoming-item {
        height: auto;
        color: $text-muted;
        padding-left: 2;
    }
    """

    def compose(self) -> ComposeResult:
        with Horizontal(classes="upcoming-header"):
            yield Label("Upcoming: ", classes="upcoming-title")
            yield Label("", id="upcoming-empty-label", classes="upcoming-empty")
        yield Container(id="upcoming-list")

    def update_upcoming(self, upcoming: list[tuple[VPN, str, list[TestType]]]) -> None:
        """Update the upcoming list with grouped VPN display."""
        from collections import defaultdict

        container = self.query_one("#upcoming-list", Container)
        empty_label = self.query_one("#upcoming-empty-label", Label)
        container.remove_children()

        if not upcoming:
            # Show collapsed state
            empty_label.update("(none)")
            self.add_class("collapsed")
            return

        # Show expanded state with items
        empty_label.update("")
        self.remove_class("collapsed")

        # Group by VPN
        vpn_groups: dict[VPN, list[tuple[str, list[TestType]]]] = defaultdict(list)
        for vpn, profile, tests in upcoming:
            vpn_groups[vpn].append((profile, tests))

        max_vpns = 4
        max_profiles_per_vpn = 3

        vpn_list = list(vpn_groups.items())
        for i, (vpn, profiles) in enumerate(vpn_list[:max_vpns]):
            # VPN header with box drawing
            prefix = "┌" if i == 0 else "├"
            text = Text()
            text.append(f"{prefix}─ ", style="dim")
            text.append(vpn.value, style="bold green")
            text.append(" " + "─" * (30 - len(vpn.value)), style="dim")
            container.mount(Label(text, classes="upcoming-vpn"))

            # Profile items
            for profile, tests in profiles[:max_profiles_per_vpn]:
                test_str = ", ".join(t.value for t in tests[:4])
                if len(tests) > 4:
                    test_str += f" +{len(tests) - 4}"

                ptext = Text()
                ptext.append("│  ", style="dim")
                ptext.append(profile, style="cyan")
                ptext.append(f": {test_str}")
                container.mount(Label(ptext, classes="upcoming-item"))

            if len(profiles) > max_profiles_per_vpn:
                remaining = len(profiles) - max_profiles_per_vpn
                container.mount(
                    Label(
                        Text(f"│  ... +{remaining} profiles", style="dim"),
                        classes="upcoming-item",
                    )
                )

        if len(vpn_list) > max_vpns:
            remaining = len(vpn_list) - max_vpns
            container.mount(
                Label(
                    Text(f"└─ +{remaining} more VPNs", style="dim"),
                    classes="upcoming-item",
                )
            )
        else:
            container.mount(
                Label(Text("└" + "─" * 35, style="dim"), classes="upcoming-item")
            )


class CompletedPanel(Static):
    """Widget displaying completed benchmarks."""

    DEFAULT_CSS = """
    CompletedPanel {
        height: auto;
        max-height: 20;
        padding: 1;
        background: $surface;
        border: solid $secondary;
    }

    CompletedPanel.collapsed {
        height: auto;
        max-height: 3;
        padding: 0 1;
        border: none;
        background: transparent;
    }

    CompletedPanel .completed-header {
        height: auto;
    }

    CompletedPanel .completed-title {
        text-style: bold;
    }

    CompletedPanel .completed-empty {
        color: $text-muted;
        text-style: italic;
    }

    CompletedPanel .completed-item {
        height: auto;
        color: $text-muted;
        padding-left: 2;
    }
    """

    def compose(self) -> ComposeResult:
        with Horizontal(classes="completed-header"):
            yield Label("Completed: ", classes="completed-title")
            yield Label("", id="completed-empty-label", classes="completed-empty")
        yield Container(id="completed-list")

    def update_completed(
        self, completed: list[tuple[VPN, str, list[TestType]]]
    ) -> None:
        """Update the completed list with grouped VPN display."""
        from collections import defaultdict

        container = self.query_one("#completed-list", Container)
        empty_label = self.query_one("#completed-empty-label", Label)
        container.remove_children()

        if not completed:
            # Show collapsed state
            empty_label.update("(none)")
            self.add_class("collapsed")
            return

        # Show expanded state with items
        empty_label.update("")
        self.remove_class("collapsed")

        # Group by VPN
        vpn_groups: dict[VPN, list[tuple[str, list[TestType]]]] = defaultdict(list)
        for vpn, profile, tests in completed:
            vpn_groups[vpn].append((profile, tests))

        max_vpns = 4
        max_profiles_per_vpn = 3

        vpn_list = list(vpn_groups.items())
        # Show most recent first (reverse order)
        vpn_list = vpn_list[::-1]

        for i, (vpn, profiles) in enumerate(vpn_list[:max_vpns]):
            # VPN header with checkmark
            prefix = "┌" if i == 0 else "├"
            text = Text()
            text.append(f"{prefix}─ ", style="dim")
            text.append("✓ ", style="bold green")
            text.append(vpn.value, style="bold green strike")
            text.append(" " + "─" * (28 - len(vpn.value)), style="dim")
            container.mount(Label(text, classes="completed-vpn"))

            # Profile items (most recent first)
            for profile, tests in profiles[::-1][:max_profiles_per_vpn]:
                test_str = ", ".join(t.value for t in tests[:4])
                if len(tests) > 4:
                    test_str += f" +{len(tests) - 4}"

                ptext = Text()
                ptext.append("│  ", style="dim")
                ptext.append("✓ ", style="green")
                ptext.append(profile, style="cyan strike")
                ptext.append(f": {test_str}", style="dim strike")
                container.mount(Label(ptext, classes="completed-item"))

            if len(profiles) > max_profiles_per_vpn:
                remaining = len(profiles) - max_profiles_per_vpn
                container.mount(
                    Label(
                        Text(f"│  ... +{remaining} profiles", style="dim"),
                        classes="completed-item",
                    )
                )

        if len(vpn_list) > max_vpns:
            remaining = len(vpn_list) - max_vpns
            container.mount(
                Label(
                    Text(f"└─ +{remaining} more VPNs", style="dim"),
                    classes="completed-item",
                )
            )
        else:
            container.mount(
                Label(Text("└" + "─" * 35, style="dim"), classes="completed-item")
            )


class TUILogHandler(logging.Handler):
    """Logging handler that forwards messages to the TUI."""

    def __init__(self, callback: Callable[[str], None]) -> None:
        super().__init__()
        self.callback = callback
        self.setFormatter(
            logging.Formatter(
                "%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S"
            )
        )

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            self.callback(msg)
        except Exception:
            self.handleError(record)


class BenchmarkTUI(App[None]):
    """Main TUI application for benchmark progress."""

    CSS = """
    Screen {
        layout: vertical;
        overflow: hidden hidden;
    }

    #top-panels {
        height: auto;
        max-height: 60%;
        overflow-y: auto;
    }

    #progress-panel {
        height: auto;
        max-height: 12;
    }

    #machine-ring-panel {
        height: auto;
        max-height: 4;
    }

    #queue-tabs {
        height: auto;
        max-height: 24;
    }

    #upcoming-panel {
        height: auto;
        max-height: 18;
    }

    #completed-panel {
        height: auto;
        max-height: 18;
    }

    #log-panel {
        height: 1fr;
        min-height: 5;
        border: solid $accent;
    }
    """

    BINDINGS = [
        ("q", "quit", "Quit"),
        ("p", "toggle_pause", "Pause/Resume Logs"),
        ("c", "clear_logs", "Clear Logs"),
    ]

    TITLE = "VPN Benchmark Suite"

    def __init__(
        self,
        config: Config,
        entries: list[BenchmarkEntry],
        machines: list[TrMachine],
    ) -> None:
        super().__init__()
        self.config = config
        self.entries = entries
        self.machines = machines
        self.tracker = ProgressTracker()
        self._log_paused = False
        self._shutting_down = False
        self._benchmark_worker: Worker[None] | None = None
        self._log_handler: TUILogHandler | None = None
        self._original_handlers: list[logging.Handler] = []
        self._main_thread_id: int | None = None

    def compose(self) -> ComposeResult:
        yield Header()
        with Container(id="top-panels"):
            yield ProgressPanel(id="progress-panel")
            yield MachineRingPanel(id="machine-ring-panel")
            with TabbedContent(id="queue-tabs"):
                with TabPane("Upcoming", id="upcoming-tab"):
                    yield UpcomingPanel(id="upcoming-panel")
                with TabPane("Completed", id="completed-tab"):
                    yield CompletedPanel(id="completed-panel")
        yield SmartRichLog(
            id="log-panel", auto_scroll=True, highlight=True, markup=True
        )
        yield Footer()

    def on_mount(self) -> None:
        """Called when app is mounted - start the benchmark."""
        # Store main thread ID for thread-safe callbacks
        self._main_thread_id = threading.get_ident()

        # Set up progress callback - detect if on main thread or worker thread
        # If on main thread, call directly; if on worker thread, use call_from_thread
        def thread_safe_progress_callback(progress: BenchmarkProgress) -> None:
            if threading.get_ident() == self._main_thread_id:
                self._on_progress_update(progress)
            else:
                self.call_from_thread(self._on_progress_update, progress)

        def thread_safe_log_callback(message: str) -> None:
            if threading.get_ident() == self._main_thread_id:
                self._on_log_message(message)
            else:
                self.call_from_thread(self._on_log_message, message)

        self.tracker.progress_callback = thread_safe_progress_callback
        self.tracker.log_callback = thread_safe_log_callback

        # Set up IO objects for capturing command stdout/stderr
        # Pass should_cancel to prevent writes during shutdown
        self.tracker.setup_io(
            thread_safe_log_callback,
            should_cancel=lambda: self._shutting_down,
        )

        # Initialize progress tracking from entries
        # Build upcoming queue with correct per-profile tests
        upcoming: list[tuple[VPN, str, list[TestType]]] = []
        total_test_steps = 0
        machine_count = len(self.machines)

        for entry in self.entries:
            for profile in entry.tc_profiles:
                tests = entry.get_tests_for_profile(profile)
                run = profile.to_benchmark_run()
                upcoming.append((entry.vpn, run.alias, tests))
                # Each test runs on each machine
                total_test_steps += len(tests) * machine_count

        # Collect unique values for progress display
        vpns = [entry.vpn for entry in self.entries]
        all_profiles: set[str] = set()
        for entry in self.entries:
            for run in entry.get_benchmark_runs():
                all_profiles.add(run.alias)
        profile_names = sorted(all_profiles)
        # Use max tests across all entries for progress bar (approximation)
        max_tests_per_profile = (
            max(
                len(entry.get_tests_for_profile(p))
                for entry in self.entries
                for p in entry.tc_profiles
            )
            if self.entries
            else 0
        )
        machine_names = [m["name"] for m in self.machines]

        # Initialize tracker with accurate counts
        self.tracker.initialize_with_upcoming(
            vpns, profile_names, max_tests_per_profile, machine_names, upcoming
        )

        # Remove existing handlers that write to stderr, add our TUI handler
        root_logger = logging.getLogger()
        self._original_handlers = list(root_logger.handlers)
        for handler in self._original_handlers:
            root_logger.removeHandler(handler)

        self._log_handler = TUILogHandler(self._thread_safe_log)
        root_logger.addHandler(self._log_handler)

        # Start benchmark in background
        self._benchmark_worker = self.run_benchmark()

    def on_unmount(self) -> None:
        """Clean up when app is unmounted."""
        # Signal shutdown to prevent CallbackIO from writing to destroyed widgets
        self._shutting_down = True

        # Clean up tracker resources (stops batched log forwarder)
        self.tracker.cleanup()

        root_logger = logging.getLogger()
        if self._log_handler is not None:
            root_logger.removeHandler(self._log_handler)
            self._log_handler = None
        # Restore original handlers
        for handler in self._original_handlers:
            root_logger.addHandler(handler)
        self._original_handlers = []

    def _thread_safe_log(self, message: str) -> None:
        """Thread-safe log message handler."""
        self.call_from_thread(self._on_log_message, message)

    def _on_progress_update(self, progress: BenchmarkProgress) -> None:
        """Handle progress update - must be called from main thread."""
        self.query_one("#progress-panel", ProgressPanel).update_progress(progress)
        self.query_one("#machine-ring-panel", MachineRingPanel).update_ring(
            progress.machine_pairs,
            progress.machine_index,
        )
        self.query_one("#upcoming-panel", UpcomingPanel).update_upcoming(
            progress.upcoming
        )
        self.query_one("#completed-panel", CompletedPanel).update_completed(
            progress.completed
        )

    def _on_log_message(self, message: str) -> None:
        """Handle log message - must be called from main thread."""
        if not self._log_paused:
            log_widget = self.query_one("#log-panel", SmartRichLog)
            # Handle batched messages (may contain multiple lines joined by \n)
            for line in message.split("\n"):
                if not line:
                    continue
                # Color based on log level
                if "[ERROR]" in line:
                    text = Text(line, style="red")
                elif "[WARNING]" in line:
                    text = Text(line, style="yellow")
                elif "[DEBUG]" in line:
                    text = Text(line, style="dim")
                else:
                    text = Text(line)
                log_widget.write(text)

    @work(thread=True)
    def run_benchmark(self) -> None:
        """Run the benchmark in a background thread."""
        from vpn_bench.bench import benchmark_vpn

        worker = get_current_worker()

        failed_vpns: list[tuple[VPN, str]] = []

        # Use capture_output_context to route all run() output to TUI
        with self.tracker.capture_output_context():
            for entry_idx, entry in enumerate(self.entries):
                if worker.is_cancelled:
                    break

                # Tracker callbacks are thread-safe, so we can call directly
                self.tracker.start_vpn(entry.vpn, entry_idx)
                self.tracker.log(
                    f"========== Starting benchmark for {entry.vpn.value} =========="
                )
                self.tracker.log(
                    f"  Tests: {[t.value for t in entry.tests]}, "
                    f"TC profiles: {[p.value for p in entry.tc_profiles]}, "
                    f"Skip connection times: {entry.skip_con_times}"
                )

                try:
                    benchmark_vpn(
                        self.config,
                        entry,
                        self.machines,
                        tracker=self.tracker,
                    )
                    self.tracker.complete_vpn()
                except Exception as e:
                    error_msg = str(e)
                    self.tracker.log(
                        f"[ERROR] Benchmark for {entry.vpn.value} failed: {error_msg}"
                    )
                    failed_vpns.append((entry.vpn, error_msg))
                    self.tracker.complete_vpn()

        # Report failures
        if failed_vpns:
            self.tracker.log(
                f"[WARNING] {len(failed_vpns)}/{len(self.entries)} VPNs failed:"
            )
            for vpn, error in failed_vpns:
                self.tracker.log(f"  - {vpn.value}: {error}")

        self.tracker.finish()
        self.tracker.log("========== Benchmark complete ==========")

    def action_toggle_pause(self) -> None:
        """Toggle log pausing."""
        self._log_paused = not self._log_paused
        status = "paused" if self._log_paused else "resumed"
        self.notify(f"Logs {status}")

    def action_clear_logs(self) -> None:
        """Clear the log panel."""
        self.query_one("#log-panel", SmartRichLog).clear()

    async def action_quit(self) -> None:
        """Quit the application."""
        # Signal shutdown before cancelling to prevent writes during cleanup
        self._shutting_down = True
        if self._benchmark_worker is not None:
            self._benchmark_worker.cancel()
        self.exit()
