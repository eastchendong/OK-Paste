#!/usr/bin/env python3
"""Use a macOS password dialog; never print the supplied API key."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DIALOG = '''
set answer to display dialog "请输入火山方舟 Agent Plan 专属 API Key。密钥仅写入本机 prototype/.env.local，不发送到聊天，也不提交 Git。尚未准备好可点取消。" with title "妥帖 · API 配置" default answer "" with hidden answer buttons {"取消", "保存到本机"} default button "保存到本机" cancel button "取消"
return text returned of answer
'''


def main():
    if sys.platform != "darwin":
        raise SystemExit("此配置入口使用 macOS 本机隐藏输入框。")
    result = subprocess.run(["osascript", "-e", DIALOG], capture_output=True, text=True)
    if result.returncode:
        print("已取消或无法打开输入框；配置未变更。")
        return
    key = result.stdout.strip()
    if not key or any(c.isspace() for c in key):
        raise SystemExit("未保存：密钥为空或包含空白字符。")
    # JSON quoting also prevents newlines or shell syntax from becoming config syntax.
    content = (
        "ARK_API_KEY=" + json.dumps(key) + "\n"
        "ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3\n"
        "ARK_MODEL=glm-5.3-flash\n"
    )
    fd, name = tempfile.mkstemp(prefix=".ark-key-", dir=ROOT)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(content)
        os.replace(name, ROOT / ".env.local")
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print("API Key 已保存到本机（权限 600）；未调用 API，未显示密钥。")


if __name__ == "__main__":
    main()
