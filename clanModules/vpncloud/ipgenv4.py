#!/usr/bin/env python3

import hashlib
import ipaddress
import os
import math
import argparse
import sys
import random  # Needed for network generation

# --- Base62 Implementation (Same as before) ---
BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
BASE62_DICT = {char: i for i, char in enumerate(BASE62_ALPHABET)}
BASE = len(BASE62_ALPHABET)  # Should be 62


def base62_decode_to_int(encoded_str: str) -> int:
    """Decodes a Base62 encoded string to an integer."""
    decoded_value = 0
    power = 0
    for char in reversed(encoded_str):
        try:
            char_value = BASE62_DICT[char]
        except KeyError:
            raise ValueError(f"Invalid character '{char}' found in Base62 string.")
        decoded_value += char_value * (BASE**power)
        power += 1
    return decoded_value


def integer_to_bytes(n: int) -> bytes:
    """Converts an integer to its minimal byte representation (big-endian)."""
    if n < 0:
        raise ValueError("Cannot convert negative integer to bytes directly.")
    if n == 0:
        return b"\x00"
    length = math.ceil(n.bit_length() / 8)
    return n.to_bytes(length, byteorder="big")


# --- Core IPv4 Generation Logic (Same as before) ---
def generate_ipv4_from_pubkey_base62(
    public_key_b62: str, ipv4_network: ipaddress.IPv4Network
) -> str:
    """
    Generates a private IPv4 address deterministically from a base62
    encoded public key string within the specified private IPv4 network.

    Args:
        public_key_b62: The base62 encoded public key string.
        ipv4_network: The ipaddress.IPv4Network object to generate IPs within.

    Returns:
        A string representation of the generated IPv4 address.

    Raises:
        ValueError: If the public key is invalid or the network has no usable hosts.
    """
    try:
        decoded_int = base62_decode_to_int(public_key_b62)
    except ValueError as e:
        raise ValueError(f"Invalid Base62 public key: {e}") from e

    public_key_bytes = integer_to_bytes(decoded_int)
    hash_digest = hashlib.sha256(public_key_bytes).digest()

    # Use the first 8 bytes (64 bits) of the hash for better distribution
    hash_int = int.from_bytes(hash_digest[:8], "big")

    # Get usable hosts iterator and count
    usable_hosts = list(ipv4_network.hosts())  # Materialize list for len/index
    num_usable_hosts = len(usable_hosts)

    if num_usable_hosts == 0:
        raise ValueError(
            f"The specified network {ipv4_network} has no usable host addresses "
            f"(prefix length might be /31 or /32)."
        )

    # Map the hash to an index within the usable host addresses
    host_index = hash_int % num_usable_hosts
    selected_host_ip = usable_hosts[host_index]

    return str(selected_host_ip)


# --- Function to generate a suggested private IPv4 network ---
def generate_suggested_ipv4_network() -> str:
    """Generates a random /16 network string within the 10.0.0.0/8 range."""
    # Generate a random second octet (0-255)
    second_octet = random.randint(0, 255)
    return f"10.{second_octet}.0.0/16"


# --- Main CLI Function ---
def main():
    parser = argparse.ArgumentParser(
        description="Generate a deterministic private IPv4 address from a Base62 public key, or generate a suggested private network.",
        epilog="Use --network or VPN_IPV4_NETWORK env var (e.g., '10.100.0.0/16') to specify the target network. "
        "Use --generate-network to get a suggested network string. "
        "WARNING: IPv4 address space is small; collisions are possible.",
    )
    parser.add_argument(
        "--generate-network",
        action="store_true",
        help="Generate and print a suggested private IPv4 network string (e.g., 10.x.0.0/16) and exit.",
    )
    parser.add_argument(
        "--network",
        help="The private IPv4 network (e.g., 10.100.0.0/16). Overrides VPN_IPV4_NETWORK env var.",
        default=os.environ.get("VPN_IPV4_NETWORK"),  # Get default from env var
        type=str,
    )
    parser.add_argument(
        "--public-key",
        help="The Base62 encoded public key string (required unless --generate-network is used).",
        # required=True removed - check manually after parsing
    )
    args = parser.parse_args()

    # --- Handle --generate-network flag ---
    if args.generate_network:
        suggested_network = generate_suggested_ipv4_network()
        print(suggested_network)
        sys.exit(0)

    # --- Ensure --public-key is provided if not generating network ---
    if not args.public_key:
        parser.error(
            "argument --public-key is required (unless --generate-network is used)"
        )
        # Note: parser.error exits the script automatically

    # --- Determine IPv4 Network (only if generating an IP) ---
    ipv4_network = None
    network_arg = args.network  # Use the value from --network or the env var default
    default_network_str = "10.199.0.0/16"  # Default if nothing else is specified/valid

    if network_arg:
        try:
            network = ipaddress.IPv4Network(
                network_arg, strict=False
            )  # Allow host bits set

            # Validation
            if not network.is_private:
                raise ValueError(
                    "Network must be within RFC 1918 private ranges "
                    "(10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)."
                )
            if network.prefixlen >= 31:
                raise ValueError(
                    "Network prefix length must be /30 or shorter to have usable hosts."
                )

            ipv4_network = network  # Use the validated network

        except (
            ValueError,
            ipaddress.AddressValueError,
            ipaddress.NetmaskValueError,
        ) as e:
            print(
                f"WARNING: Invalid network specified ('{network_arg}'): {e}. "
                f"Falling back to default network {default_network_str}.",
                file=sys.stderr,
            )
            ipv4_network = None  # Ensure fallback occurs

    # Fallback to default if no network was specified or the specified one was invalid
    if ipv4_network is None:
        try:
            ipv4_network = ipaddress.IPv4Network(default_network_str, strict=False)
            # Print warning only if the user didn't explicitly provide an invalid network
            if not network_arg:
                print(
                    "#################################### WARNING ####################################",
                    file=sys.stderr,
                )
                print(
                    f"# Using Default Private IPv4 Network: {ipv4_network}",
                    file=sys.stderr,
                )
                print(
                    "# For consistent addresses and specific network ranges, use the --network flag",
                    file=sys.stderr,
                )
                print(
                    "# or set the VPN_IPV4_NETWORK environment variable.",
                    file=sys.stderr,
                )
                print(
                    "# Example: export VPN_IPV4_NETWORK='10.50.0.0/16'",
                    file=sys.stderr,
                )
                print(
                    "# You can use --generate-network to get a suggested network string.",
                    file=sys.stderr,
                )
                print(
                    "# REMEMBER: Collisions are possible in IPv4.",
                    file=sys.stderr,
                )
                print(
                    "###############################################################################",
                    file=sys.stderr,
                )
        except (
            ValueError,
            ipaddress.AddressValueError,
            ipaddress.NetmaskValueError,
        ) as e:
            # Should not happen with the hardcoded default, but catch just in case
            print(
                f"FATAL ERROR: Could not create default IPv4 network '{default_network_str}': {e}",
                file=sys.stderr,
            )
            sys.exit(1)

    # --- Generate and Print IPv4 Address ---
    try:
        ipv4_address = generate_ipv4_from_pubkey_base62(args.public_key, ipv4_network)
        # Optional debug info:
        # print(f"Using IPv4 Network: {ipv4_network} (Source: {network_source})", file=sys.stderr)
        print(ipv4_address, file=sys.stdout)
        sys.exit(0)

    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        # Catch unexpected errors
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
