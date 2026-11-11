#!/bin/zsh
set -euo pipefail

# Render production native views offscreen. No drag, app installation or window
# activation is performed, and all generated files stay under the test output.
script_dir="${0:A:h}"
prototype_dir="${script_dir:h}"
output_dir="${1:-${prototype_dir}/.local/pack-drag-visual-check}"
mkdir -p "${output_dir}/compiler"
cat "${script_dir}/Sources/PackDragVisual.swift" \
    "${script_dir}/tests/pack-drag-visual.swift" > "${output_dir}/compiler/main.swift"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)"
if [[ -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]]; then
  sdk_path=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk
fi
xcrun swiftc -sdk "${sdk_path}" -target "$(uname -m)-apple-macosx13.0" \
    -module-cache-path "${output_dir}/compiler/module-cache" -framework AppKit \
    "${output_dir}/compiler/main.swift" "${script_dir}/Sources/NativeGlass.swift" \
    "${script_dir}/Sources/ComponentLibrary.generated.swift" -o "${output_dir}/compiler/render"
"${output_dir}/compiler/render" "${output_dir}/frames"
