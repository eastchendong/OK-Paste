#!/bin/zsh
set -euo pipefail
script_dir="${0:A:h}"
output_dir="${script_dir}/build/native-glass-test"
mkdir -p "${output_dir}"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)"
if [[ -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]]; then
  sdk_path="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
fi
xcrun swiftc -sdk "${sdk_path}" -module-cache-path "${script_dir}/build/module-cache" -framework AppKit \
  "${script_dir}/Sources/NativeGlass.swift" "${script_dir}/tests/native-glass.swift" -o "${output_dir}/test"
"${output_dir}/test"
