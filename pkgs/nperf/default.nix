{ rustPlatform, pkgs }:

rustPlatform.buildRustPackage {
  pname = "nperf";
  version = "0.3.0";
  src = ./nperf-0.3.0;

  useFetchCargoVendor = true;
  cargoHash = "sha256-ltrgj1WdZxAJWCNqmt6eLQS4xkxqhNEFamFdr5oGu/E=";


    meta = with pkgs.lib; {
    description = "nperf is a performance measurement tool for QUIC similar to iperf";
    homepage = "https://crates.io/crates/nperf/0.3.0";
    license = licenses.gpl3;
    platforms = platforms.linux;
    mainProgram = "nperf";
  };
}
 
