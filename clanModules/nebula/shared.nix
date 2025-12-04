{
  lib,
  pkgs,
  instanceName,
  settings,
  ipgenv6,
  interface,
  config,
  nebula-src,
}:

let
  nebulaPkg = pkgs.callPackage ./package.nix { inherit nebula-src; };
in
{
  systemd.services."nebula@${interface}".serviceConfig.Slice = "benchmark.slice";

  services.nebula.networks."${interface}" = {
    enable = true;
    package = nebulaPkg;
    key = config.clan.core.vars.generators."nebula-${instanceName}".files.node-key.path;
    cert = config.clan.core.vars.generators."nebula-${instanceName}".files.node-crt.path;
    ca = config.clan.core.vars.generators."nebula-${instanceName}-ca".files.ca-crt.path;

    firewall.inbound = [
      {
        host = "any";
        port = "any";
        proto = "any";
      }
    ];
    firewall.outbound = [
      {
        host = "any";
        port = "any";
        proto = "any";
      }
    ];
  };
  clan.core.vars.generators."nebula-${instanceName}-ca" = {
    files.ca-key = {
      secret = true;
      deploy = false;
    };
    files.ca-crt = {
      secret = true;
      owner = "nebula-${instanceName}";
      group = "nebula-${instanceName}";
    };
    share = true;
    runtimeInputs = [
      nebulaPkg
    ];
    script = ''
      nebula-cert ca -name "${instanceName}" \
        -out-crt "$out"/ca-crt \
        -out-key "$out"/ca-key \
        -duration 867240h # 99 years
    '';
  };

  clan.core.vars.generators."nebula-${instanceName}-ula" = {
    files.network = {
      secret = false;
      deploy = false;
    };
    share = true;
    runtimeInputs = [
      ipgenv6
      pkgs.coreutils
    ];

    script = ''
      ipgenv6 --generate-prefix | tr -d "\n" > "$out"/network
    '';
  };

  clan.core.vars.generators."nebula-${instanceName}" = {
    files.node-key = {
      secret = true;
      owner = "nebula-${instanceName}";
      group = "nebula-${instanceName}";
      restartUnits = [ "nebula@${interface}.service" ];
    };
    files.node-crt = {
      secret = true;
      owner = "nebula-${instanceName}";
      group = "nebula-${instanceName}";
    };
    files.ip = {
      deploy = false;
      secret = false;
      restartUnits = [ "nebula@${interface}.service" ];
    };
    runtimeInputs = [
      nebulaPkg
      pkgs.coreutils
      pkgs.gnused
      pkgs.gnugrep
      ipgenv6
    ];
    dependencies = [
      "nebula-${instanceName}-ca"
      "nebula-${instanceName}-ula"
    ];

    script = ''
      ipgenv6 --prefix "$(cat $in/nebula-${instanceName}-ula/network)" | tr -d "\n" > "$out"/ip
      nebula-cert sign -name "${instanceName}" \
        -ca-key "$in/nebula-${instanceName}-ca/ca-key" \
        -ca-crt "$in/nebula-${instanceName}-ca/ca-crt" \
        -out-crt "$out"/node-crt \
        -out-key "$out"/node-key \
        -version 2 \
        -ip "$(cat $out/ip)/64" ${
          lib.optionalString (settings.groups != [ ]) (
            "-groups " + (lib.strings.concatStringsSep "," settings.groups)
          )
        }
    '';
  };
}
