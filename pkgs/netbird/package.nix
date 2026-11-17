{
  lib,
  stdenv,
  buildGoModule,
  installShellFiles,
  versionCheckHook,
  netbird-src,
}:

buildGoModule (finalAttrs: {
  pname = "netbird";
  version = "0.83.1";

  outputs = [
    "out"
    "server"
  ];

  src = netbird-src;

  proxyVendor = true;
  vendorHash = "sha256-iIbATQiIfazszBSi4jl5Ys/27uYwfweEMo+4BLSnRms=";

  nativeBuildInputs = [ installShellFiles ];

  # client: the `netbird` CLI + daemon; combined: management + signal + relay + STUN +
  # embedded IdP in one `netbird-server` binary.
  subPackages = [
    "client"
    "combined"
  ];

  tags = [ "production" ];

  ldflags = [
    "-s"
    "-w"
    "-X github.com/netbirdio/netbird/version.version=${finalAttrs.version}"
    "-X main.builtBy=nix"
  ];

  # Tests need network access.
  doCheck = false;

  postPatch = ''
    # Match systemd's RuntimeDirectory=netbird (the NixOS module's daemon socket path).
    substituteInPlace client/cmd/root.go \
      --replace-fail 'unix:///var/run/netbird.sock' 'unix:///var/run/netbird/sock'
    # The management server polls pkgs.netbird.io for new releases and has no setting to turn it off.
    substituteInPlace management/internals/server/server.go \
      --replace-fail 'version.NewUpdateAndStart("nb/management")' 'version.NewUpdate("nb/management")'
  '';

  postInstall = ''
    mv $out/bin/client $out/bin/netbird
    mkdir -p $server/bin
    mv $out/bin/combined $server/bin/netbird-server
  ''
  + lib.optionalString (stdenv.buildPlatform.canExecute stdenv.hostPlatform) ''
    installShellCompletion --cmd netbird \
      --bash <($out/bin/netbird completion bash) \
      --fish <($out/bin/netbird completion fish) \
      --zsh <($out/bin/netbird completion zsh)
  '';

  doInstallCheck = true;
  nativeInstallCheckInputs = [ versionCheckHook ];
  versionCheckProgram = "${placeholder "out"}/bin/netbird";
  versionCheckProgramArg = "version";

  meta = {
    homepage = "https://netbird.io";
    description = "WireGuard-based mesh VPN client (netbird) and combined self-hosted server (netbird-server)";
    changelog = "https://github.com/netbirdio/netbird/releases/tag/v${finalAttrs.version}";
    license = with lib.licenses; [
      bsd3
      agpl3Only
    ];
    mainProgram = "netbird";
  };
})
