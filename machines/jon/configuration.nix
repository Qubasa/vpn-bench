{ config, ... }:
let
  username = config.networking.hostName;
in
{
  imports = [ ./hardware-configuration.nix ];

  users.users.${username} = {
    initialPassword = username;
    isNormalUser = true;
    extraGroups = [
      "wheel"
      "networkmanager"
      "video"
      "audio"
      "input"
      "dialout"
      "disk"
    ];
    uid = 1000;
    openssh.authorizedKeys.keys = config.users.users.root.openssh.authorizedKeys.keys;
  };
}
