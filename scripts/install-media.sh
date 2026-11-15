#!/usr/bin/env bash
# Installs the free media toolchain into .venv-media (GitHub Actions / local).
#   bash scripts/install-media.sh <tts-engine: silma|chatterbox|piper|espeak>
set -euo pipefail
ENGINE="${1:-silma}"
sudo apt-get update -q >/dev/null
sudo apt-get install -y -q --no-install-recommends ffmpeg espeak-ng fonts-noto-core fonts-lemonada >/dev/null
python3 -m venv .venv-media
. .venv-media/bin/activate
pip install -q --upgrade pip
pip install -q -r media/requirements.txt
CPU=https://download.pytorch.org/whl/cpu
case "$ENGINE" in
  silma) pip install -q --index-url $CPU torch torchaudio torchvision && pip install -q silma-tts==1.0.5 ;;
  chatterbox) pip install -q --index-url $CPU torch==2.6.0 torchaudio==2.6.0 && pip install -q "chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox@ab55923c27757c90cfcc407baa57dc25a7d25217" ;;
  piper) pip install -q piper-tts==1.8.0 ;;
  espeak) ;;
  *) echo "unknown TTS engine: $ENGINE" >&2; exit 2 ;;
esac
echo "media toolchain ready (engine: $ENGINE)"
