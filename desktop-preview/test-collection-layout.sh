#!/bin/zsh
set -euo pipefail
script_dir="${0:A:h}"
output_dir="${script_dir}/build/collection-layout-test"
mkdir -p "${output_dir}"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)"
if [[ -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]]; then
  sdk_path="/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"
fi
xcrun swiftc -parse-as-library -sdk "${sdk_path}" -module-cache-path "${script_dir}/build/module-cache" -framework AppKit -framework WebKit \
  "${script_dir}/tests/collection-layout.swift" -o "${output_dir}/test"
"${output_dir}/test" "${script_dir:h}"
