{ clan-core, ... }:
{
  imports = [
    clan-core.clanModules.sshd
    clan-core.clanModules.root-password
  ];

  nixpkgs.hostPlatform = "x86_64-linux";


  # You can get your disk id by running the following command on the installer:
  # Replace <IP> with the IP of the installer printed on the screen or by running the `ip addr` command.
  # ssh root@<IP> lsblk --output NAME,ID-LINK,FSTYPE,SIZE,MOUNTPOINT
  disko.devices.disk.main = {
    device = "/dev/sda";
  };

  users.users.root.openssh.authorizedKeys.keys = [ "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDB0d0JA20Vqn7I4lCte6Ne2EOmLZyMJyS9yIKJYXNLjbLwkQ4AYoQKantPBkTxR75M09E7d3j5heuWnCjWH45TrfQfe1EOSSC3ppCI6C6aIVlaNs+KhAYZS0m2Y8WkKn+TT5JLEa8yybYVN/RlZPOilpj/1QgjU6CQK+eJ1k/kK+QFXcwN82GDVh5kbTVcKUNp2tiyxFA+z9LY0xFDg/JHif2ROpjJVLQBJ+YPuOXZN5LDnVcuyLWKThjxy5srQ8iDjoxBg7dwLHjby5Mv41K4W61Gq6xM53gDEgfXk4cQhJnmx7jA/pUnsn2ZQDeww3hcc7vRf8soogXXz2KC9maiq0M/svaATsa9Ul4hrKnqPZP9Q8ScSEAUX+VI+x54iWrnW0p/yqBiRAzwsczdPzaQroUFTBxrq8R/n5TFdSHRMX7fYNOeVMjhfNca/gtfw9dYBVquCvuqUuFiRc0I7yK44rrMjjVQRcAbw6F8O7+04qWCmaJ8MPlmApwu2c05VMv9hiJo5p6PnzterRSLCqF6rIdhSnuOwrUIt1s/V+EEZXHCwSaNLaQJnYL0H9YjaIuGz4c8kVzxw4c0B6nl+hqW5y5/B2cuHiumnlRIDKOIzlv8ufhh21iN7QpIsPizahPezGoT1XqvzeXfH4qryo8O4yTN/PWoA+f7o9POU7L6hQ== lhebendanz@nixos
" ];
}
