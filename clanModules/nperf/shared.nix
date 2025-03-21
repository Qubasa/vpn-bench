{
  config,
  lib,
  pkgs,
  ...
}:
with lib;
let
  cfg = config.services.nperf;
  package = pkgs.callPackage ../../pkgs/nperf/default.nix { };

  api = {
    enable = mkEnableOption "nperf network throughput testing server";
    port = mkOption {
      type = types.ints.u16;
      default = 28080;
      description = "Server port to listen on for nperf client requests.";
    };
    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open ports in the firewall for nperf.";
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
      description = "Extra flags to pass to nperf(1).";
    };
  };

  imp = {

  environment.systemPackages = [ package ];

  users.groups.nperf = { };
  users.users.nperf = {
    isSystemUser = true;
    group = "nperf";
    createHome = true;
    home = "/var/lib/nperf";
    homeMode = "0774";
  };

    networking.firewall = mkIf cfg.openFirewall {
      allowedUDPPorts = [ cfg.port ];
      allowedTCPPorts = [ cfg.port ];
    };

    systemd.services.nperf = {
      description = "nperf daemon";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      serviceConfig = {
        Restart = "on-failure";
        RestartSec = 2;
        WorkingDirectory = "/var/lib/nperf";
         ExecStartPre = pkgs.writeScript "nperf-prepare" ''
          #!${pkgs.bash}/bin/bash
          set -xe
          export PATH=${pkgs.coreutils}/bin
          cp ${cfg.serverCrt} /var/lib/nperf/cert.crt
          cp ${cfg.serverKey} /var/lib/nperf/cert.key
        '';
        ExecStart = ''
          ${lib.getExe package} \
            -s \
            -q \
            -p ${toString cfg.port} \
            ${escapeShellArgs cfg.extraFlags}
        '';
      };
    };
  };
in
{
  options.services.nperf = api;
  config = mkIf cfg.enable imp;
}