import { For, Show } from "solid-js";
import { useAlias } from "./AliasContext";

// Written by `vpb compare` from `VPN.kind` in pkgs/vpn-bench/vpn_bench/data.py
// Path format: @/bench/<ALIAS>/General/vpns.json
export type VpnKind = "mesh" | "point_to_point" | "no_vpn";
type NonMeshKind = Exclude<VpnKind, "mesh">;

export interface VpnKindsFile {
  status: "success";
  data: Record<string, { kind: VpnKind }>;
}

const NON_MESH_TAG: Record<NonMeshKind, string> = {
  point_to_point: "not mesh",
  no_vpn: "no VPN",
};

const NON_MESH_DESCRIPTION: Record<NonMeshKind, string> = {
  point_to_point:
    "a point-to-point tunnel without peer discovery, relaying, or NAT traversal",
  no_vpn: "the direct link between the hosts, without a VPN",
};

const NON_MESH_COLOR = "#9e9e9e";
const NON_MESH_OPACITY = 0.4;

/**
 * Merges the kinds of all runs into one lookup, since a kind belongs to the VPN.
 *
 * Throws:
 *   Error: when two runs give one VPN different kinds.
 */
export function collectVpnKinds(
  files: Record<string, VpnKindsFile>,
): Map<string, VpnKind> {
  const kinds = new Map<string, VpnKind>();
  for (const [path, file] of Object.entries(files)) {
    for (const [vpn, { kind }] of Object.entries(file.data)) {
      const known = kinds.get(vpn);
      if (known !== undefined && known !== kind) {
        throw new Error(
          `${path}: ${vpn} is ${kind}, another run says ${known}`,
        );
      }
      kinds.set(vpn, kind);
    }
  }
  return kinds;
}

const vpnKinds = collectVpnKinds(
  import.meta.glob<VpnKindsFile>("@/bench/*/General/vpns.json", {
    eager: true,
    import: "default",
  }),
);

export function vpnKind(vpn: string): VpnKind {
  const kind = vpnKinds.get(vpn);
  if (kind === undefined) {
    throw new Error(`No kind for VPN "${vpn}", rerun vpb compare`);
  }
  return kind;
}

/** Short tag for a VPN that is not a mesh VPN, undefined for a mesh VPN. */
export function nonMeshTag(vpn: string): string | undefined {
  const kind = vpnKind(vpn);
  return kind === "mesh" ? undefined : NON_MESH_TAG[kind];
}

/** Opacity of a VPN's bars and points: non-mesh VPNs are faded reference values. */
export function vpnOpacity(vpn: string): number {
  return vpnKind(vpn) === "mesh" ? 1 : NON_MESH_OPACITY;
}

/** Category axis labels that set non-mesh VPNs apart in grey italics with their tag. */
export const vpnAxisLabel = {
  formatter: (vpn: string) => {
    const tag = nonMeshTag(vpn);
    return tag === undefined ? vpn : `{nonMesh|${vpn}}\n{nonMesh|(${tag})}`;
  },
  rich: { nonMesh: { color: NON_MESH_COLOR, fontStyle: "italic" } },
};

/** Legend entries that tag non-mesh VPNs. */
export const vpnLegendFormatter = (vpn: string): string => {
  const tag = nonMeshTag(vpn);
  return tag === undefined ? vpn : `${vpn} (${tag})`;
};

/** Explains the greyed-out entries of the current run's charts, if it has any. */
export const NonMeshNote = () => {
  const { benchData } = useAlias();
  const nonMesh = () =>
    benchData()
      .flatMap((category) => {
        const kind = vpnKind(category.name);
        return kind === "mesh" ? [] : [{ vpn: category.name, kind }];
      })
      .sort((a, b) => a.vpn.localeCompare(b.vpn));
  return (
    <Show when={nonMesh().length > 0}>
      <p class="mb-4 text-sm text-gray-600">
        Greyed out as reference, not a mesh VPN:{" "}
        <For each={nonMesh()}>
          {(entry, i) => (
            <>
              {i() > 0 && "; "}
              <em>{entry.vpn}</em> is {NON_MESH_DESCRIPTION[entry.kind]}
            </>
          )}
        </For>
        .
      </p>
    </Show>
  );
};
