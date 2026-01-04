// Import markdown files as raw strings
import easyTierOverview from "@/analysis/EasyTier_overview.md?raw";
import hyprspaceOverview from "@/analysis/hyprspace_overview.md?raw";
import myceliumOverview from "@/analysis/mycelium_overview.md?raw";
import nebulaOverview from "@/analysis/nebula_overview.md?raw";
import tailscaleOverview from "@/analysis/tailscale_headscale_overview.md?raw";
import tincOverview from "@/analysis/tinc_overview.md?raw";
import vpncloudOverview from "@/analysis/vpncloud_overview.md?raw";
import yggdrasilOverview from "@/analysis/yggdrasil_overview.md?raw";
import zerotierOverview from "@/analysis/zerotier_overview.md?raw";

// Map VPN names (lowercase) to their markdown content
export const vpnOverviews: Record<string, string> = {
  easytier: easyTierOverview,
  hyprspace: hyprspaceOverview,
  mycelium: myceliumOverview,
  nebula: nebulaOverview,
  tailscale: tailscaleOverview,
  headscale: tailscaleOverview, // Same file for both
  tinc: tincOverview,
  vpncloud: vpncloudOverview,
  yggdrasil: yggdrasilOverview,
  zerotier: zerotierOverview,
};

export function getVpnOverview(vpnName: string): string | null {
  const normalized = vpnName.toLowerCase().replace(/[\s_-]/g, "");
  return vpnOverviews[normalized] ?? null;
}
