## Why

Throughput bar charts currently display only the average value, hiding the variability across benchmark runs. Min/max data is already available in the `MetricStats` interface but only shown in tooltips. Adding visual error bars makes variance immediately visible, helping users identify unreliable or noisy measurements at a glance.

## What Changes

- Add error bars (min/max whiskers) to all throughput bar charts across the application
- Applies to: IperfTcpCharts, IperfUdpCharts, ComparisonCharts (throughput metrics), and any other bar charts displaying throughput with available min/max data
- Error bars will use ECharts' custom rendering to draw whisker lines from min to max around each bar

## Capabilities

### New Capabilities
- `throughput-error-bars`: Visual error bars (min/max whiskers) on all throughput bar charts, using existing MetricStats data

### Modified Capabilities

## Impact

- **Code**: Chart option builders in `IperfTcpCharts`, `IperfUdpCharts`, `ComparisonCharts`, and cross-profile chart components
- **Dependencies**: No new dependencies — uses existing ECharts `markLine` or custom series capabilities
- **Data**: No data changes — `MetricStats` already provides min, average, max, and percentiles
