# Claude Code sandbox image for OpenShell
# Based on the community base image with Claude Code CLI installed.
#
# Usage with CLI:
#   openshell sandbox create --from images/claude-code --provider anthropic
#
# Usage with dashboard:
#   Image: ghcr.io/<your-registry>/openshell-claude-code:latest
#   Provider: claude-code (attach your Anthropic API key)
#   Policy: web-audit or anthropic-agent template

FROM ghcr.io/nvidia/openshell-community/sandboxes/base:latest

USER root

# Install Node.js 22 (required by Claude Code)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

USER sandbox
WORKDIR /sandbox
