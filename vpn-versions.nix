{ lock }:
let
  # `git describe --tags` of every pinned commit, as "<tag>+<commits since tag>".
  # Tags that are not releases are ignored (EasyTier's moving `nightly`, tincr's `assets`).
  # A commit with no reachable release tag is named by its short rev.
  describe = {
    "24e0303fc55e4e645a11818954dd5b712fb94510" = "v2.7.0+75";
    "c9cf210b8bc84d13177e18b91f555788a44b47b6" = "v0.29.7";
    "a0d0788b5934999a929cdfbaa769036f035bf118" = "v0.15.0+2";
    "af95abd80e56b71a08047bf17a870c8adaeafb20" = "v0.7.10";
    "fb4ef139cbb4af67d142c72083fb735f56460e50" = "v1.12.0";
    "3217d5efb432f5a03beebd5d00b36392ec4b22ef" = "release-1.1pre18";
    "09804a637976137793e8638670422ce8aebcec19" = "09804a6";
    "bef99162fe0d66e2c9fbf6421a69ca8ec2ac8f55" = "v2.3.0+11";
    "49ce333da02056ae7b22ee2aeb6afe8aaed79b19" = "v1.0.20260223";
    "2c7f050fc5398ecd8ac5f77e9bb5bd91aa2e9e35" = "v0.5.15";
    "27047635f237d1f3e0b08c0f487674757f30d2f7" = "v1.104.4";
    "fc5c3ec22090b5b2a0f274e863651fe9ca489bf4" = "1.16.2";
  };

  sourceUrl =
    locked:
    if locked.type == "github" then
      "https://github.com/${locked.owner}/${locked.repo}/tree/${locked.rev}"
    else if locked.type == "git" then
      "${locked.url}/tree/?id=${locked.rev}"
    else
      throw "vpn-versions.nix: no source URL for input type ${locked.type}";

  version =
    input:
    let
      locked = lock.nodes.${lock.nodes.root.inputs.${input}}.locked;
    in
    {
      inherit input;
      inherit (locked) rev;
      version =
        describe.${locked.rev}
          or (throw "vpn-versions.nix: add the git describe of ${input} ${locked.rev} to `describe`");
      url = sourceUrl locked;
    };
in
# Components of each VPN, the one carrying the traffic first.
builtins.mapAttrs (_: map version) {
  Easytier = [ "easytier" ];
  Headscale = [
    "tailscale"
    "headscale"
  ];
  Hyprspace = [ "hyprspace" ];
  Mycelium = [ "mycelium" ];
  Nebula = [ "nebula" ];
  Tinc = [ "tinc" ];
  Tincr = [ "tincr" ];
  VpnCloud = [ "vpncloud" ];
  Wireguard = [ "wireguard-tools" ];
  Yggdrasil = [ "yggdrasil" ];
  Zerotier = [ "zerotierone" ];
}
