{ pkgs, ... }:

pkgs.clangStdenv.mkDerivation {
  pname = "qperf";
  version = "nightly";

  src = pkgs.fetchFromGitHub {
    owner = "qubasa";
    repo = "qperf";
    rev = "e27a2fb66a09865b4098743d543a56ecbdf683d1";
    sha256 = "sha256-7tnayI8S8Hu3h2XPD/YfLebKGKEcxyin0Hplp4yITUQ=";
    fetchSubmodules = true;
  };

  outputs = [
    "out"
    "dev"
  ];

  nativeBuildInputs = with pkgs; [
    gnumake
    cmake
    llvmPackages.clang
    llvmPackages.bintools
    llvmPackages.lld
    pkg-config
    openssl_3_4.dev
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
