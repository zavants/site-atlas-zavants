#!/usr/bin/env bash
# Site Atlas installer for Linux and macOS servers and workstations.
#
#   curl -fsSL https://raw.githubusercontent.com/zavants/site-atlas-zavants/main/install.sh | bash
#
# What it does, in order:
#   1. Finds Node 24+; without one, downloads an official Node build into ~/.site-atlas/node (no root needed).
#   2. Installs the site-atlas package globally with npm, from the first source that exists:
#      the latest GitHub release tarball, the npm registry, or the git repository (built on the spot).
#   3. Puts `site-atlas` on your PATH (~/.local/bin, or /usr/local/bin when writable).
#   4. Downloads Chromium (site-atlas setup) and checks the install (site-atlas doctor).
#
# Knobs (environment variables):
#   SITE_ATLAS_SOURCE   release | npm | git | any npm install spec (default: first one available)
#   SITE_ATLAS_REF      git ref for the git source (default: main)
#   SITE_ATLAS_HOME     data folder, also where a private Node goes (default: ~/.site-atlas)
#   SITE_ATLAS_NO_SETUP set to 1 to skip the Chromium download
set -euo pipefail

CLEANUP=""
trap 'rm -rf $CLEANUP' EXIT

REPO="zavants/site-atlas-zavants"
PKG="site-atlas"
NODE_MAJOR=24
ATLAS_HOME="${SITE_ATLAS_HOME:-$HOME/.site-atlas}"
SOURCE="${SITE_ATLAS_SOURCE:-}"
REF="${SITE_ATLAS_REF:-main}"
RELEASE_URL="https://github.com/$REPO/releases/latest/download/$PKG.tgz"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux) node_os=linux ;;
  Darwin) node_os=darwin ;;
  *) die "This installer supports Linux and macOS. On Windows run: npm install -g $PKG && site-atlas setup" ;;
esac
case "$arch" in
  x86_64 | amd64) node_arch=x64 ;;
  aarch64 | arm64) node_arch=arm64 ;;
  *) die "Unsupported CPU architecture: $arch" ;;
esac
have curl || die "curl is required."
have tar || die "tar is required."

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# ---- 1. Node -------------------------------------------------------------------------------------
if [ -x "$ATLAS_HOME/node/bin/node" ]; then
  export PATH="$ATLAS_HOME/node/bin:$PATH"
fi
if have node && [ "$(node_major)" -ge "$NODE_MAJOR" ]; then
  log "Using Node $(node --version) at $(command -v node)"
else
  if have node; then
    log "Node $(node --version) is too old (needs $NODE_MAJOR+): installing a private Node under $ATLAS_HOME/node"
  else
    log "Node not found: installing a private Node $NODE_MAJOR under $ATLAS_HOME/node"
  fi
  dist="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  sums="$(curl -fsSL "$dist/SHASUMS256.txt")"
  file="$(printf '%s\n' "$sums" | grep -o "node-v${NODE_MAJOR}\.[0-9.]*-${node_os}-${node_arch}\.tar\.gz" | head -n 1)"
  [ -n "$file" ] || die "No Node $NODE_MAJOR build for $node_os-$node_arch at $dist"
  expected="$(printf '%s\n' "$sums" | grep "  $file\$" | cut -d ' ' -f 1)"
  tmp="$(mktemp -d)"; CLEANUP="$CLEANUP $tmp"
  curl -fsSL -o "$tmp/$file" "$dist/$file"
  if have sha256sum; then actual="$(sha256sum "$tmp/$file" | cut -d ' ' -f 1)"; else actual="$(shasum -a 256 "$tmp/$file" | cut -d ' ' -f 1)"; fi
  [ "$actual" = "$expected" ] || die "Checksum mismatch for $file"
  rm -rf "$ATLAS_HOME/node"
  mkdir -p "$ATLAS_HOME/node"
  tar -xzf "$tmp/$file" -C "$ATLAS_HOME/node" --strip-components=1
  export PATH="$ATLAS_HOME/node/bin:$PATH"
  log "Installed Node $(node --version)"
fi

# ---- 2. The package -------------------------------------------------------------------------------
case "$SOURCE" in
  "")
    if curl -fsSLI -o /dev/null "$RELEASE_URL"; then
      spec="$RELEASE_URL"
    elif npm view "$PKG" version >/dev/null 2>&1; then
      spec="$PKG@latest"
    else
      spec="github:$REPO#$REF"
    fi
    ;;
  release) spec="$RELEASE_URL" ;;
  npm) spec="$PKG@latest" ;;
  git) spec="github:$REPO#$REF" ;;
  *) spec="$SOURCE" ;;
esac
case "$spec" in
  github:*)
    # No release and not on npm yet: build the package from the repository (needs git; takes a minute).
    have git || die "git is required to install from the repository (or wait for a release and use SITE_ATLAS_SOURCE=release)."
    src="$(mktemp -d)"; CLEANUP="$CLEANUP $src"
    log "Building $spec from source in $src"
    git clone --quiet --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$src"
    (cd "$src" && npm install --no-audit --no-fund --loglevel=error && npm run build && npm pack --pack-destination "$src" >/dev/null)
    spec="$(ls "$src"/$PKG-*.tgz | head -n 1)"
    ;;
esac

log "Installing $spec with npm"
bin=""
if npm install -g "$spec"; then
  bin="$(npm prefix -g)/bin/$PKG"
else
  warn "Global npm install failed (usually a permissions problem); retrying with a private prefix in $ATLAS_HOME/npm"
  mkdir -p "$ATLAS_HOME/npm"
  npm install -g --prefix "$ATLAS_HOME/npm" "$spec"
  bin="$ATLAS_HOME/npm/bin/$PKG"
fi
[ -x "$bin" ] || die "Expected $bin after the install, but it is not there."

# ---- 3. PATH -------------------------------------------------------------------------------------
link_dir=""
case ":$PATH:" in
  *":$(dirname "$bin"):"*) ;;  # already reachable
  *)
    if [ -w /usr/local/bin ]; then link_dir=/usr/local/bin; else link_dir="$HOME/.local/bin"; mkdir -p "$link_dir"; fi
    ln -sf "$bin" "$link_dir/$PKG"
    case ":$PATH:" in
      *":$link_dir:"*) ;;
      *) warn "Add $link_dir to your PATH, for example: echo 'export PATH=\"$link_dir:\$PATH\"' >> ~/.profile" ;;
    esac
    ;;
esac
atlas="$bin"
log "site-atlas $("$atlas" --version) installed at $bin"

# ---- 4. Chromium and a check --------------------------------------------------------------------
if [ "${SITE_ATLAS_NO_SETUP:-0}" != "1" ]; then
  with_deps=""
  if [ "$node_os" = linux ]; then
    if [ "$(id -u)" = 0 ] || sudo -n true 2>/dev/null; then with_deps="--with-deps"; else warn "Not root and no passwordless sudo: Chromium's system libraries are not installed. If scans fail, run: sudo $atlas setup --with-deps"; fi
  fi
  log "Downloading Chromium"
  "$atlas" setup $with_deps
fi
"$atlas" doctor || true

cat <<MSG

Next:
  site-atlas scan https://example.com        # scan a site
  site-atlas canvas                          # canvas on http://127.0.0.1:4800 (use an SSH tunnel from your machine)
  site-atlas canvas --host 0.0.0.0           # or reachable from other machines, protected by a token
  claude mcp add site-atlas -- site-atlas mcp   # connect it to Claude Code
MSG
