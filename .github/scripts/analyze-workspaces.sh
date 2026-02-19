#!/bin/bash

# analyze-workspaces.sh
# Analyzes workspaces from branch info files and outputs matrix data for GitHub Actions
#
# Usage: ./analyze-workspaces.sh [npm|docker|crates|all]
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

# Output helper
out() {
    local key="$1"
    local value="$2"

    # Always print to stdout so script behavior is consistent in and out of Actions.
    printf '%s=%s\n' "$key" "$value"

    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
    fi
}

# Parse arguments
REGISTRY_FILTER="${1:-all}"

# Validate arguments
if [[ ! "$REGISTRY_FILTER" =~ ^(npm|docker|crates|all)$ ]]; then
    echo "❌ Invalid registry filter: $REGISTRY_FILTER" >&2
    echo "Usage: $0 [npm|docker|crates|all]" >&2
    exit 1
fi

# Auto-detect branch info file from current branch
CURRENT_BRANCH=$(git branch --show-current)
BRANCH_INFO_FILE=".cdtools/$(echo "$CURRENT_BRANCH" | sed 's/[^a-zA-Z0-9]/-/g' | sed 's/--*/-/g').json"

# If not found, try to find any branch info file with projectUpdated
if [ ! -f "$BRANCH_INFO_FILE" ]; then
    BRANCH_INFO_FILE=$(find .cdtools -name "*-*.json" -exec grep -l "projectUpdated" {} \; 2>/dev/null | head -1 || true)
fi

if [ ! -f "$BRANCH_INFO_FILE" ]; then
    echo "ℹ️  Branch info file not found: $BRANCH_INFO_FILE" >&2
    echo "✅ No workspaces to process (likely after end-pr cleanup), returning empty results" >&2

    # Return empty matrices based on filter
    case "$REGISTRY_FILTER" in
        npm)
            out "npm-matrix" "{\"include\":[]}"
            out "has-npm" "false"
            out "release-tag" "stable"
            ;;
        docker)
            out "docker-matrix" "{\"include\":[]}"
            out "has-docker" "false"
            out "release-tag" "stable"
            ;;
        crates)
            out "crates-matrix" "{\"include\":[]}"
            out "has-crates" "false"
            out "release-tag" "stable"
            ;;
        all)
            out "npm-matrix" "{\"include\":[]}"
            out "docker-matrix" "{\"include\":[]}"
            out "crates-matrix" "{\"include\":[]}"
            out "has-npm" "false"
            out "has-docker" "false"
            out "has-crates" "false"
            out "release-tag" "stable"
            ;;
    esac

    echo "🔍 Analysis complete: No workspaces found" >&2
    exit 0
fi

echo "📋 Using branch info file: $BRANCH_INFO_FILE" >&2

# Load config.json to get registry information
CONFIG_FILE=".cdtools/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Config file not found: $CONFIG_FILE" >&2
    exit 1
fi

