module github.com/Gkrumbach07/openshell-dashboard/downstream-bff

go 1.26.5

// Pinned to the backend-v2 release this BFF was built and tested against.
// backend-v2 hasn't cut its first tag yet, so this version doesn't resolve
// over the network — see the repo-root go.work file, which is what makes
// `go build` work right now by resolving backend-v2 from local source
// instead of a published module. Once backend-v2/v0.1.0 is tagged and
// pushed, delete go.work (or just unset GOWORK) and this line starts
// resolving for real via the module proxy. See ../README.md.
require github.com/Gkrumbach07/openshell-dashboard/backend-v2 v0.1.0
