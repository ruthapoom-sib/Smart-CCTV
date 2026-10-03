import io
import subprocess
from types import SimpleNamespace
import pytest
from PIL import Image
from backend.flood.capture import capture_frame, CaptureError, parse_playlist

def test_capture_argument_array_and_timeout(monkeypatch, catalog):
    out = io.BytesIO(); Image.new('RGB', (80, 60), (40, 90, 120)).save(out, 'JPEG')
    calls = []
    def run(command, **options):
        calls.append((command, options)); return SimpleNamespace(returncode=0, stdout=out.getvalue())
    monkeypatch.setattr(subprocess, 'run', run)
    frame = capture_frame(catalog[0], 'ffmpeg')
    command, options = calls[0]
    assert catalog[0].stream_url in command and isinstance(command, list)
    assert options['shell'] is False and options['timeout'] == 20
    assert frame.source_at is None and frame.media_sequence is None

def test_timeout_and_invalid_capture(monkeypatch, catalog):
    def timeout(*args, **kwargs): raise subprocess.TimeoutExpired(args[0], 20)
    monkeypatch.setattr(subprocess, 'run', timeout)
    with pytest.raises(CaptureError, match='capture_timeout'): capture_frame(catalog[0], 'ffmpeg')
    monkeypatch.setattr(subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0, stdout=b'not-jpeg'))
    with pytest.raises(CaptureError, match='invalid_frame'): capture_frame(catalog[0], 'ffmpeg')

def test_playlist_metadata_is_optional_and_malformed_rejected():
    assert parse_playlist('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:4\n#EXTINF:2,\npart.ts')['source_at'] is None
    with pytest.raises(CaptureError, match='invalid_playlist'): parse_playlist('<html>oops</html>')
