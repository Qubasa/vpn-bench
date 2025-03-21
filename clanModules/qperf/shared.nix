{
  config,
  lib,
  pkgs,
  ...
}:
with lib;
let
  cfg = config.services.qperf;
  package = pkgs.callPackage ../../pkgs/qperf/default.nix { };

  api = {
    enable = mkEnableOption "qperf network throughput testing server";
    port = mkOption {
      type = types.ints.u16;
      default = 18080;
      description = "Server port to listen on for qperf client requests.";
    };
    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open ports in the firewall for qperf.";
    };
    serverCrt = mkOption {
      type = types.path;
      default = null;
      description = "Path to the RSA private key (not password-protected) used to decrypt authentication credentials from the client.";
    };
    serverKey = mkOption {
      type = types.path;
      default = null;
      description = "Path to the configuration file containing authorized users credentials to run iperf tests.";
    };
    extraFlags = mkOption {
      type = types.listOf types.str;
      default = [ ];
      description = "Extra flags to pass to qperf(1).";
    };
  };

  imp = {

  environment.systemPackages = [ package ];

  users.groups.qperf = { };
  users.users.qperf = {
    isSystemUser = true;
    group = "qperf";
    createHome = true;
    home = "/var/lib/qperf";
    homeMode = "0774";
  };

    networking.firewall = mkIf cfg.openFirewall {
      allowedUDPPorts = [ cfg.port ];
    };

    systemd.services.qperf = {
      description = "qperf daemon";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      serviceConfig = {
        Restart = "on-failure";
        RestartSec = 2;
        WorkingDirectory = "/var/lib/qperf";
        ExecStartPre = pkgs.writeScript "qperf-prepare" ''
          #!${pkgs.bash}/bin/bash
          set -xe
          export PATH=${pkgs.coreutils}/bin
          cp ${cfg.serverCrt} /var/lib/qperf/server.crt
          cp ${cfg.serverKey} /var/lib/qperf/server.key
        '';
        ExecStart = ''
          ${lib.getExe package} \
            -s \
            -p ${toString cfg.port} \
            ${escapeShellArgs cfg.extraFlags}
        '';
      };
    };
  };
in
{
  options.services.qperf = api;
  config = mkIf cfg.enable imp;
}