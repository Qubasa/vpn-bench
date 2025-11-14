{
  config,
  lib,
  pkgs,
  ...
}:
with lib;
let
  cfg = config.services.srt-stream;

  api = {
    enable = mkEnableOption "SRT video streaming receiver for benchmarking";

    port = mkOption {
      type = types.port;
      default = 40052;
      description = "UDP port to listen on for SRT streams";
    };

    address = mkOption {
      type = types.str;
      default = ":: ";
      description = "Server address to listen on for SRT streams. Default ipv6 any.";
    };

    latency = mkOption {
      type = types.int;
      default = 400;
      description = "SRT latency in milliseconds (packet delivery delay)";
    };

    maxBandwidth = mkOption {
      type = types.int;
      default = 0;
      description = "Maximum sending bandwidth in bytes/sec. 0 means unlimited.";
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open UDP port in the firewall for SRT.";
    };

    extraFlags = mkOption {
      type = types.listOf types.str;
      default = [ ];
      description = "Extra flags to pass to ffmpeg.";
    };
  };

  imp = {
    environment.systemPackages = [ pkgs.ffmpeg-full ];

    users.groups.srt-stream = { };
    users.users.srt-stream = {
      isSystemUser = true;
      group = "srt-stream";
      createHome = true;
      home = "/var/lib/srt-stream";
      homeMode = "0774";
    };

    networking.firewall = mkIf cfg.openFirewall {
      allowedUDPPorts = [ cfg.port ];
    };

    systemd.services.srt-stream = {
      description = "SRT video streaming receiver daemon";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      serviceConfig = {
        Restart = "on-failure";
        RestartSec = 2;
        User = "srt-stream";
        Group = "srt-stream";
        WorkingDirectory = "/var/lib/srt-stream";

        # SRT receiver in listener mode, outputs to null (we just measure stats)
        ExecStart = ''
          ${pkgs.ffmpeg-full}/bin/ffmpeg \
            -loglevel info \
            -stats \
            -stats_period 1 \
            -i 'srt://${cfg.address}:${toString cfg.port}?mode=listener&latency=${toString (cfg.latency * 1000)}&maxbw=${toString cfg.maxBandwidth}' \
            -f null \
            - \
            ${escapeShellArgs cfg.extraFlags}
        '';

        # Standard hardening
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ "/var/lib/srt-stream" ];
      };
    };
  };
in
{
  options.services.srt-stream = api;
  config = mkIf cfg.enable imp;
}
