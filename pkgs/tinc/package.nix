{
  lib,
  stdenv,
  autoreconfHook,
  texinfo,
  ncurses,
  readline,
  zlib,
  lzo,
  openssl,

  tinc-src,
}:

stdenv.mkDerivation rec {
  pname = "tinc";
  version = "1.1pre18";

  src = tinc-src;

  outputs = [
    "out"
    "man"
    "info"
  ];

  nativeBuildInputs = [
    autoreconfHook
    texinfo
  ];
  buildInputs = [
    ncurses
    readline
    zlib
    lzo
    openssl
  ];

  # needed so the build doesn't need to run git to find out the version.
  prePatch = ''
    substituteInPlace configure.ac --replace UNKNOWN ${version}
    echo "${version}" > configure-version
    echo "https://tinc-vpn.org/git/browse?p=tinc;a=log;h=refs/tags/release-${version}" > ChangeLog
    sed -i '/AC_INIT/s/m4_esyscmd_s.*/${version})/' configure.ac
  '';

  configureFlags = [
    "--sysconfdir=/etc"
    "--localstatedir=/var"
  ];

  meta = {
    description = "VPN daemon with full mesh routing";
    homepage = "http://www.tinc-vpn.org/";
    license = lib.licenses.gpl2Plus;
    platforms = lib.platforms.unix;
  };
}
