# VPN Benchmark Tooling

This repository creates a network of VMs on the google cloud with opentofu, 
installs clan on every machine and then performs benchmarks for different VPNs.

## Run

If you just want to run the benchmark, just execute:


1. **Install Nix Package Manager**:

      - You can install the Nix package manager by either [downloading the Nix installer](https://github.com/DeterminateSystems/nix-installer/releases) or running this command:
        ```bash
        curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
        ```

2. **Download the application**
  - This will download vpn-bench and drop you in a shell with it. This will not install vpn-bench
  ```bash
  nix shell git+https://git.clan.lol/Qubasa/vpn-benchmark.git#vpn-bench
  ```

3. **Start benchmarking**
  And afterwards you have access to the `vpn-bench` command. To start the benchmarking execute:
  ```bash
  vpn-bench create # <-- Creates the VMs with terraform
  vpn-bench metadata # <-- To see the cloud metadata for the created VMs
  vpn-bench install # <-- Install benchmarking on VMs
  ```

## Development Setup

Let's get your development environment up and running:

1. **Install Nix Package Manager**:

      - You can install the Nix package manager by either [downloading the Nix installer](https://github.com/DeterminateSystems/nix-installer/releases) or running this command:
        ```bash
        curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
        ```

2. **Install direnv**:

      - To automatically setup a devshell on entering the directory
        ```bash
        nix profile install nixpkgs#nix-direnv-flakes nixpkgs#direnv
        ```

3. **Add direnv to your shell**:

      - Direnv needs to [hook into your shell](https://direnv.net/docs/hook.html) to work.
        You can do this by executing following command. The example below will setup direnv for `zsh` and `bash`

      ```bash
      echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc && echo 'eval "$(direnv hook bash)"' >> ~/.bashrc && eval "$SHELL"
      ```

4. **Allow the devshell**
      - Clone the repository
      ```bash
      git clone https://git.clan.lol/Qubasa/vpn-benchmark.git
      ```
      - Allow the devshell by
      ```bash
        $ cd `vpn-benchmark/pkgs/vpn-bench`
        $ direnv allow
      ```

5. **Locally execute vpn-bench***
    - You can execute `./bin/vpn-bench` to test the program
    - You can create a `.local.env` where you can add bash commands and
      and exports like:
        ```bash
        export PATH=$HOME/Projects/clan-core/pkgs/clan-cli/bin:$PATH
        export PYTHONPATH=$HOME/Projects/clan-core/pkgs/clan-cli:$PYTHONPATH
        ```
      to use a local checkout of clan-cli for example.

6. **Hetzner Credentials**
    - For development I recommand setting the env var `TF_VAR_hcloud_token` with the token gathered from
    [generating-api-token](https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/)