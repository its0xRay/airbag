# Integer conversion compatibility package

Replaces the four `bigint-buffer` functions used by `@solana/buffer-layout-utils`.
The original dependency has an unpatched native buffer-overflow advisory:
[GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg).

This implementation uses JavaScript BigInt and Buffer only. It includes no native
code, build scripts or dynamically loaded bindings. Valid unsigned token values
retain their exact bytes. Negative values, overflowing values and invalid widths
are rejected rather than silently truncated. Conversion never mutates the input.
The one-megabyte width bound is above all Solana account integer layouts (8–32 bytes).

The root npm workspace replaces the vulnerable package for both runtime and tests.
The local `1.1.6` version satisfies the dependent SDK's semver range; it is not an
upstream release. The lockfile must resolve it to `vendor/bigint-buffer`, never npm.
Do not remove it until the upstream dependency is safely replaced. Regression tests
cover integer boundaries, byte-order round trips, SPL token layouts and SDK RPC use.
