{
  config,
  lib,
  pkgs,
  ...
}:
with lib;
let
  cfg = config.services.rist-stream;

  api = {
    enable = mkEnableOption "RIST video streaming receiver for benchmarking";

    port = mkOption {
      type = types.port;
      default = 40052;
      description = "UDP port to listen on for RIST streams";
    };

    address = mkOption {
      type = types.str;
      default = "[::]";
      description = "Server address to listen on for RIST streams. Default is all interfaces (IPv4 and IPv6).";
    };

    buffer = mkOption {
      type = types.int;
      default = 400;
      description = "RIST buffer size in milliseconds (affects latency and recovery capability)";
    };

    profile = mkOption {
      type = types.enum [
        "simple"
        "main"
        "advanced"
      ];
      default = "main";
      description = "RIST profile: simple (no retransmission), main (ARQ retransmission), advanced (bonding and tunneling)";
    };

    maxBandwidth = mkOption {
      type = types.int;
      default = 0;
      description = "Maximum sending bandwidth in bytes/sec. 0 means unlimited.";
    };

    statsInterval = mkOption {
      type = types.int;
      default = 1000;
      description = "Interval in milliseconds at which RIST statistics are printed";
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open UDP port in the firewall for RIST.";
    };
  };

  # Map profile name to ristreceiver profile number
  profileNumber = {
    simple = 0;
    main = 1;
    advanced = 2;
  };

  imp = {
    environment.systemPackages = [ pkgs.librist ];

    users.groups.rist-stream = { };
    users.users.rist-stream = {
      isSystemUser = true;
      group = "rist-stream";
      createHome = true;
      home = "/var/lib/rist-stream";
      homeMode = "0774";
    };

    networking.firewall = mkIf cfg.openFirewall {
      allowedUDPPorts = [ cfg.port ];
    };

    systemd.services.rist-stream = {
      description = "RIST video streaming receiver daemon";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      # RIST receiver using ristreceiver from librist
      # Outputs to a local UDP sink (no listener needed) and prints stats to stderr
      script = ''
        exec ${pkgs.librist}/bin/ristreceiver \
          -i 'rist://@${cfg.address}:${toString cfg.port}?buffer=${toString cfg.buffer}' \
          -o 'udp://127.0.0.1:1234' \
          -S ${toString cfg.statsInterval} \
          -p ${toString profileNumber.${cfg.profile}} \
          -v 6
      '';

      serviceConfig = {
        Slice = "benchmark.slice";
        Restart = "on-failure";
        RestartSec = 2;
        User = "rist-stream";
        Group = "rist-stream";
        WorkingDirectory = "/var/lib/rist-stream";

        # Standard hardening
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ "/var/lib/rist-stream" ];
      };
    };
  };
in
{
  options.services.rist-stream = api;
  config = mkIf cfg.enable imp;
}
