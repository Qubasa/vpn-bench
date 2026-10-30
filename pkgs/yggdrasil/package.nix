{
  lib,
  buildGoModule,

  yggdrasil-src,
}:

buildGoModule rec {
  pname = "yggdrasil";
  version = "0.5.12";

  src = yggdrasil-src;

  vendorHash = "sha256-xZpUWIR3xTjhhNSwPoHx7GLUgcZJrWfF0FMExlluBmg=";

  subPackages = [
    "cmd/genkeys"
    "cmd/yggdrasil"
    "cmd/yggdrasilctl"
  ];

  ldflags = [
    "-X github.com/yggdrasil-network/yggdrasil-go/src/version.buildVersion=${version}"
    "-X github.com/yggdrasil-network/yggdrasil-go/src/version.buildName=yggdrasil"
    "-X github.com/yggdrasil-network/yggdrasil-go/src/config.defaultAdminListen=unix:///var/run/yggdrasil/yggdrasil.sock"
    "-s"
    "-w"
  ];

  meta = {
    description = "Experiment in scalable routing as an encrypted IPv6 overlay network";
    homepage = "https://yggdrasil-network.github.io/";
    license = lib.licenses.lgpl3;
  };
}
