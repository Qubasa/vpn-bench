{
  pkgs,
  interface,
  config,
}:
let
  ipgenv6 = pkgs.writers.writePython3Bin "ipgenv6" {
    libraries = [ ];
    doCheck = false;
  } (builtins.readFile ./ipgenv6.py);
in
{

  services.tinc.networks."${interface}" = {
    enable = true;
    ed25519PrivateKeyFile =
      config.clan.core.vars.generators."tinc-${interface}".files."edkey.priv".path;
    settings.Ed25519PublicKey =
      config.clan.core.vars.generators."tinc-${interface}".files."edkey.pub".value;
    hostSettings = {
      subnets = [
        {
          address = config.clan.core.vars.generators."tinc-${interface}-ula".files.network.value;
        }
      ];
    };
  };

  clan.core.vars.generators."tinc-${interface}-ula" = {
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

  clan.core.vars.generators."tinc-${interface}" = {
    files."edkey.pub" = {
      secret = false;
    };
    files."edkey.priv" = {
      secret = true;
      owner = "tinc-${interface}";
      group = "tinc-${interface}";
    };
    files.ip = {
      deploy = false;
      secret = false;
    };
    runtimeInputs = [
      pkgs.coreutils
      pkgs.gnused
      pkgs.gnugrep
      pkgs.openssh
      ipgenv6
    ];
    dependencies = [
      "tinc-${interface}-ula"
    ];
    script = ''
      ipgenv6 --prefix "$(cat $in/tinc-${interface}-ula/network)" | tr -d "\n" > "$out"/ip
      ssh-keygen -t ed25519 -f "$out"/key -N ""
    '';
  };
}
