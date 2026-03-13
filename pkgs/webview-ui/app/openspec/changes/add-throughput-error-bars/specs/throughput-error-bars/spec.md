## ADDED Requirements

### Requirement: Throughput bar charts display error bars showing min/max range
All throughput bar charts SHALL render error bar whiskers (vertical line with horizontal caps) indicating the min and max values for each bar. The bar itself represents the average value; the whiskers extend from the minimum to the maximum observed value.

#### Scenario: TCP throughput chart shows error bars for sent and received
- **WHEN** the TCP Iperf throughput bar chart is rendered with reports that have varying min/max throughput values
- **THEN** each "Average Sent" bar SHALL have a whisker extending from minSentMbps to maxSentMbps
- **AND** each "Average Received" bar SHALL have a whisker extending from minRecvMbps to maxRecvMbps

#### Scenario: UDP throughput chart shows error bars for sent and received
- **WHEN** the UDP Iperf throughput bar chart is rendered with reports that have varying min/max throughput values
- **THEN** each "Average Sent" bar SHALL have a whisker extending from minSentMbps to maxSentMbps
- **AND** each "Average Received" bar SHALL have a whisker extending from minRecvMbps to maxRecvMbps

#### Scenario: Comparison bar chart shows error bars
- **WHEN** a ComparisonBarChart is rendered with BarChartData entries that have min and max values
- **THEN** each bar SHALL have a whisker extending from the min to the max value

### Requirement: Error bars are not rendered when there is no variance
Error bars SHALL NOT be rendered for data points where min equals max (no variance), to avoid visual clutter.

#### Scenario: Single-run data shows no error bars
- **WHEN** a throughput bar is rendered with min === max === average
- **THEN** no whisker SHALL be drawn for that bar

### Requirement: Error bars are not rendered for incomplete entries
In comparison charts, error bars SHALL NOT be rendered for bars representing incomplete or crashed benchmarks.

#### Scenario: Crashed VPN shows no error bar
- **WHEN** a ComparisonBarChart entry has isIncomplete set to true
- **THEN** no whisker SHALL be drawn for that bar
