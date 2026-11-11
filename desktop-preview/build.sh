#!/bin/zsh
set -euo pipefail

# CI/review builds must not replace the user's running app or local runtime.
prepare_runtime=true
if [[ "${1:-}" == "--package-only" ]]; then
  prepare_runtime=false
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--package-only]" >&2
  exit 2
fi

script_dir="${0:A:h}"
prototype_dir="${script_dir:h}"
output_dir="${script_dir}/build"
app_dir="${output_dir}/TuotieDesktopPreview.app"
resources_dir="${app_dir}/Contents/Resources"

signing_args=(--root "${prototype_dir}" --installed-app "${HOME}/Applications/妥帖.app")
if ! ${prepare_runtime}; then
  signing_args+=(--package-only)
fi
# Refuse an installation build before compiling if its fixed signing identity
# is unavailable. Review packages may explicitly remain ad-hoc and uninstalled.
node "${prototype_dir}/scripts/desktop-signing.mjs" preflight "${signing_args[@]}"

node "${prototype_dir}/scripts/sync-component-library.mjs"
mkdir -p "${app_dir}/Contents/MacOS" "${resources_dir}"
mkdir -p "${output_dir}/module-cache"
cp "${script_dir}/Info.plist" "${app_dir}/Contents/Info.plist"
cp "${prototype_dir}/components-preview.html" "${resources_dir}/components-preview.html"
mkdir -p "${resources_dir}/ui"
rm -rf "${resources_dir}/ui/assets"
cp -R "${prototype_dir}/ui/assets" "${resources_dir}/ui/"
cp "${prototype_dir}/demo-sources.html" "${resources_dir}/demo-sources.html"
cp "${script_dir}/desktop-overlay.js" "${resources_dir}/desktop-overlay.js"
cp "${script_dir}/desktop-live.js" "${resources_dir}/desktop-live.js"
cp "${script_dir}/assets/components/SelectionPlus.svg" "${resources_dir}/SelectionPlus.svg"
cp "${script_dir}/assets/components/SelectionScan.svg" "${resources_dir}/SelectionScan.svg"
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({port:47721}))' \
  "${resources_dir}/runtime.json"

export CLANG_MODULE_CACHE_PATH="${output_dir}/module-cache"
export SWIFT_MODULECACHE_PATH="${output_dir}/module-cache"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)"
host_arch="$(uname -m)"
# This machine has a newer Swift compiler than its macOS 26.5 Command Line
# Tools SDK; the installed 15.4 SDK remains compatible with the host APIs used.
if [[ -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]]; then
  sdk_path="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
fi
env -u ELECTRON_RUN_AS_NODE "${prototype_dir}/node_modules/.bin/electron" "${script_dir}/make-icons.cjs" "${script_dir}/assets/AppIcon.svg" "${output_dir}/icons"
iconutil -c icns "${output_dir}/icons/AppIcon.iconset" -o "${resources_dir}/AppIcon.icns"
cp "${output_dir}/icons/StatusIcon.png" "${resources_dir}/StatusIcon.png"
xcrun swiftc -O -sdk "${sdk_path}" -target "${host_arch}-apple-macosx13.0" \
  -module-cache-path "${output_dir}/module-cache" -framework AppKit -framework WebKit -framework Carbon \
  "${script_dir}/Sources/main.swift" "${script_dir}/Sources/InputPaste.swift" "${script_dir}/Sources/NativePackDrop.swift" "${script_dir}/Sources/ResultOverlay.swift" "${script_dir}/Sources/ResultLocator.swift" "${script_dir}/Sources/ResultVisionLocator.swift" "${script_dir}/Sources/ResultOverlayManager.swift" "${script_dir}/Sources/WordInsertionPoint.swift" "${script_dir}/Sources/NativeGlass.swift" "${script_dir}/Sources/PackDragVisual.swift" "${script_dir}/Sources/ComponentLibrary.generated.swift" "${script_dir}/Sources/ComponentControls.swift" "${script_dir}/Sources/DesktopSettings.swift" "${script_dir}/Sources/SelectionCopy.swift" "${script_dir}/Sources/SelectionToolbar.swift" "${script_dir}/Sources/SelectionToolbarPlacement.swift" "${script_dir}/Sources/ShortcutCapture.swift" "${script_dir}/Sources/SourceLocation.swift" \
  -o "${app_dir}/Contents/MacOS/TuotieDesktopPreview"

node "${prototype_dir}/scripts/desktop-signing.mjs" sign "${signing_args[@]}" --app "${app_dir}"
mkdir -p "${script_dir}/preview"
preview_app="${script_dir}/preview/TuotieDesktopPreview.app"
rm -rf "${preview_app}"
ditto --norsrc --noextattr --noqtn "${app_dir}" "${preview_app}"
ditto -c -k --norsrc --noextattr --noqtn --keepParent "${preview_app}" \
  "${script_dir}/preview/TuotieDesktopPreview-macos-${host_arch}.zip"

echo "${preview_app}"
if ${prepare_runtime}; then
  node "${prototype_dir}/scripts/prepare-desktop-runtime.mjs" "${preview_app}"
fi
