{
  lib,
  pkgs,
  instanceName,
  settings,
  ipgenv6,
  interface,
  config,
}:

{

  services.nebula.networks."${interface}" = {
    enable = true;
    isLighthouse = true;
    key = config.clan.core.vars.generators."nebula-${instanceName}".files.node-crt.value;
    ca = config.clan.core.vars.generators."nebula-${instanceName}-ca".files.ca-crt.value;
  };

  clan.core.vars.generators."nebula-${instanceName}" = {
    files.node-key = {
      secret = true;
    };
    files.node-crt = {
      secret = true;
    };
    files.ip = {
      deploy = false;
      secret = false;
    };
    runtimeInputs = [
      pkgs.nebula
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
        -ip "$(cat $out/ip)/64" ${
          lib.optionalString (settings.groups != [ ]) (
            "-groups " + (lib.strings.concatStringsSep "," settings.groups)
          )
        }
    '';
  };
}
