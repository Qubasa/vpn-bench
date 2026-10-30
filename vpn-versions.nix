{ lock }:
let
  # `git describe --tags` of every pinned commit, as "<tag>+<commits since tag>".
  # A commit with no reachable tag is named by its short rev.
  describe = {
    "7aba65ea32d36588b64bbf19cb02142b1c72a859" = "v2.4.5+57";
    "450a7b15ec7b08926738e308bd11ec17753d06ab" = "v0.27.0";
    "a5957e485ff0c2e9133e7da5408ec1273681688e" = "v0.10.2+7";
    "a9ba23d7bd020411be51cd2359775f6f11b159e4" = "v0.6.1";
    "770147264da18f94e582a0b99ad08ed19c0ae9fb" = "v1.9.4+93";
    "3217d5efb432f5a03beebd5d00b36392ec4b22ef" = "release-1.1pre18";
    "b234dc798101a595adb121bab1c7cfe8cb2626a0" = "b234dc7";
    "bef99162fe0d66e2c9fbf6421a69ca8ec2ac8f55" = "v2.3.0+11";
    "e2ecaaa739144997ccff89d6ad6ec81698ea6ced" = "v1.0.20250521";
    "213f72b8403ff55a5e38a0fa7d1cd0a093ac4666" = "v0.5.12";
    "85f4267ee3bcf6a4e6b6d4384b66ee4cb33f1434" = "v1.88.4";
    "7b7d39becc4a775d33e8c0f673856fb91dea7f31" = "1.16.0";
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
