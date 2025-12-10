# Phantun clan service - UDP to fake TCP tunnel
# Server: listens on TCP and forwards to local UDP
# Client: connects to TCP server and exposes local UDP
{ packages }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "phantun";
  manifest.description = "Transforms UDP stream into (fake) TCP streams to bypass UDP blocking";
  manifest.categories = [ "Utility" ];

  roles.server = {
    description = "Phantun server that listens on TCP and forwards to local UDP service";
    interface.options = {
      listenPort = lib.mkOption {
        type = lib.types.port;
        description = "TCP port to listen on for fake TCP connections";
        example = 4567;
      };

      remoteUdp = lib.mkOption {
        type = lib.types.str;
        description = "Local UDP address:port to forward packets to";
        example = "127.0.0.1:51820";
      };

      tun = lib.mkOption {
        type = lib.types.str;
        default = "tun0";
        description = "TUN interface name";
      };

      tunLocalAddress = lib.mkOption {
        type = lib.types.str;
        default = "192.168.201.1";
        description = "Local IPv4 address for TUN interface";
      };

      tunPeerAddress = lib.mkOption {
        type = lib.types.str;
        default = "192.168.201.2";
        description = "Peer IPv4 address for TUN interface";
      };

      tunLocalAddress6 = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "fcc9::1";
        description = "Local IPv6 address for TUN interface";
      };

      tunPeerAddress6 = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "fcc9::2";
        description = "Peer IPv6 address for TUN interface";
      };

      interface = lib.mkOption {
        type = lib.types.str;
        description = "Network interface for incoming connections";
        example = "eth0";
      };
    };

    perInstance =
      {
        instanceName,
        settings,
        ...
      }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:
          let
            phantun = packages.${pkgs.hostPlatform.system}.phantun;
          in
          {
            boot.kernel.sysctl."net.ipv4.ip_forward" = 1;

            systemd.services."phantun-server-${instanceName}" = {
              description = "Phantun Server (${instanceName})";
              after = [ "network.target" ];
              wantedBy = [ "multi-user.target" ];

              serviceConfig = {
                Type = "simple";
                Slice = "benchmark.slice";
                ExecStart =
                  let
                    args = [
                      "--local"
                      (toString settings.listenPort)
                      "--remote"
                      settings.remoteUdp
                      "--tun"
                      settings.tun
                      "--tun-local"
                      settings.tunLocalAddress
                      "--tun-peer"
                      settings.tunPeerAddress
                    ]
                    ++ lib.optionals (settings.tunLocalAddress6 != null) [
                      "--tun-local6"
                      settings.tunLocalAddress6
                    ]
                    ++ lib.optionals (settings.tunPeerAddress6 != null) [
                      "--tun-peer6"
                      settings.tunPeerAddress6
                    ];
                  in
                  "${phantun}/bin/server ${lib.escapeShellArgs args}";
                Restart = "on-failure";
                RestartSec = 5;

                # Security hardening
                AmbientCapabilities = [ "CAP_NET_ADMIN" ];
                CapabilityBoundingSet = [ "CAP_NET_ADMIN" ];
                DynamicUser = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                NoNewPrivileges = true;
              };

              environment.RUST_LOG = "info";
            };

            # Firewall rules for server - DNAT incoming TCP to TUN
            networking.nftables.tables."phantun-server-${instanceName}" =
              lib.mkIf config.networking.nftables.enable
                {
                  family = "inet";
                  content = ''
                    chain prerouting {
                      type nat hook prerouting priority dstnat; policy accept;
                      iifname "${settings.interface}" tcp dport ${toString settings.listenPort} dnat ip to ${settings.tunPeerAddress}
                      ${lib.optionalString (settings.tunPeerAddress6 != null) ''
                        iifname "${settings.interface}" tcp dport ${toString settings.listenPort} dnat ip6 to ${settings.tunPeerAddress6}
                      ''}
                    }
                  '';
                };

            # Open firewall port for server
            networking.firewall.allowedTCPPorts = [ settings.listenPort ];
          };
      };
  };

  roles.client = {
    description = "Phantun client that connects to TCP server and exposes local UDP";
    interface.options = {
      localUdp = lib.mkOption {
        type = lib.types.str;
        description = "Local UDP address:port to expose";
        example = "127.0.0.1:51820";
      };

      remoteAddress = lib.mkOption {
        type = lib.types.str;
        description = "Remote phantun server address:port";
        example = "example.com:4567";
      };

      tun = lib.mkOption {
        type = lib.types.str;
        default = "tun0";
        description = "TUN interface name";
      };

      tunLocalAddress = lib.mkOption {
        type = lib.types.str;
        default = "192.168.200.1";
        description = "Local IPv4 address for TUN interface";
      };

      tunPeerAddress = lib.mkOption {
        type = lib.types.str;
        default = "192.168.200.2";
        description = "Peer IPv4 address for TUN interface";
      };

      tunLocalAddress6 = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "fcc8::1";
        description = "Local IPv6 address for TUN interface";
      };

      tunPeerAddress6 = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "fcc8::2";
        description = "Peer IPv6 address for TUN interface";
      };

      interface = lib.mkOption {
        type = lib.types.str;
        description = "Network interface for outgoing connections";
        example = "eth0";
      };
    };

    perInstance =
      {
        instanceName,
        settings,
        ...
      }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:
          let
            phantun = packages.${pkgs.hostPlatform.system}.phantun;
          in
          {
            boot.kernel.sysctl."net.ipv4.ip_forward" = 1;

            systemd.services."phantun-client-${instanceName}" = {
              description = "Phantun Client (${instanceName})";
              after = [ "network.target" ];
              wantedBy = [ "multi-user.target" ];

              serviceConfig = {
                Type = "simple";
                Slice = "benchmark.slice";
                ExecStart =
                  let
                    args = [
                      "--local"
                      settings.localUdp
                      "--remote"
                      settings.remoteAddress
                      "--tun"
                      settings.tun
                      "--tun-local"
                      settings.tunLocalAddress
                      "--tun-peer"
                      settings.tunPeerAddress
                    ]
                    ++ lib.optionals (settings.tunLocalAddress6 != null) [
                      "--tun-local6"
                      settings.tunLocalAddress6
                    ]
                    ++ lib.optionals (settings.tunPeerAddress6 != null) [
                      "--tun-peer6"
                      settings.tunPeerAddress6
                    ];
                  in
                  "${phantun}/bin/client ${lib.escapeShellArgs args}";
                Restart = "on-failure";
                RestartSec = 5;

                # Security hardening
                AmbientCapabilities = [ "CAP_NET_ADMIN" ];
                CapabilityBoundingSet = [ "CAP_NET_ADMIN" ];
                DynamicUser = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                NoNewPrivileges = true;
              };

              environment.RUST_LOG = "info";
            };

            # Firewall rules for client - MASQUERADE outgoing from TUN
            networking.nftables.tables."phantun-client-${instanceName}" =
              lib.mkIf config.networking.nftables.enable
                {
                  family = "inet";
                  content = ''
                    chain postrouting {
                      type nat hook postrouting priority srcnat; policy accept;
                      iifname "${settings.tun}" oifname "${settings.interface}" masquerade
                    }
                  '';
                };
          };
      };
  };
}