# Extract workspaces based on registry filter
WORKSPACE_DATA=$(node -e "
    const branchInfo = JSON.parse(require('fs').readFileSync('$BRANCH_INFO_FILE', 'utf-8'));
    const config = JSON.parse(require('fs').readFileSync('$CONFIG_FILE', 'utf-8'));

    if (!branchInfo.projectUpdated) {
        console.log(JSON.stringify({ npm: [], docker: [], crates: [] }));
        process.exit(0);
    }

    const npmWorkspaces = [];
    const dockerWorkspaces = [];
    const cratesWorkspaces = [];

    for (const [workspacePath, version] of Object.entries(branchInfo.projectUpdated)) {
        const project = config.projects.find(p => p.path === workspacePath);
        if (!project) continue;

        const workspaceInfo = { workspace_path: workspacePath, workspace_version: version };

        if (project.registries.includes('npm')) {
            npmWorkspaces.push(workspaceInfo);
        }

        if (project.registries.includes('docker')) {
            dockerWorkspaces.push(workspaceInfo);
        }

        if (project.registries.includes('crates')) {
            cratesWorkspaces.push(workspaceInfo);
        }
    }

    console.log(JSON.stringify({
        npm: npmWorkspaces,
        docker: dockerWorkspaces,
        crates: cratesWorkspaces,
        tag: branchInfo.tag || 'stable'
    }));
")

# Generate matrices based on filter
case "$REGISTRY_FILTER" in
    npm)
        NPM_MATRIX=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(JSON.stringify({ include: data.npm }));
        ")
        HAS_NPM=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(data.npm.length > 0 ? 'true' : 'false');
        ")
        RELEASE_TAG=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(data.tag);
        ")

        # Output results
        out "npm-matrix" "$NPM_MATRIX"
        out "has-npm" "$HAS_NPM"
        out "release-tag" "$RELEASE_TAG"

        echo "🔍 Analysis complete:" >&2
        echo "  NPM workspaces: $HAS_NPM" >&2
        echo "  NPM matrix: $NPM_MATRIX" >&2
        ;;

    docker)
        DOCKER_MATRIX=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(JSON.stringify({ include: data.docker }));
        ")
        HAS_DOCKER=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(data.docker.length > 0 ? 'true' : 'false');
        ")
        RELEASE_TAG=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(data.tag);
        ")

        # Output results
        out "docker-matrix" "$DOCKER_MATRIX"
        out "has-docker" "$HAS_DOCKER"
        out "release-tag" "$RELEASE_TAG"

        echo "🔍 Analysis complete:" >&2
        echo "  Docker workspaces: $HAS_DOCKER" >&2
        echo "  Docker matrix: $DOCKER_MATRIX" >&2
        ;;

    crates)
        CRATES_MATRIX=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(JSON.stringify({ include: data.crates }));
        ")
        HAS_CRATES=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(data.crates.length > 0 ? 'true' : 'false');
        ")
        RELEASE_TAG=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(data.tag);
        ")

        # Output results
        out "crates-matrix" "$CRATES_MATRIX"
        out "has-crates" "$HAS_CRATES"
        out "release-tag" "$RELEASE_TAG"

        echo "🔍 Analysis complete:" >&2
        echo "  Crates workspaces: $HAS_CRATES" >&2
        echo "  Crates matrix: $CRATES_MATRIX" >&2
        ;;

    all)
        NPM_MATRIX=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(JSON.stringify({ include: data.npm }));
        ")
        DOCKER_MATRIX=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(JSON.stringify({ include: data.docker }));
        ")
        CRATES_MATRIX=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(JSON.stringify({ include: data.crates }));
        ")
        HAS_NPM=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(data.npm.length > 0 ? 'true' : 'false');
        ")
        HAS_DOCKER=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(data.docker.length > 0 ? 'true' : 'false');
        ")
        HAS_CRATES=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(data.crates.length > 0 ? 'true' : 'false');
        ")
        RELEASE_TAG=$(echo "$WORKSPACE_DATA" | node -e "
            const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
            console.log(data.tag);
        ")

        # Output results
        out "npm-matrix" "$NPM_MATRIX"
        out "docker-matrix" "$DOCKER_MATRIX"
        out "crates-matrix" "$CRATES_MATRIX"
        out "has-npm" "$HAS_NPM"
        out "has-docker" "$HAS_DOCKER"
        out "has-crates" "$HAS_CRATES"
        out "release-tag" "$RELEASE_TAG"

        echo "🔍 Analysis complete:" >&2
        echo "  NPM workspaces: $HAS_NPM" >&2
        echo "  Docker workspaces: $HAS_DOCKER" >&2
        echo "  Crates workspaces: $HAS_CRATES" >&2
        echo "  NPM matrix: $NPM_MATRIX" >&2
        echo "  Docker matrix: $DOCKER_MATRIX" >&2
        echo "  Crates matrix: $CRATES_MATRIX" >&2
        ;;
esac
