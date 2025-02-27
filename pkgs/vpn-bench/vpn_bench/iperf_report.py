import json
import logging
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.ticker import FuncFormatter

log = logging.getLogger(__name__)


def analyze_iperf_report(
    json_data: dict[Any, Any],
    name: str = "",
    title: str = "VPN Performance Analysis",
    ax: list[plt.Axes] | None = None,
    summary_x_pos: float = 0.1,
    summary_y_pos: float = 0.9,
    color: str = "#2E86C1",
) -> list[plt.Axes] | None:
    """
    Analyze and plot iperf3 JSON report data using Matplotlib.

    Args:
        json_data: The iperf3 JSON report
        name: Name of the machine/test for labeling
        title: Title for the plot
        ax: Optional list of axes to plot on (for subplot integration)
        summary_x_pos: X position for the summary text box
        summary_y_pos: Y position for the summary text box
        color: Color for the plots

    Returns:
        List of axes if created new, None if plotting on existing axes
    """
    # Extract time series data from intervals
    intervals = json_data["intervals"]

    # Create DataFrames for different metrics
    data = []
    for interval in intervals:
        stream = interval["streams"][0]
        data.append(
            {
                "Time (s)": stream["end"],
                "Bandwidth (Mbps)": stream["bits_per_second"]
                / 1_000_000,  # Convert to Mbps
                "RTT (ms)": stream["rtt"] / 1000,  # Convert to ms
                "TCP Window Size (KB)": stream["snd_cwnd"] / 1024,  # Convert to KB
            }
        )

    df = pd.DataFrame(data)

    # Create new figure and axes if not provided
    if ax is None:
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 10))
        fig.suptitle(title, fontsize=16, y=1.02)
    else:
        ax1, ax2 = ax

    # Plot 1: Bandwidth over time with RTT
    ax1.plot(
        df["Time (s)"],
        df["Bandwidth (Mbps)"],
        color=color,
        linewidth=2,
        label=f"Bandwidth - {name}",
    )
    ax1.set_xlabel("Time (seconds)")
    ax1.set_ylabel("Bandwidth (Mbps)")
    ax1.grid(True, alpha=0.3)

    # Add RTT on secondary y-axis
    ax1_twin = ax1.twinx()
    ax1_twin.plot(
        df["Time (s)"],
        df["RTT (ms)"],
        color=color,
        linewidth=2,
        label=f"RTT - {name}",
        linestyle="--",
        alpha=0.7,
    )
    ax1_twin.set_ylabel("RTT (ms)")

    # Plot 2: TCP Window Size over time
    ax2.plot(
        df["Time (s)"],
        df["TCP Window Size (KB)"],
        color=color,
        linewidth=2,
        label=f"TCP Window Size - {name}",
    )
    ax2.set_xlabel("Time (seconds)")
    ax2.set_ylabel("TCP Window Size (KB)")
    ax2.grid(True, alpha=0.3)

    # Format y-axis with K/M suffixes for better readability
    def human_format(x: float, pos: int) -> str:
        if x >= 1e6:
            return f"{x / 1e6:.1f}M"
        if x >= 1e3:
            return f"{x / 1e3:.1f}K"
        return f"{x:.1f}"

    ax2.yaxis.set_major_formatter(FuncFormatter(human_format))

    # Add summary statistics
    summary_stats = {
        f"Summary ({name})": "",
        "Avg Bandwidth": f"{df['Bandwidth (Mbps)'].mean():.1f} Mbps",
        "Max Bandwidth": f"{df['Bandwidth (Mbps)'].max():.1f} Mbps",
        "Avg RTT": f"{df['RTT (ms)'].mean():.1f} ms",
        "TCP Window": f"{df['TCP Window Size (KB)'].max():.1f} KB",
        "Total Data": f"{json_data['end']['sum_sent']['bytes'] / (1024 * 1024):.1f} MB",
        "CPU Usage": f"{json_data['end']['cpu_utilization_percent']['host_total']:.1f}%",
    }

    # Create summary text box
    summary_text = "\n".join(f"{k}: {v}" for k, v in summary_stats.items())
    props = {"boxstyle": "round", "facecolor": "white", "alpha": 0.8}
    plt.figtext(
        summary_x_pos,
        summary_y_pos,
        summary_text,
        fontsize=10,
        bbox=props,
        verticalalignment="top",
    )

    return [ax1, ax2]


