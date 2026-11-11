#!/bin/zsh
set -euo pipefail

# Compile the production overlay and verify real AppKit panels without installing
# the application, requesting permissions, or generating any system input.
script_dir="${0:A:h}"
prototype_dir="${script_dir:h}"
output_dir="${1:-${prototype_dir}/.local/result-overlay-check}"
mkdir -p "${output_dir}/compiler"
cat "${script_dir}/Sources/ResultOverlay.swift" \
    "${script_dir}/tests/result-overlay.swift" > "${output_dir}/compiler/main.swift"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)"
if [[ -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]]; then
    sdk_path="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
fi
xcrun swiftc -sdk "${sdk_path}" -target "$(uname -m)-apple-macosx13.0" \
    -module-cache-path "${output_dir}/compiler/module-cache" -framework AppKit \
    "${output_dir}/compiler/main.swift" -o "${output_dir}/compiler/check"
"${output_dir}/compiler/check" "${output_dir}/frames"
