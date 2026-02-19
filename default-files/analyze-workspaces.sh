#!/bin/bash

# analyze-workspaces.sh
# Analyze workspaces from branch info files and output matrix data for GitHub Actions.
#
# Usage:
#   ./analyze-workspaces.sh [npm|docker|crates|all]
#
# Outputs (to GITHUB_OUTPUT if available, otherwise stdout):
#   - npm-matrix: JSON matrix for NPM workspaces
#   - docker-matrix: JSON matrix for Docker workspaces
#   - crates-matrix: JSON matrix for crates.io workspaces
#   - has-npm: true/false
#   - has-docker: true/false
#   - has-crates: true/false
#   - release-tag: tag from branch info (e.g., alpha, rc, stable)

set -euo pipefail

# --- Argument parsing --------------------------------------------------------

REGISTRY_FILTER="${1:-all}"

if [[ ! "$REGISTRY_FILTER" =~ ^(npm|docker|crates|all)$ ]]; then
  echo "❌ Invalid registry filter: $REGISTRY_FILTER" >&2
  echo "Usage: $0 [npm|docker|crates|all]" >&2
  exit 1
fi

# --- Output helper -----------------------------------------------------------

# Write output to GitHub Actions output file if available
out() {
  local key="$1"
  local value="$2"

  # Always print to stdout so local/script tests can assert output consistently.
  printf '%s=%s\n' "$key" "$value"

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$GITHUB_OUTPUT"
  fi
}

# Return empty matrix results for cleanup / no-op cases
empty_results() {
  case "$REGISTRY_FILTER" in
    npm)
      out "npm-matrix" '{"include":[]}'
      out "has-npm" "false"
      out "release-tag" "stable"
      ;;
    docker)
      out "docker-matrix" '{"include":[]}'
      out "has-docker" "false"
      out "release-tag" "stable"
      ;;
    crates)
      out "crates-matrix" '{"include":[]}'
      out "has-crates" "false"
      out "release-tag" "stable"
      ;;
    all)
      out "npm-matrix" '{"include":[]}'
      out "docker-matrix" '{"include":[]}'
      out "crates-matrix" '{"include":[]}'
      out "has-npm" "false"
      out "has-docker" "false"
      out "has-crates" "false"
      out "release-tag" "stable"
      ;;
  esac
}

# --- Branch info detection ---------------------------------------------------

# Detect current branch name
CURRENT_BRANCH="$(git branch --show-current)"

# Parse branch name to extract tag and raw branch (format: branchName(tag))
BRANCH_INFO_FILE=""
RAW_BRANCH_NAME="$(printf '%s' "$CURRENT_BRANCH" | sed -n 's/^\(.*\)([^)]*)$/\1/p')"
TAG_NAME="$(printf '%s' "$CURRENT_BRANCH" | sed -n 's/^.*(\([^)]*\))$/\1/p')"
if [[ -n "${RAW_BRANCH_NAME}" && -n "${TAG_NAME}" ]]; then

  # Match escapeBranchNameForFilename in src/utils/config.ts
  ESCAPED_BRANCH_NAME="$(printf '%s' "$RAW_BRANCH_NAME" \
    | sed 's#[/\\:*?"<>|]#-#g')"

  BRANCH_INFO_FILE=".cdtools/${TAG_NAME}-${ESCAPED_BRANCH_NAME}.json"
fi

# Backward-compat safe filename fallback (legacy format)
if [[ -z "${BRANCH_INFO_FILE}" || ! -f "$BRANCH_INFO_FILE" ]]; then
  SAFE_BRANCH="$(printf '%s' "$CURRENT_BRANCH" \
    | sed 's/[^a-zA-Z0-9]/-/g; s/--*/-/g')"
  BRANCH_INFO_FILE=".cdtools/${SAFE_BRANCH}.json"
fi

# Fallback: find any branch info file containing "projectUpdated"
if [[ ! -f "$BRANCH_INFO_FILE" ]]; then
  BRANCH_INFO_FILE="$(
    find .cdtools -name "*-*.json" \
      -exec grep -l "projectUpdated" {} \; 2>/dev/null \
      | head -1 || true
  )"
