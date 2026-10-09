package models

// BuiltInGatewayReleaseLine is the gateway minor release line this build is
// for, written major.minor. The dashboard shares the gateway's minor release
// line (ADR 0009): a build for 0.1 works with every gateway 0.1.x, and with
// no other line.
//
// It is the line of the release deploy/ci/gateway-pins.json names, the
// gateway release this build is built on and tested against. It is written
// here, in the source, so that every binary knows it whatever built the
// image: a build that is handed no build args and no environment still
// reports compatibility. `node scripts/gateway-range.mjs --check` fails in CI
// when this constant and the pins file disagree. It changes only in the
// commit that moves the pinned release to a new minor, which the Follow
// upstream workflow makes on the next branch (deploy/ci/upstream/pinmove.py
// rewrites this line, so it stays a `const` on a line of its own).
const BuiltInGatewayReleaseLine = "0.1"
