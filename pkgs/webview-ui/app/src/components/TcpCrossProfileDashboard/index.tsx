import { Show, createSignal, createEffect } from "solid-js";
import {
  TcpCrossProfileCharts,
  ParallelTcpCrossProfileCharts,
} from "../TcpCrossProfileCharts";
import { UdpCrossProfileCharts } from "../UdpCrossProfileCharts";
import { PingCrossProfileCharts } from "../PingCrossProfileCharts";
import { QperfCrossProfileCharts } from "../QperfCrossProfileCharts";
import { VideoStreamingCrossProfileCharts } from "../VideoStreamingCrossProfileCharts";
import { NixCacheCrossProfileCharts } from "../NixCacheCrossProfileCharts";
import {
  crossProfileTcpData,
  crossProfileUdpData,
  crossProfilePingData,
  crossProfileQperfData,
  crossProfileVideoStreamingData,
  crossProfileNixCacheData,
  CrossProfileTcpData,
} from "../../benchData";
import { Tabs } from "@kobalte/core/tabs";
import { useSearchParams } from "@solidjs/router";
import "../VpnBenchDashboard/style.css";

interface TcpCrossProfileDashboardProps {
  data?: CrossProfileTcpData | null;
}

// Helper component for consistent "No Data" message
const FallbackMessage = (props: { message?: string }) => (
  <div class="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
    <p class="font-medium">{props.message || "No data available"}</p>
    <p class="mt-1 text-sm">
      Run <code class="rounded bg-yellow-100 px-1">vpb compare</code> to
      generate cross-profile comparison data.
    </p>
  </div>
);

