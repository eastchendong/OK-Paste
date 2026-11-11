#!/bin/zsh
set -euo pipefail
script_dir="${0:A:h}"
output_dir="${script_dir}/build"
mkdir -p "${output_dir}/module-cache"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)"
if [[ -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]]; then
  sdk_path="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
fi
xcrun swiftc -parse-as-library -sdk "${sdk_path}" -framework AppKit \
  -module-cache-path "${output_dir}/module-cache" \
  "${script_dir}/Sources/SourceLocation.swift" "${script_dir}/tests/source-location.swift" \
  -o "${output_dir}/source-location-tests"
"${output_dir}/source-location-tests"
