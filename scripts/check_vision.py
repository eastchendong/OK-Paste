#!/usr/bin/env python3
"""One-image Ark Agent Plan vision smoke check. Dry-run by default; --send makes one request."""
import argparse
import base64
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3"
MODEL = "glm-5.3-flash"


def configuration():
    values = {"ARK_BASE_URL": BASE_URL, "ARK_MODEL": MODEL}
    config = ROOT / ".env.local"
    if config.exists():
        for line in config.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            name, value = line.split("=", 1)
            values[name.strip()] = json.loads(value) if value.startswith('"') else value.strip()
    for name in ("ARK_API_KEY", "ARK_BASE_URL", "ARK_MODEL"):
        if name in os.environ:
            values[name] = os.environ[name]
    # Keep the prototype on the documented Agent Plan endpoint.
    if values["ARK_BASE_URL"].rstrip("/") != BASE_URL:
        raise ValueError("本脚本使用Agent Plan API，请使用 .env.example 中的 Base URL。")
    return values


def make_payload(image, model):
    raw = image.read_bytes()
    if not raw.startswith(b"\xff\xd8\xff") or len(raw) >= 10_000_000:
        raise ValueError("验证图片必须是小于 10 MB 的 JPEG。")
    return {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": (
                "识别这张参考图片的主要物体，简短说明颜色和形状。"
                "本原型对识别出的苹果仅使用预下载的固定模型，不生成三维资产。"
                "当前没有 Blender 场景信息，不要推测篮子身份、尺寸或三维坐标。"
            )},
            {"type": "image_url", "image_url": {
                "url": "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")
            }},
        ]}],
        "max_tokens": 4096,
        "stream": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--send", action="store_true", help="向火山方舟发送一次图片理解请求（消耗 Agent Plan 额度）")
    args = parser.parse_args()
    config = configuration()
    image = ROOT / "assets/reference/apple.jpg"
    payload = make_payload(image, config["ARK_MODEL"])
    body = json.dumps(payload, ensure_ascii=False).encode()
    print(f"Model: {config['ARK_MODEL']} | image: {image.name} | request: {len(body)} bytes")
    if not args.send:
        print("本地检查通过；未发请求。准备好密钥后加 --send 进行一次真实验证。")
        return
    key = config.get("ARK_API_KEY", "")
    if not key:
        raise ValueError("缺少 ARK_API_KEY，请先运行 scripts/configure_ark_key.py。")
    request = urllib.request.Request(BASE_URL + "/chat/completions", data=body, headers={
        "Content-Type": "application/json", "Authorization": "Bearer " + key,
    }, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        # Do not echo an upstream response that might reflect request credentials.
        raise ValueError(f"火山方舟返回 HTTP {exc.code}；检查密钥、模型开通和账户额度。") from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError("连接火山方舟失败或超时；未自动重试。") from None
    choice = result.get("choices", [{}])[0]
    content = choice.get("message", {}).get("content")
    if not content:
        raise ValueError("未得到最终回答；可能已耗尽输出预算，不能据此认定视觉验证通过。")
    print(str(content).replace(key, "[REDACTED]"))
    print("Usage:", json.dumps(result.get("usage", {}), ensure_ascii=False))
    print("Finish reason:", choice.get("finish_reason"))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
