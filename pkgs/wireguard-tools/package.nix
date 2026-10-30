{
  lib,
  stdenv,
  iptables,
  iproute2,
  makeWrapper,
  openresolv,
  procps,
  bash,
  wireguard-go,

  wireguard-tools-src,
}:

stdenv.mkDerivation {
  pname = "wireguard-tools";
  version = "1.0.20250521";

  src = wireguard-tools-src;

  outputs = [
    "out"
    "man"
  ];

  sourceRoot = "source/src";

  nativeBuildInputs = [ makeWrapper ];

  buildInputs = [ bash ];

  makeFlags = [
    "DESTDIR=$(out)"
    "PREFIX=/"
    "WITH_BASHCOMPLETION=yes"
    "WITH_SYSTEMDUNITS=yes"
    "WITH_WGQUICK=yes"
  ];

  postFixup = ''
    substituteInPlace $out/lib/systemd/system/wg-quick@.service \
      --replace /usr/bin $out/bin
  ''
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    for f in $out/bin/*; do
      # Which firewall and resolvconf implementations to use should be determined by the
      # environment, we provide the "default" ones as fallback.
      wrapProgram $f \
        --prefix PATH : ${
          lib.makeBinPath [
            procps
            iproute2
          ]
        } \
        --suffix PATH : ${
          lib.makeBinPath [
            iptables
            openresolv
          ]
        }
    done
  ''
  + lib.optionalString stdenv.hostPlatform.isDarwin ''
    for f in $out/bin/*; do
      wrapProgram $f \
        --prefix PATH : ${lib.makeBinPath [ wireguard-go ]}
    done
  '';

  meta = {
    description = "Tools for the WireGuard secure network tunnel";
    homepage = "https://www.wireguard.com/";
    license = lib.licenses.gpl2Only;
    mainProgram = "wg";
    platforms = lib.platforms.unix;
  };
}
