"""Small real decoder check: catches incompatible PyAV/faster-whisper versions."""
import io
import json
import wave

from faster_whisper.audio import decode_audio
import av
import faster_whisper

data = io.BytesIO()
with wave.open(data, 'wb') as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(16000)
    output.writeframes(bytes(32000))
data.seek(0)
decoded = decode_audio(data, sampling_rate=16000)
assert len(decoded) == 16000, 'Audio decoder returned an incomplete stream'
assert not decoded.any(), 'Silence must stay silent'
print(json.dumps({'decoderReady': True, 'fasterWhisper': faster_whisper.__version__, 'pyav': av.__version__}))
