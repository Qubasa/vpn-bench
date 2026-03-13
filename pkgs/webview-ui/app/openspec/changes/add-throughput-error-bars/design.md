## Context

The webview UI displays VPN benchmark results using ECharts bar charts. Three chart components render throughput bars:

1. **IperfTcpCharts** (`createThroughputOption`) — TCP sent/received throughput with two bar series
2. **IperfUdpCharts** (`createUdpThroughputOption`) — UDP sent/received throughput with two bar series
3. **ComparisonCharts** (`createBarChartOption`) — generic bar chart used for cross-VPN comparisons

All three have access to min/max data (via `MetricStats` or per-report stats) but only display it in tooltips, not visually.

## Goals / Non-Goals

**Goals:**
- Add min/max error bar whiskers to every throughput bar chart
- Reuse existing min/max data already available in the chart option builders
- Maintain readability of existing bar labels and tooltips

**Non-Goals:**
- Adding standard deviation or confidence interval calculations (min/max whiskers are sufficient)
- Adding error bars to non-throughput charts (CPU, packet loss, jitter, latency)
- Changing chart layout, colors, or tooltip format

## Decisions

### Use ECharts `markPoint` with custom `renderItem` for error bars

ECharts does not have a built-in error bar series type. Options considered:

1. **`markLine`** — Already partially configured in ComparisonCharts but only supports horizontal/vertical lines, not per-bar whiskers positioned at each category.
2. **Custom series with `type: 'custom'` and `renderItem`** — Draws arbitrary shapes per data point. Can render a vertical line with horizontal caps (T-bar whiskers) positioned precisely at each bar's x-coordinate. This is the standard ECharts approach for error bars.
3. **Scatter plot overlay** — Plots min/max as dots. Less intuitive than whiskers.

**Decision**: Use `type: 'custom'` series with a `renderItem` function that draws a vertical line from min to max with small horizontal caps. This is added as an additional series alongside each bar series.

### Share a single `renderErrorBar` helper

All three chart components need the same rendering logic. A shared helper function will be created and imported by each component to avoid code duplication.

### Skip error bars for incomplete/crashed entries

In ComparisonCharts, entries with `isIncomplete: true` show placeholder bars (hatched patterns). Error bars SHALL NOT be rendered for these entries since they have no real min/max data.

## Risks / Trade-offs

- **Visual clutter with many bars**: When bars are narrow (many VPNs), whisker caps may overlap. Mitigation: keep cap width small (6px) and use a subtle color (#666).
- **Error bars on zero-variance data**: If min === max === average, error bars collapse to a dot. Mitigation: skip rendering when min === max to keep the chart clean.
