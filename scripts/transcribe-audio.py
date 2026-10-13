"""Local CPU ASR worker. stdout is one final JSON; stderr has bounded progress events."""
import argparse
import json
import os
from pathlib import Path
import sys
import re
from time import perf_counter
stage = 'arguments'

def emit(value, stream=sys.stdout):
    print(json.dumps(value, ensure_ascii=False), file=stream, flush=True)

def main():
    global stage
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio')
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--threads', type=int, default=8)
    parser.add_argument('--prepare-model', choices=['small', 'base', 'medium'])
    args = parser.parse_args()
    os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
    try:
        stage = 'dependencies'
        from faster_whisper import WhisperModel
        from faster_whisper.utils import download_model
    except ImportError:
        emit({'error': 'ASR_DEPENDENCY_MISSING'}, sys.stderr)
        return 2
    model_dir = Path(args.model_dir).resolve()
    if args.prepare_model:
        stage = 'model_download'
        download_model(args.prepare_model, output_dir=str(model_dir))
        emit({'ready': True, 'model': args.prepare_model})
        return 0
    if not (model_dir / 'model.bin').is_file():
        emit({'error': 'ASR_MODEL_MISSING'}, sys.stderr)
        return 2
    if not args.audio or not Path(args.audio).is_file():
        emit({'error': 'ASR_AUDIO_MISSING'}, sys.stderr)
        return 2
    stage = 'model_load'
    started = perf_counter()
    model = WhisperModel(str(model_dir), device='cpu', compute_type='int8',
                         cpu_threads=max(1, min(args.threads, 32)), local_files_only=True)
    model_loaded = perf_counter()
    stage = 'transcription'
    pieces, info = model.transcribe(args.audio, beam_size=5, vad_filter=True,
                                   condition_on_previous_text=False, task='transcribe')
    audio_prepared = perf_counter()
    segments = []
    last_progress = -10.0
    for piece in pieces:
        text = piece.text.strip()
        if text:
            segments.append({'start': piece.start, 'end': piece.end, 'text': text})
        if piece.end - last_progress >= 10:
            emit({'type': 'progress', 'seconds': round(piece.end, 2)}, sys.stderr)
            last_progress = piece.end
    if not segments:
        emit({'error': 'ASR_NO_SPEECH'}, sys.stderr)
        return 3
    emit({'segments': segments, 'language': info.language, 'duration': info.duration,
          'timingsMs': {'modelLoad': round((model_loaded-started)*1000),
                        'audioPreparation': round((audio_prepared-model_loaded)*1000),
                        'recognition': round((perf_counter()-audio_prepared)*1000)},
          'model': f'faster-whisper/{model_dir.name}/cpu-int8'})
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        detail = re.sub(r'https?://\S+', '[URL]', str(error))
        for name, value in os.environ.items():
            if value and len(value) > 8 and any(word in name.upper() for word in ['KEY', 'TOKEN', 'PASSWORD']):
                detail = detail.replace(value, '[REDACTED]')
        emit({'error': 'ASR_FAILED', 'stage': stage, 'exception': type(error).__name__, 'detail': detail[:300]}, sys.stderr)
        raise SystemExit(1)