def compare_vpn_reports(
    reports: dict[str, dict],
    output_dir: Path,
    output_name: str,
    title: str = "VPN Performance Comparison",
    formats: list[str] | None = None,
) -> None:
    """
    Compare multiple VPN performance reports and save the plots to specified directory.

    Args:
        reports: Dictionary mapping report names to their JSON data
        output_dir: Directory where to save the plots
        output_name: Base name for the output files (without extension)
        title: Main title for the comparison plot
        formats: List of formats to save (e.g., ["png", "pdf"])
    """
    if formats is None:
        formats = ["png", "pdf"]

    # Create output directory if it doesn't exist
    output_dir.mkdir(parents=True, exist_ok=True)

    # Create the plot
    fig, axes = plt.subplots(2, 1, figsize=(12, 10))
    fig.suptitle(title, fontsize=16, y=1.02)

    # Define distinct colors for each report
    colors = [
        "#2E86C1",  # Blue
        "#E74C3C",  # Red
        "#27AE60",  # Green
        "#8E44AD",  # Purple
        "#F39C12",  # Orange
        "#16A085",  # Teal
        "#D35400",  # Dark Orange
        "#2C3E50",  # Navy
    ]

    # Calculate summary y-positions based on number of reports
    len(reports)
    summary_spacing = 0.15
    start_y = 0.9

    # Clear any existing plots
    axes[0].clear()
    axes[1].clear()

    # Plot data for each report with different colors
    for idx, (name, report) in enumerate(reports.items()):
        color = colors[idx % len(colors)]
        analyze_iperf_report(
            report,
            name=name,
            ax=axes,
            summary_x_pos=1.18,
            summary_y_pos=start_y - idx * summary_spacing,
            color=color,
        )

    # Add combined legends for both plots
    ax1, ax2 = axes

    # Get all axes including twins
    ax1_twin = ax1.get_shared_x_axes().get_siblings(ax1)[0]

    # Handle legends
    bandwidth_lines = ax1.get_lines()
    rtt_lines = ax1_twin.get_lines()
    window_lines = ax2.get_lines()

    # Get labels
    bandwidth_labels = [h.get_label() for h in bandwidth_lines]
    rtt_labels = [h.get_label() for h in rtt_lines]
    window_labels = [h.get_label() for h in window_lines]

    # Create a single legend for the first plot
    ax1.legend(
        bandwidth_lines + rtt_lines,
        bandwidth_labels + rtt_labels,
        loc="upper right",
        bbox_to_anchor=(1.15, 1),
    )

    # TCP Window Size legend
    ax2.legend(
        window_lines,
        window_labels,
        loc="upper right",
        bbox_to_anchor=(1.15, 1),
    )

    # Adjust layout to make room for summaries but not too much
    plt.subplots_adjust(right=0.88)  # Chan

    # Save plots with extra space for summaries
    for fmt in formats:
        filename = output_dir / f"{output_name}.{fmt}"
        plt.savefig(filename, bbox_inches="tight", dpi=300)
        log.info(f"Saved plot to: {filename}")

    # Save summary data as JSON
    summary_data = [
        {
            "Host": name,
            "Avg Bandwidth (Mbps)": f"{report['end']['sum_sent']['bits_per_second'] / 1_000_000:.1f}",
            "Total Data (MB)": f"{report['end']['sum_sent']['bytes'] / (1024 * 1024):.1f}",
            "CPU Usage (%)": f"{report['end']['cpu_utilization_percent']['host_total']:.1f}",
        }
        for name, report in reports.items()
    ]

    summary_file = output_dir / f"{output_name}_summary.json"
    with summary_file.open("w") as f:
        json.dump(summary_data, f, indent=2)
    log.info(f"Saved summary data to: {summary_file}")

    # Close the figure to free memory
    plt.close(fig)
