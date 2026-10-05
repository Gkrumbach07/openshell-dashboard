#!/usr/bin/env bash
# Give an image that is already in the registry more tags, without rebuilding.
#
#   scripts/retag-image.sh IMAGE SOURCE_TAG NEW_TAG [NEW_TAG...]
#   scripts/retag-image.sh quay.io/gkrumbach07/openshell-dashboard sha-0a1b2c3 1.2.0 1.2
#
# CI builds one image per commit and tags it sha-<commit>. Every other tag is a
# statement about that same image, made later by something that knows more:
#
#   latest        ci.yml, once the whole pipeline has passed on main
#   X.Y.Z, X.Y    publish.yml, once semantic-release has cut vX.Y.Z there
#
# Rebuilding for either would put a new image, built later, under a tag that
# claims to be the one from that commit. So both resolve the sha- tag to its
# digest and point the new tags at that digest.
#
# `docker buildx imagetools create` with a single source that is a manifest
# list (ours is: linux/amd64 + linux/arm64) "performs a carbon copy", in the
# words of its reference: the new tag gets the source's digest, and nothing
# moves but the manifest. The script checks that afterwards rather than
# trusting it.
#
# DRY_RUN=1 resolves the digest and prints the command without running it.
# Needs docker buildx, jq, and a login that can push to IMAGE.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 IMAGE SOURCE_TAG NEW_TAG [NEW_TAG...]" >&2
  exit 2
fi

image="$1"
source_tag="$2"
shift 2

digest_of() {
  docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' | jq -er '.digest'
}

if ! digest="$(digest_of "${image}:${source_tag}")"; then
  echo "::error::${image}:${source_tag} is not in the registry. That tag is pushed by the" \
       "push-manifest job in ci.yml, so CI has to have built this commit first." >&2
  exit 1
fi
case "$digest" in
  sha256:*) ;;
  *)
    echo "::error::could not read a digest for ${image}:${source_tag} (got '${digest}')" >&2
    exit 1
    ;;
esac
echo "${image}:${source_tag} is ${digest}"

tag_args=()
for tag in "$@"; do
  tag_args+=(--tag "${image}:${tag}")
done

echo "+ docker buildx imagetools create ${tag_args[*]} ${image}@${digest}"
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "DRY_RUN=1: not pushing"
  exit 0
fi
docker buildx imagetools create "${tag_args[@]}" "${image}@${digest}"

# A carbon copy has the source's digest. Anything else means the registry now
# holds a different manifest under a tag that claims to be this commit's image.
for tag in "$@"; do
  pushed="$(digest_of "${image}:${tag}")"
  if [ "$pushed" != "$digest" ]; then
    echo "::error::${image}:${tag} is ${pushed}, expected ${digest}" >&2
    exit 1
  fi
  echo "${image}:${tag} -> ${digest}"
done
