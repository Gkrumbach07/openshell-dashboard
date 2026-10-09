package models

// BuiltInGatewayReleaseLine is the gateway minor release line this build is
// for, written major.minor. The dashboard shares the gateway's minor release
// line (ADR 0009): a build for 0.1 works with every gateway 0.1.x, and with
// no other line.
//
// It is the line of the newest required lane in deploy/ci/gateway-pins.json,
// the gateway release this build is tested on. It is written here, in the
// source, so that every binary knows it whatever built the image: a build
// that is handed no build args and no environment still reports
// compatibility. `node scripts/gateway-range.mjs --check` fails in CI when
// this constant and the pins file disagree. Change it only in the pull
// request that moves the newest required lane to a new minor.
const BuiltInGatewayReleaseLine = "0.1"
