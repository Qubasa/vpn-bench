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
      type = types.enum [ "simple" "main" "advanced" ];
      default = "main";
      description = "RIST profile: simple (no retransmission), main (ARQ retransmission), advanced (bonding and tunneling)";
    };

    maxBandwidth = mkOption {
      type = types.int;
      default = 0;
      description = "Maximum sending bandwidth in bytes/sec. 0 means unlimited.";
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open UDP port in the firewall for RIST.";
    };  
  };

  imp = {
    environment.systemPackages = [ pkgs.ffmpeg-full ];

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

      serviceConfig = {
        Restart = "on-failure";
        RestartSec = 2;
        User = "rist-stream";
        Group = "rist-stream";
        WorkingDirectory = "/var/lib/rist-stream";

        # RIST receiver in listener mode, outputs to null (we just measure stats)
        ExecStart = ''
          ${pkgs.ffmpeg-full}/bin/ffmpeg \
            -loglevel info \
            -stats \
            -stats_period 1 \
            -i 'rist://@${cfg.address}:${toString cfg.port}' \
            -f null -
        '';

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