fi

# If still missing, exit gracefully with empty matrices
if [[ -z "${BRANCH_INFO_FILE:-}" || ! -f "$BRANCH_INFO_FILE" ]]; then
  echo "ℹ️  Branch info file not found, returning empty results" >&2
  empty_results
  exit 0
fi

echo "📋 Using branch info file: $BRANCH_INFO_FILE" >&2

# --- Config validation -------------------------------------------------------

CONFIG_FILE=".cdtools/config.json"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "❌ Config file not found: $CONFIG_FILE" >&2
  exit 1
fi

# --- Workspace extraction (jq only) ------------------------------------------

# Build JSON object:
#   { tag, npm[], docker[], crates[] }
WORKSPACE_DATA="$(
  jq -c --slurpfile cfg "$CONFIG_FILE" '
    def projects: $cfg[0].projects;

    # If projectUpdated is missing, treat as empty object
    (.projectUpdated // {}) as $pu
    | {
        tag: (.tag // "stable"),

        npm: (
          $pu
          | to_entries
          | map(
              . as $e
              | (projects[]? | select(.path == $e.key)) as $p
              | select($p != null and ($p.registries // [] | index("npm")))
              | {workspace_path: $e.key, workspace_version: $e.value}
            )
        ),

        docker: (
          $pu
          | to_entries
          | map(
              . as $e
              | (projects[]? | select(.path == $e.key)) as $p
              | select($p != null and ($p.registries // [] | index("docker")))
              | {workspace_path: $e.key, workspace_version: $e.value}
            )
        ),

        crates: (
          $pu
          | to_entries
          | map(
              . as $e
              | (projects[]? | select(.path == $e.key)) as $p
              | select($p != null and ($p.registries // [] | index("crates")))
              | {workspace_path: $e.key, workspace_version: $e.value}
            )
        )
      }
  ' "$BRANCH_INFO_FILE"
)"

# --- Derived outputs ---------------------------------------------------------

NPM_MATRIX="$(jq -c '{include: .npm}' <<<"$WORKSPACE_DATA")"
DOCKER_MATRIX="$(jq -c '{include: .docker}' <<<"$WORKSPACE_DATA")"
CRATES_MATRIX="$(jq -c '{include: .crates}' <<<"$WORKSPACE_DATA")"

HAS_NPM="$(jq -r '(.npm | length) > 0' <<<"$WORKSPACE_DATA")"
HAS_DOCKER="$(jq -r '(.docker | length) > 0' <<<"$WORKSPACE_DATA")"
HAS_CRATES="$(jq -r '(.crates | length) > 0' <<<"$WORKSPACE_DATA")"

RELEASE_TAG="$(jq -r '.tag' <<<"$WORKSPACE_DATA")"

# --- Final output ------------------------------------------------------------

case "$REGISTRY_FILTER" in
  npm)
    out "npm-matrix" "$NPM_MATRIX"
    out "has-npm" "$HAS_NPM"
    out "release-tag" "$RELEASE_TAG"
    ;;
  docker)
    out "docker-matrix" "$DOCKER_MATRIX"
    out "has-docker" "$HAS_DOCKER"
    out "release-tag" "$RELEASE_TAG"
    ;;
  crates)
    out "crates-matrix" "$CRATES_MATRIX"
    out "has-crates" "$HAS_CRATES"
    out "release-tag" "$RELEASE_TAG"
    ;;
  all)
    out "npm-matrix" "$NPM_MATRIX"
    out "docker-matrix" "$DOCKER_MATRIX"
    out "crates-matrix" "$CRATES_MATRIX"
    out "has-npm" "$HAS_NPM"
    out "has-docker" "$HAS_DOCKER"
    out "has-crates" "$HAS_CRATES"
    out "release-tag" "$RELEASE_TAG"
    ;;
esac

echo "🔍 Analysis complete: npm=$HAS_NPM docker=$HAS_DOCKER crates=$HAS_CRATES tag=$RELEASE_TAG" >&2
