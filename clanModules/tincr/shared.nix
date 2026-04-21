{
  lib,
  pkgs,
  instanceName,
  roles,
  config,
  tincr,
  ...
}:
let

  getInterface = instanceName: lib.substring 0 15 instanceName;
  interface = getInterface instanceName;

  tincd = tincr.packages.${pkgs.hostPlatform.system}.tincd;

  ipgenv6 = pkgs.writers.writePython3Bin "ipgenv6" {
    libraries = [ ];
    doCheck = false;
  } (builtins.readFile ./ipgenv6.py);

  ipPath =
    name:
    "${config.clan.core.settings.directory}/vars/per-machine/${name}/tincr-${instanceName}/ip/value";

  readFileIfExists = path: if builtins.pathExists path then builtins.readFile path else "";

  edPubKeyPath =
    name:
    "${config.clan.core.settings.directory}/vars/per-machine/${name}/tincr-${instanceName}/ed25519_key.pub/value";

  allMachines = (roles.peer.machines or { }) // (roles.bootstrap.machines or { });

  isBootstrap = machineName: roles.bootstrap.machines ? ${machineName};
in
{
  systemd.services."tinc.${interface}".serviceConfig.Slice = "benchmark.slice";

  environment.systemPackages = [ tincd ];

  services.tinc.networks."${interface}" = {
    package = tincd;

    # tincr is Ed25519-only. `rsaPrivateKeyFile = null` keeps
    # `PrivateKeyFile` out of tinc.conf; preStart still calls
    # `tinc generate-rsa-keys 4096`, which is a no-op stub in tincr.
    rsaPrivateKeyFile = null;

    ed25519PrivateKeyFile =
      config.clan.core.vars.generators."tincr-${interface}".files."ed25519_key.priv".path;

    settings.StrictSubnets = "yes";

    hostSettings = lib.mapAttrs' (machineName: machine: {
      name = machineName;
      value = {
        settings.Ed25519PublicKey = readFileIfExists (edPubKeyPath machineName);

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
        config.clan.core.vars.generators."tincr-${interface}".files.ip.value
      }/128" dev $INTERFACE
      ${pkgs.iproute2}/bin/ip -6 route add "${
        config.clan.core.vars.generators."tincr-${interface}-ula".files.network.value
      }" dev $INTERFACE
    '';

    "tinc/${interface}/tinc-down".source = pkgs.writeScript "tinc-down" ''
      #!${pkgs.stdenv.shell}
      ${pkgs.iproute2}/bin/ip l set dev $INTERFACE down
    '';
  };

  assertions = [
    {
      assertion = lib.length (builtins.attrNames (roles.bootstrap.machines or { })) != 0;
      message = "The tincr service instance '${instanceName}' requires at least one machine with the 'bootstrap' role.";
    }
  ];

  networking.firewall = {
    allowedTCPPorts = [ 655 ];
    allowedUDPPorts = [ 655 ];
  };

  clan.core.vars.generators."tincr-${interface}-ula" = {
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

  clan.core.vars.generators."tincr-${interface}" = {
    files."ed25519_key.priv" = {
      restartUnits = [ "tinc.${interface}.service" ];
    };
    files."ed25519_key.pub".secret = false;
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
      tincd
    ];
    dependencies = [
      "tincr-${interface}-ula"
    ];

    # sptps_keypair writes a PEM-wrapped public key; the NixOS tinc
    # module expects `Ed25519PublicKey = <43-char b64>`, so strip the
    # armor and keep the body line only.
    script = ''
      ipgenv6 --prefix "$(cat "$in"/tincr-${interface}-ula/network)" | tr -d "\n" > "$out"/ip
      sptps_keypair "$out"/ed25519_key.priv pub.pem
      grep -v '^-----' pub.pem | tr -d '\n' > "$out"/ed25519_key.pub
    '';
  };
}
