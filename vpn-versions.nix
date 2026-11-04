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

  lockedInput = input: lock.nodes.${lock.nodes.root.inputs.${input}}.locked;

  # Where a file of a linked tree can be read online: `{path}` is the file inside the tree,
  # `lines` the line-anchor style of the site.
  fileLink = url: lines: {
    kind = "file";
    inherit url lines;
  };

  inputFileLink =
    locked:
    if locked.type == "github" then
      fileLink "https://github.com/${locked.owner}/${locked.repo}/blob/${locked.rev}/{path}" "github"
    else if locked.type == "git" then
      fileLink "${locked.url}/tree/{path}?id=${locked.rev}" "cgit"
    else
      throw "vpn-versions.nix: no file URL for input type ${locked.type}";

  inputVersion =
    input:
    let
      locked = lockedInput input;
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

  linuxFileLink = fileLink "https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/tree/{path}?h=v${kernel.version}" "cgit";

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
  # and patched source of every C library the package links, each with its online link.
  dependencies =
    pkg:
    lib.optionalAttrs (pkg ? goModules) {
      go-modules = {
        path = pkg.goModules;
        link.kind = "go-modules";
      };
      go-stdlib = {
        path = linkTo "go-${pkg.go.version}-stdlib-src" "${pkg.go}/share/go/src";
        link = fileLink "https://github.com/golang/go/blob/go${pkg.go.version}/src/{path}" "github";
      };
    }
    // lib.optionalAttrs (pkg ? cargoDeps) { cargo-vendor = cargoVendor pkg.cargoDeps; }
    // lib.optionalAttrs (pkg ? cargoVendorDir) { cargo-vendor = cargoVendor pkg.cargoVendorDir; }
    // lib.listToAttrs (
      map (
        dep:
        lib.nameValuePair (lib.getName dep) {
          path = pkgs.srcOnly dep.out;
          link = {
            kind = "archive";
            url = dep.src.url or (throw "vpn-versions.nix: no source URL for ${dep.name}");
          };
        }
      ) (builtins.filter (dep: dep ? src) (pkg.buildInputs or [ ]))
    );

  cargoVendor = path: {
    inherit path;
    link.kind = "cargo-vendor";
  };

  componentEntries =
    input:
    let
      c = component.${input};
    in
    {
      "src/${input}" = {
        path = c.src;
        link = if input == "linux" then linuxFileLink else inputFileLink (lockedInput input);
      };
    }
    // lib.mapAttrs' (name: entry: lib.nameValuePair "deps/${input}/${name}" entry) (
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
  # `deps/<input>/<name>` to the source of each dependency, and `links.json` maps each
  # of them to where its files can be read online.
  sources = builtins.mapAttrs (
    vpn: inputNames:
    let
      entries = lib.mergeAttrsList (map componentEntries inputNames);
    in
    pkgs.linkFarm "${vpn}-sources" (
      lib.mapAttrs (_: entry: entry.path) entries
      // {
        "links.json" = pkgs.writeText "${vpn}-links.json" (
          builtins.toJSON (lib.mapAttrs (_: entry: entry.link) entries)
        );
      }
    )
  ) components;
}
