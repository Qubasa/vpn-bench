{ pkgs, ... }:

pkgs.clangStdenv.mkDerivation {
  pname = "qperf";
  version = "nightly";

  src = pkgs.fetchFromGitHub {
    owner = "rbruenig";
    repo = "qperf";
    rev = "6b290e3234beedbc1fdec13951020bf81b87eaf3";
    sha256 = "sha256-NIwM7s8YyAwxomSFH0NTMkpRGOStskLmLhO1PmL0kGY=";
    fetchSubmodules = true;
  };

  outputs = [
    "out"
    "dev"
  ];

  nativeBuildInputs = with pkgs; [
    gnumake
    cmake
    clang-tools
    pkg-config
    openssl_1_1.dev
    libev
    perl
  ];

  installPhase = ''
    mkdir -p $out/bin
    cp qperf $out/bin/qperf
  '';


  meta = with pkgs.lib; {
    description = "qperf is a performance measurement tool for QUIC similar to iperf";
    homepage = "https://github.com/rbruenig/qperf";
    license = licenses.gpl3;
    platforms = platforms.linux;
    mainProgram = "qperf";
  };
}
