{ pkgs, ... }:

pkgs.clangStdenv.mkDerivation {
  pname = "qperf";
  version = "nightly";

  src = pkgs.fetchFromGitHub {
    owner = "qubasa";
    repo = "qperf";
    rev = "423098cdc67f6b100b7413af1a876ef51722460d";
    sha256 = "sha256-Xlk5dpuq0+p7pPHijXDTPnxUK915DBOxgtDcES3tmbA=";
    fetchSubmodules = true;
  };

  outputs = [
    "out"
    "dev"
  ];

  CMAKE_POLICY_VERSION_MINIMUM="3.5";

  nativeBuildInputs = with pkgs; [
    gnumake
    cmake
    llvmPackages.clang
    llvmPackages.bintools
    llvmPackages.lld
    pkg-config
    openssl.dev
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
