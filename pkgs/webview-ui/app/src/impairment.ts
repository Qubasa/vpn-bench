import type {
  ReceiverIfbTCSettings,
  SenderRootTCSettings,
  TCSettingsData,
} from "./benchData";

// Network impairment of one profile, every value per direction (per machine).
interface ImpairmentValues {
  methodLabel: string;
  latencyMs: number | null;
  addedRttMs: number | null;
  jitterMs: number | null;
  jitterDistribution: string | null;
  lossPercent: number | null;
  reorderPercent: number | null;
  reorderCorrelation: number | null;
  bandwidthMbit: number | null;
}

export interface ImpairmentTile {
  label: string;
  value: string;
  detail: string;
}

export interface ImpairmentPanel {
  methodLabel: string;
  tiles: ImpairmentTile[];
}

const halve = (value: number | null): number | null =>
  value == null ? null : value / 2;

const fmt = (value: number): string => String(Number(value.toFixed(3)));

function receiverIfbValues(settings: ReceiverIfbTCSettings): ImpairmentValues {
  const latencyMs = settings.latency_ms;
  return {
    methodLabel: `receiver-side netem, GRO ${settings.gro_during_profile}`,
    latencyMs,
    addedRttMs:
      settings.added_rtt_ms ?? (latencyMs == null ? null : latencyMs * 2),
    jitterMs: settings.jitter_ms,
    jitterDistribution: settings.jitter_distribution,
    lossPercent: settings.packet_loss_percent,
    reorderPercent: null,
    reorderCorrelation: null,
    bandwidthMbit: settings.bandwidth_mbit,
  };
}

// Old runs stored doubled latency, jitter, loss and reorder (correlation unchanged).
function senderRootValues(settings: SenderRootTCSettings): ImpairmentValues {
  return {
    methodLabel: "sender-side netem (old)",
    latencyMs: halve(settings.latency_ms),
    addedRttMs: settings.latency_ms,
    jitterMs: halve(settings.jitter_ms),
    jitterDistribution: "uniform",
    lossPercent: halve(settings.packet_loss_percent),
    reorderPercent: halve(settings.reorder_percent),
    reorderCorrelation: settings.reorder_correlation,
    bandwidthMbit: settings.bandwidth_mbit,
  };
}

function tilesFor(v: ImpairmentValues): ImpairmentTile[] {
  const tiles: ImpairmentTile[] = [];
  if (v.latencyMs != null) {
    const rtt = v.addedRttMs == null ? "" : ` (+${fmt(v.addedRttMs)} ms RTT)`;
    tiles.push({
      label: "Delay",
      value: `${fmt(v.latencyMs)} ms`,
      detail: `per direction${rtt}`,
    });
  }
  if (v.jitterMs != null) {
    const distribution = v.jitterDistribution ?? "uniform";
    tiles.push({
      label: "Jitter",
      value: `${fmt(v.jitterMs)} ms`,
      detail: `per direction, ${distribution}`,
    });
  }
  if (v.lossPercent != null) {
    tiles.push({
      label: "Packet Loss",
      value: `${fmt(v.lossPercent)} %`,
      detail: "per direction",
    });
  }
  if (v.reorderPercent != null) {
    const correlation =
      v.reorderCorrelation == null
        ? ""
        : `, ${fmt(v.reorderCorrelation)} % correlation`;
    tiles.push({
      label: "Reordering",
      value: `${fmt(v.reorderPercent)} %`,
      detail: `per direction${correlation}`,
    });
  }
  if (v.bandwidthMbit != null) {
    tiles.push({
      label: "Bandwidth",
      value: `${fmt(v.bandwidthMbit)} Mbit/s`,
      detail: "per direction",
    });
  }
  return tiles;
}

/**
 * Converts a stored tc_settings.json into per-direction panel tiles.
 *
 * A missing `method` field marks an old sender-side run whose stored values are doubled.
 *
 * @returns The method label and tiles, or null when the profile applies no impairment.
 */
export function impairmentPanel(
  data: TCSettingsData | null | undefined,
): ImpairmentPanel | null {
  const settings = data?.settings;
  if (!settings) return null;
  const values =
    settings.method === "receiver-ifb"
      ? receiverIfbValues(settings)
      : senderRootValues(settings);
  const tiles = tilesFor(values);
  return tiles.length > 0 ? { methodLabel: values.methodLabel, tiles } : null;
}
