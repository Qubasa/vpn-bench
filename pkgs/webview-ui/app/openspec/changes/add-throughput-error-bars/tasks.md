## 1. Shared Error Bar Helper

- [x] 1.1 Create a shared `renderErrorBar` helper function (e.g., in `src/components/Echarts/errorBars.ts`) that returns an ECharts custom series config. The function takes an array of `{ min, max }` values and renders vertical whisker lines with horizontal caps. It skips rendering when `min === max`.

## 2. TCP Throughput Error Bars

- [x] 2.1 Update `createThroughputOption` in `IperfTcpCharts/index.tsx` to add two custom error bar series — one for "Average Sent" (using minSentMbps/maxSentMbps) and one for "Average Received" (using minRecvMbps/maxRecvMbps)

## 3. UDP Throughput Error Bars

- [x] 3.1 Update `createUdpThroughputOption` in `IperfUdpCharts/index.tsx` to add two custom error bar series — one for sent and one for received, using the same shared helper

## 4. Comparison Chart Error Bars

- [x] 4.1 Update `createBarChartOption` in `ComparisonCharts/index.tsx` to add a custom error bar series using the sorted data's min/max values, skipping entries where `isIncomplete` is true

## 5. Verify

- [x] 5.1 Build the project and verify there are no TypeScript errors
