{
  config,
  lib,
  vpncloud,
  ...
}:
with lib;
let
  cfg = config.services.vpncloud;
  package = vpncloud;

  api = {
    enable = mkEnableOption "vpncloud network throughput testing server";
    privateKey = mkOption {
      type = types.path;
      description = "Path to the private key file.";
    };
    publicKey = mkOption {
      type = types.path;
      description = "Path to the private key file.";
    };
  };

  imp = {
    environment.systemPackages = [ package ];

    networking.firewall = [ ];

    systemd.targets.vpncloud = {
      description = "VpnCloud target allowing to start/stop all vpncloud@.service instances at once";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
    };

    systemd.services."vpncloud@" = {
      description = "VpnCloud network '%I'";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      partOf = [ "vpncloud.target" ];

      serviceConfig = {
        Type = "forking";
        ExecStart = ''
          ${lib.getExe package} \
            --private-key "${cfg.privateKey}" \
            --public-key "${cfg.publicKey}" \
            --log-file "/var/log/vpncloud-%i.log" \
            --stats-file "/var/log/vpncloud-%i.stats" \
            --daemon \
            --pid-file "/run/vpncloud-%i.pid"
        '';
        WorkingDirectory = "/etc/vpncloud";
        RestartSec = 5;
        Restart = "on-failure";
        TasksMax = 10;
        MemoryMax = "50M";
        PrivateTmp = "yes";
        ProtectHome = "yes";
        ProtectSystem = "strict";
        ReadWritePaths =
          [
            "/var/log"
            "/run"
            "/nix/store"
          ]
          ++ [
            cfg.privateKey
            cfg.publicKey
          ];
        CapabilityBoundingSet = [
          "CAP_NET_ADMIN"
          "CAP_NET_BIND_SERVICE"
          "CAP_NET_RAW"
          "CAP_SETGID"
          "CAP_SETUID"
          "CAP_SYS_CHROOT"
        ];

        DeviceAllow = [
          "/dev/null rw"
          "/dev/net/tun rw"
        ];
        PIDFile = "/run/vpncloud-%i.pid";
      };
    };
  };
in
{
  options.services.vpncloud = api;
  config = mkIf cfg.enable imp;
}
