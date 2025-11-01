{
  lib,
  pkgs,
  instanceName,
  roles,
  config,
  ...
}:
let

  getInterface = instanceName: lib.substring 0 15 instanceName;
  interface = getInterface instanceName;

  ipgenv6 = pkgs.writers.writePython3Bin "ipgenv6" {
    libraries = [ ];
    doCheck = false;
  } (builtins.readFile ./ipgenv6.py);

  ipPath =
    name:
    "${config.clan.core.settings.directory}/vars/per-machine/${name}/tinc-${instanceName}/ip/value";

  readFileIfExists = path: if builtins.pathExists path then builtins.readFile path else "";

  edPubKeyPath =
    name:
    "${config.clan.core.settings.directory}/vars/per-machine/${name}/tinc-${instanceName}/ed25519_key.pub/value";

  rsaPubKeyPath =
    name:
    "${config.clan.core.settings.directory}/vars/per-machine/${name}/tinc-${instanceName}/rsa_key.pub/value";

  allMachines = (roles.peer.machines or { }) // (roles.bootstrap.machines or { });

  isBootstrap = machineName: roles.bootstrap.machines ? ${machineName};
in
{
  environment.systemPackages = with pkgs; [ tinc_pre ];
  services.tinc.networks."${interface}" = {
    ed25519PrivateKeyFile =
      config.clan.core.vars.generators."tinc-${interface}".files."ed25519_key.priv".path;

    rsaPrivateKeyFile = config.clan.core.vars.generators."tinc-${interface}".files."rsa_key.priv".path;

    settings.StrictSubnets = "yes";
    # settings.LocalDiscovery = "yes";

    hostSettings = lib.mapAttrs' (machineName: machine: {
      name = machineName;
      value = {
        settings.Ed25519PublicKey = readFileIfExists (edPubKeyPath machineName);
        rsaPublicKey = readFileIfExists (rsaPubKeyPath machineName);

        addresses = lib.optionals (isBootstrap machineName) [
          {
            address = machine.settings.publicAddress;
            port = machine.settings.port;
          }
        ];

        subnets = [
          {
            address = readFileIfExists (ipPath machineName);
          }
        ];
      };
    }) allMachines;
  };

  environment.etc = {
    "tinc/${interface}/tinc-up".source = pkgs.writeScript "tinc-up-${interface}" ''
      #!${pkgs.stdenv.shell}
      ${pkgs.iproute2}/bin/ip l set dev $INTERFACE up
      ${pkgs.iproute2}/bin/ip a add "${
        config.clan.core.vars.generators."tinc-${interface}".files.ip.value
      }/128" dev $INTERFACE
      ip -6 route add ${
        config.clan.core.vars.generators."tinc-${interface}-ula".files.network.value
      } dev $INTERFACE
    '';

    "tinc/${interface}/tinc-down".source = pkgs.writeScript "tinc-down" ''
      #!${pkgs.stdenv.shell}
      ${pkgs.iproute2}/bin/ip l set dev $INTERFACE down
    '';
  };

  assertions = [
    {
      assertion = lib.length (builtins.attrNames (roles.bootstrap.machines or { })) != 0;
      message = "The Tinc service instance '${instanceName}' requires at least one machine with the 'bootstrap' role.";
    }
  ];

  networking.firewall = {
    allowedTCPPorts = [ 655 ];
    allowedUDPPorts = [ 655 ];
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
    files."ed25519_key.priv" = {
      restartUnits = [ "tinc.${interface}.service" ];
    };
    files."ed25519_key.pub".secret = false;
    files."rsa_key.priv".secret = true;
    files."rsa_key.pub".secret = false;
    files.ip = {
      deploy = false;
      secret = false;
      restartUnits = [ "tinc.${interface}.service" ];
    };
    runtimeInputs = [
      pkgs.coreutils
      pkgs.gnused
      pkgs.gnugrep
      ipgenv6
      pkgs.tinc_pre
    ];
    dependencies = [
      "tinc-${interface}-ula"
    ];

    script = ''
      ipgenv6 --prefix "$(cat $in/tinc-${interface}-ula/network)" | tr -d "\n" > "$out"/ip
      tinc --config "." generate-keys 4096 2>&1 > /dev/null
      mv ed25519_key.priv "$out"/ed25519_key.priv
      cat ed25519_key.pub | sed 's/^[^=]*=[[:space:]]*//' > "$out"/ed25519_key.pub
      mv rsa_key.priv "$out"/rsa_key.priv
      mv rsa_key.pub "$out"/rsa_key.pub
    '';
  };
}
