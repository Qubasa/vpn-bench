import { describe, expect, it } from "vitest";
import { collectVpnKinds, VpnKindsFile } from "@/src/vpnKind";

const kindFiles = import.meta.glob<VpnKindsFile>(
  "@/bench/*/General/vpns.json",
  { eager: true, import: "default" },
);
// Path format: @/bench/<ALIAS>/<VPN>/layout.json, one per VPN directory
const vpnDirs = Object.keys(import.meta.glob("@/bench/*/*/layout.json")).map(
  (path) => path.split("/").slice(-3, -1),
);
const runs = [...new Set(vpnDirs.map(([alias]) => alias))].map(
  (alias) =>
    [
      alias,
      vpnDirs
        .filter(([a]) => a === alias)
        .map(([, vpn]) => vpn)
        .sort(),
    ] as const,
);

describe.each(runs)("run %s", (alias, vpns) => {
  it("gives every VPN directory a kind", () => {
    const file = Object.entries(kindFiles).find(([path]) =>
      path.includes(`/bench/${alias}/General/`),
    )?.[1];
    expect(Object.keys(file?.data ?? {}).sort()).toEqual(vpns);
  });
});

describe("collectVpnKinds", () => {
  const file = (kind: "mesh" | "no_vpn"): VpnKindsFile => ({
    status: "success",
    data: { Internal: { kind } },
  });

  it("rejects runs that disagree on a VPN's kind", () => {
    expect(() =>
      collectVpnKinds({
        "a/vpns.json": file("no_vpn"),
        "b/vpns.json": file("mesh"),
      }),
    ).toThrow(/Internal is mesh/);
  });

  it("keeps Internal and WireGuard out of the mesh VPNs", () => {
    const kinds = collectVpnKinds(kindFiles);
    expect(kinds.get("Internal")).toBe("no_vpn");
    expect(kinds.get("Wireguard")).toBe("point_to_point");
  });
});
