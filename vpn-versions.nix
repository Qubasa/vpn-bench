{
  lock,
  inputs,
  packages,
}:
let
  # The bench machines are x86_64-linux and use the clan's nixpkgs, which follows ours.
  pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
  inherit (pkgs) lib;
  kernel = pkgs.linuxPackages.kernel;

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

  inputVersion =
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

  linuxVersion = {
    input = "linux";
    rev = "v${kernel.version}";
    inherit (kernel) version;
    url = "https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/tree/drivers/net/wireguard?h=v${kernel.version}";
  };

  # The WireGuard module and the kernel crypto it calls, without the rest of the kernel tree.
  wireguardKernelSrc = pkgs.runCommand "linux-${kernel.version}-wireguard-src" { } ''
    mkdir -p $out
    tar -xf ${kernel.src} -C $out --strip-components=1 --wildcards \
      'linux-*/drivers/net/wireguard' \
      'linux-*/lib/crypto' \
      'linux-*/arch/x86/crypto' \
      'linux-*/include/crypto' \
      'linux-*/include/net/udp_tunnel.h' \
      'linux-*/include/uapi/linux/wireguard.h' \
      'linux-*/net/ipv4/udp_tunnel_core.c' \
      'linux-*/net/ipv6/ip6_udp_tunnel.c'
  '';

  pkgsX86 = packages.x86_64-linux;

  # Source tree and the package whose build inputs are its dependencies.
  component = {
    easytier = {
      src = inputs.easytier;
      pkg = pkgsX86.easytier;
    };
    headscale = {
      src = inputs.headscale;
      pkg = pkgsX86.headscale;
    };
    hyprspace = {
      src = inputs.hyprspace;
      pkg = inputs.hyprspace.packages.x86_64-linux.hyprspace;
    };
    linux = {
      src = wireguardKernelSrc;
      pkg = null;
    };
    mycelium = {
      src = inputs.mycelium;
      pkg = pkgsX86.mycelium;
    };
    nebula = {
      src = inputs.nebula;
      pkg = pkgsX86.nebula;
    };
    tailscale = {
      src = inputs.tailscale;
      pkg = pkgsX86.tailscale;
    };
    tinc = {
      src = inputs.tinc;
      pkg = pkgsX86.tinc;
    };
    tincr = {
      src = inputs.tincr;
      pkg = inputs.tincr.packages.x86_64-linux.tincd;
    };
    vpncloud = {
      src = inputs.vpncloud;
      pkg = pkgsX86.vpncloud;
    };
    wireguard-tools = {
      src = inputs.wireguard-tools;
      pkg = pkgsX86.wireguard-tools;
    };
    yggdrasil = {
      src = inputs.yggdrasil;
      pkg = pkgsX86.yggdrasil;
    };
    zerotierone = {
      src = inputs.zerotierone;
      pkg = pkgsX86.zerotierone;
    };
  };

  # A store path holding a symlink, so a subdirectory of an output can be linked by name.
  linkTo = name: path: pkgs.runCommand name { } "ln -s ${path} $out";

  # Vendored Go modules and Go standard library, vendored crates, and the unpacked
  # and patched source of every C library the package links.
  dependencies =
    pkg:
    lib.optionalAttrs (pkg ? goModules) {
      go-modules = pkg.goModules;
      go-stdlib = linkTo "go-${pkg.go.version}-stdlib-src" "${pkg.go}/share/go/src";
    }
    // lib.optionalAttrs (pkg ? cargoDeps) { cargo-vendor = pkg.cargoDeps; }
    // lib.optionalAttrs (pkg ? cargoVendorDir) { cargo-vendor = pkg.cargoVendorDir; }
    // lib.listToAttrs (
      map (dep: lib.nameValuePair (lib.getName dep) (pkgs.srcOnly dep.out)) (
        builtins.filter (dep: dep ? src) (pkg.buildInputs or [ ])
      )
    );

  componentLinks =
    input:
    let
      c = component.${input};
    in
    {
      "src/${input}" = c.src;
    }
    // lib.mapAttrs' (name: path: lib.nameValuePair "deps/${input}/${name}" path) (
      if c.pkg == null then { } else dependencies c.pkg
    );

  # Components of each VPN, the one carrying the traffic first.
  components = {
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
    Wireguard = [
      "linux"
      "wireguard-tools"
    ];
    Yggdrasil = [ "yggdrasil" ];
    Zerotier = [ "zerotierone" ];
  };
in
{
  versions = builtins.mapAttrs (
    _: map (input: if input == "linux" then linuxVersion else inputVersion input)
  ) components;

  # One folder per VPN: `src/<input>` links to the source nix builds the VPN from,
  # `deps/<input>/<name>` to the source of each dependency.
  sources = builtins.mapAttrs (
    vpn: inputNames: pkgs.linkFarm "${vpn}-sources" (lib.mergeAttrsList (map componentLinks inputNames))
  ) components;
}
