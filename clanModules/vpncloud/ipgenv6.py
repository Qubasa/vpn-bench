#!/usr/bin/env python3

import hashlib
import ipaddress
import os
import math
import argparse
import sys

# --- Base62 Implementation ---
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


# --- ULA Prefix Generation Helper ---
def generate_temporary_ula_prefix(subnet_id_hex="0001"):
    """Generates a TEMPORARY random ULA /64 prefix string."""
    global_id_hex = os.urandom(5).hex()  # 40 random bits
    if len(subnet_id_hex) != 4:
        subnet_id_hex = "0001"  # Default just in case
    p = f"fd{global_id_hex[:2]}:{global_id_hex[2:6]}:{global_id_hex[6:10]}:{subnet_id_hex}::"
    try:
        network = ipaddress.IPv6Network(p + "/64", strict=False)
    except ipaddress.AddressValueError as e:
        # Should be unlikely with urandom, but handle anyway
        raise ValueError(f"Generated temporary prefix '{p}/64' is invalid: {e}") from e
    return network


# --- Core IPv6 Generation Logic ---
def generate_ipv6_from_pubkey_base62(public_key_b62: str, ula_prefix_int: int) -> str:
    """
    Generates a unique, private IPv6 ULA address deterministically
    from a base62 encoded public key string within the provided ULA prefix integer.

    Args:
        public_key_b62: The base62 encoded public key string.
        ula_prefix_int: The integer representation of the desired /64 ULA prefix.

    Returns:
        A string representation of the generated IPv6 ULA address.

    Raises:
        ValueError: If the public key string is invalid Base62.
    """
    try:
        decoded_int = base62_decode_to_int(public_key_b62)
    except ValueError as e:
        raise ValueError(f"Invalid Base62 public key: {e}") from e

    public_key_bytes = integer_to_bytes(decoded_int)
    hash_digest = hashlib.sha256(public_key_bytes).digest()
    interface_id_bytes = hash_digest[:8]  # First 64 bits of hash for IID
    interface_id_int = int.from_bytes(interface_id_bytes, "big")

    # Combine the prefix integer with the interface ID integer using bitwise OR
    ipv6_int = ula_prefix_int | interface_id_int

    ipv6_addr = ipaddress.IPv6Address(ipv6_int)
    return str(ipv6_addr)


# --- Main CLI Function ---
def main():
    parser = argparse.ArgumentParser(
        description="Generate a deterministic private IPv6 ULA address from a Base62 public key.",
        epilog="The script uses a ULA /64 prefix determined by the VPN_ULA_PREFIX environment variable "
        "(e.g., 'export VPN_ULA_PREFIX=fd42:a1b2:c3d4:0001::/64'). If not set or invalid, "
        "a temporary random prefix is generated, and a warning is issued (not recommended for production).",
    )
    parser.add_argument(
        "--generate-prefix",
        action="store_true",
        help="Generate a temporary random ULA prefix.",
    )
    parser.add_argument(
        "--prefix",
        help="The ULA prefix (e.g., fd42:a1b2:c3d4:0001::/64).",
        default=os.environ.get("VPN_ULA_PREFIX"),
        type=str,
    )
    parser.add_argument("--public-key", help="The Base62 encoded public key string.")
    args = parser.parse_args()

    if args.generate_prefix:
        # Generate a temporary random ULA prefix
        try:
            ula_network = generate_temporary_ula_prefix()
            print(f"{ula_network}")
            sys.exit(0)
        except ValueError as e:
            print(f"Error generating temporary ULA prefix: {e}", file=sys.stderr)
            sys.exit(1)

    if not args.public_key:
        print("Error: --public-key argument is required.", file=sys.stderr)
        sys.exit(1)

    # --- Determine ULA Prefix ---
    ula_network = None
    prefix_env_var = args.prefix

    if prefix_env_var:
        try:
            # Ensure it includes the /64 mask for proper validation
            if not prefix_env_var.endswith("/64"):
                # Try adding it automatically if it looks like just the address part
                if "::" in prefix_env_var and prefix_env_var.endswith("::"):
                    prefix_env_var += "/64"
                else:
                    raise ValueError("Prefix must end with '::/64'")

            ula_network = ipaddress.IPv6Network(prefix_env_var, strict=False)
            # Further validation: Must be ULA and /64
            if not ula_network.is_private:
                raise ValueError(
                    "Prefix must be within the private ULA range (fd00::/8)."
                )
            if ula_network.prefixlen != 64:
                raise ValueError("Prefix length must be /64.")

        except (
            ValueError,
            ipaddress.AddressValueError,
            ipaddress.NetmaskValueError,
        ) as e:
            print(
                f"WARNING: Invalid VPN_ULA_PREFIX environment variable ('{prefix_env_var}'): {e}. "
                "Falling back to a temporary random prefix.",
                file=sys.stderr,
            )
            ula_network = None  # Ensure fallback occurs

    if ula_network is None:
        try:
            ula_network = generate_temporary_ula_prefix()

            print(
                "#################################### WARNING ####################################",
                file=sys.stderr,
            )
            print(f"# Using TEMPORARY ULA Prefix: {ula_network}", file=sys.stderr)
            print(
                "# This prefix is RANDOM and WILL CHANGE on the next run without the env var.",
                file=sys.stderr,
            )
            print(
                "# For consistent addresses, set the VPN_ULA_PREFIX environment variable",
                file=sys.stderr,
            )
            print(
                "# with a FIXED, properly generated ULA prefix (e.g., fdXX:XXXX:XXXX:YYYY::/64).",
                file=sys.stderr,
            )
            print(
                "# Example: export VPN_ULA_PREFIX='fd42:a1b2:c3d4:0001::/64'",
                file=sys.stderr,
            )
            print(
                "###############################################################################",
                file=sys.stderr,
            )
        except ValueError as e:
            print(
                f"FATAL ERROR: Could not generate temporary ULA prefix: {e}",
                file=sys.stderr,
            )
            sys.exit(1)

    # Get the integer representation of the network address (prefix part)
    ula_prefix_int = int(ula_network.network_address)

    # --- Generate and Print IPv6 Address ---
    ipv6_address = generate_ipv6_from_pubkey_base62(args.public_key, ula_prefix_int)
    # print(f"Using ULA Prefix: {ula_network} (Source: {prefix_source})", file=sys.stderr) # Optional debug info
    print(ipv6_address, file=sys.stdout)


if __name__ == "__main__":
    main()