export const TcpCrossProfileDashboard = (
  props: TcpCrossProfileDashboardProps,
) => {
  // Use provided data or fall back to global crossProfileTcpData
  const data = () => props.data ?? crossProfileTcpData;

  // Get URL search params for state sync
  const [searchParams, setSearchParams] = useSearchParams();

  // Valid tab values
  const validTabs = [
    "tcp-cross-profile",
    "parallel-tcp-cross-profile",
    "udp-cross-profile",
    "ping-cross-profile",
    "qperf-cross-profile",
    "video-streaming-cross-profile",
    "nix-cache-cross-profile",
  ] as const;
  type ValidTab = (typeof validTabs)[number];

  // Initialize from URL or default
  const initialTab =
    searchParams.crossTab &&
    validTabs.includes(searchParams.crossTab as ValidTab)
      ? searchParams.crossTab
      : "tcp-cross-profile";

  const [selectedTab, setSelectedTab] = createSignal(initialTab);

  // Handler that updates both local state AND URL
  const handleTabChange = (newTab: string) => {
    setSelectedTab(newTab);
    setSearchParams({ ...searchParams, crossTab: newTab });
  };

  // Sync with URL changes (e.g., browser back/forward)
  createEffect(() => {
    const urlTab = searchParams.crossTab;
    if (urlTab && validTabs.includes(urlTab as ValidTab)) {
      setSelectedTab(urlTab);
    }
  });

  // Check if data is available for each type
  const hasTcpData = () => (data()?.tcp.bar3d.throughput_data.length ?? 0) > 0;
  const hasParallelData = () =>
    (data()?.parallel_tcp.bar3d.throughput_data.length ?? 0) > 0;
  const hasUdpData = () =>
    Object.keys(crossProfileUdpData?.heatmap.throughput ?? {}).length > 0;
  const hasPingData = () =>
    Object.keys(crossProfilePingData?.heatmap.rtt ?? {}).length > 0;
  const hasQperfData = () =>
    Object.keys(crossProfileQperfData?.heatmap.bandwidth ?? {}).length > 0;
  const hasVideoStreamingData = () =>
    Object.keys(crossProfileVideoStreamingData?.heatmap.quality ?? {}).length >
    0;
  const hasNixCacheData = () =>
    Object.keys(crossProfileNixCacheData?.heatmap.mean_seconds ?? {}).length >
    0;

  // Check if any cross-profile data is available
  const hasAnyData = () =>
    data() ||
    crossProfileUdpData ||
    crossProfilePingData ||
    crossProfileQperfData ||
    crossProfileVideoStreamingData ||
    crossProfileNixCacheData;

  return (
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-800">
          Cross-Profile Performance Comparison
        </h1>
        <p class="mt-2 text-gray-600">
          Comparing throughput and metrics across all VPNs and network
          impairment profiles (baseline, low, medium, high impairment).
        </p>
      </div>

      <Show
        when={hasAnyData()}
        fallback={<FallbackMessage message="No cross-profile data available" />}
      >
        <Tabs
          aria-label="Cross-Profile Comparison"
          class="tabs"
          value={selectedTab()}
          onChange={handleTabChange}
        >
          <Tabs.List class="tabs__list">
            <Tabs.Trigger class="tabs__trigger" value="tcp-cross-profile">
              TCP Performance
            </Tabs.Trigger>
            <Tabs.Trigger
              class="tabs__trigger"
              value="parallel-tcp-cross-profile"
            >
              Parallel TCP
            </Tabs.Trigger>
            <Tabs.Trigger class="tabs__trigger" value="udp-cross-profile">
              UDP Performance
            </Tabs.Trigger>
            <Tabs.Trigger class="tabs__trigger" value="ping-cross-profile">
              Ping Latency
            </Tabs.Trigger>
            <Tabs.Trigger class="tabs__trigger" value="qperf-cross-profile">
              QUIC Performance
            </Tabs.Trigger>
            <Tabs.Trigger
              class="tabs__trigger"
              value="video-streaming-cross-profile"
            >
              Video Streaming
            </Tabs.Trigger>
            <Tabs.Trigger class="tabs__trigger" value="nix-cache-cross-profile">
              Nix Cache
            </Tabs.Trigger>
            <Tabs.Indicator class="tabs__indicator" />
          </Tabs.List>

          <Tabs.Content class="tabs__content" value="tcp-cross-profile">
            <Show
              when={hasTcpData() ? data() : null}
              fallback={
                <FallbackMessage message="No TCP cross-profile data available" />
              }
            >
              {(tcpData) => <TcpCrossProfileCharts data={tcpData()} />}
            </Show>
          </Tabs.Content>

          <Tabs.Content
            class="tabs__content"
            value="parallel-tcp-cross-profile"
          >
            <Show
              when={hasParallelData() ? data() : null}
              fallback={
                <FallbackMessage message="No Parallel TCP cross-profile data available" />
              }
            >
              {(tcpData) => <ParallelTcpCrossProfileCharts data={tcpData()} />}
            </Show>
          </Tabs.Content>

          <Tabs.Content class="tabs__content" value="udp-cross-profile">
            <Show
              when={hasUdpData() ? crossProfileUdpData : null}
              fallback={
                <FallbackMessage message="No UDP cross-profile data available" />
              }
            >
              {(udpData) => <UdpCrossProfileCharts data={udpData()} />}
            </Show>
          </Tabs.Content>

          <Tabs.Content class="tabs__content" value="ping-cross-profile">
            <Show
              when={hasPingData() ? crossProfilePingData : null}
              fallback={
                <FallbackMessage message="No Ping cross-profile data available" />
              }
            >
              {(pingData) => <PingCrossProfileCharts data={pingData()} />}
            </Show>
          </Tabs.Content>

          <Tabs.Content class="tabs__content" value="qperf-cross-profile">
            <Show
              when={hasQperfData() ? crossProfileQperfData : null}
              fallback={
                <FallbackMessage message="No QUIC cross-profile data available" />
              }
            >
              {(qperfData) => <QperfCrossProfileCharts data={qperfData()} />}
            </Show>
          </Tabs.Content>

          <Tabs.Content
            class="tabs__content"
            value="video-streaming-cross-profile"
          >
            <Show
              when={
                hasVideoStreamingData() ? crossProfileVideoStreamingData : null
              }
              fallback={
                <FallbackMessage message="No Video Streaming cross-profile data available" />
              }
            >
              {(videoData) => (
                <VideoStreamingCrossProfileCharts data={videoData()} />
              )}
            </Show>
          </Tabs.Content>

          <Tabs.Content class="tabs__content" value="nix-cache-cross-profile">
            <Show
              when={hasNixCacheData() ? crossProfileNixCacheData : null}
              fallback={
                <FallbackMessage message="No Nix Cache cross-profile data available" />
              }
            >
              {(nixData) => <NixCacheCrossProfileCharts data={nixData()} />}
            </Show>
          </Tabs.Content>
        </Tabs>
      </Show>
    </div>
  );
};

export default TcpCrossProfileDashboard;
