#!/bin/zsh
set -euo pipefail
script_dir="${0:A:h}"
output_dir="${script_dir:h}/.local/native-pack-drop-check"
mkdir -p "${output_dir}/module-cache"
cat "${script_dir}/Sources/NativePackDrop.swift" "${script_dir}/tests/native-pack-drop.swift" > "${output_dir}/main.swift"
xcrun swiftc -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk -target "$(uname -m)-apple-macosx13.0" \
 -module-cache-path "${output_dir}/module-cache" -framework AppKit -framework Carbon \
 "${output_dir}/main.swift" "${script_dir}/Sources/InputPaste.swift" -o "${output_dir}/check"
"${output_dir}/check"
