import io
import subprocess
from types import SimpleNamespace
import pytest
from PIL import Image
from backend.rain.contracts import Camera
from backend.rain.capture import capture_clip, CaptureError, extract_jpeg_frames


@pytest.fixture
def test_camera():
    return Camera(id='03', name='มุ่งหน้าชลบุรี', stream_url='https://example.com/hls/03.m3u8', groups=[0])


def test_capture_argument_array_and_bounds(monkeypatch, test_camera):
    # Create 16 small JPEGs
    frames_bytes = bytearray()
    for _ in range(16):
        out = io.BytesIO()
        Image.new('RGB', (64, 36), (50, 100, 150)).save(out, 'JPEG')
        frames_bytes.extend(out.getvalue())

    calls = []
    def run(command, **options):
        calls.append((command, options))
        return SimpleNamespace(returncode=0, stdout=bytes(frames_bytes), stderr=b'')

    monkeypatch.setattr(subprocess, 'run', run)
    clip = capture_clip(test_camera, ffmpeg='ffmpeg', timeout=20.0)

    command, options = calls[0]
    assert test_camera.stream_url in command and isinstance(command, list)
    assert options['shell'] is False and options['timeout'] == 20.0
    assert len(clip.frames) == 16
    assert clip.camera_id == '03'


def test_capture_timeout_and_error(monkeypatch, test_camera):
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 20.0)
    monkeypatch.setattr(subprocess, 'run', timeout)
    with pytest.raises(CaptureError, match='capture_timeout'):
        capture_clip(test_camera, 'ffmpeg')

    # Non-zero exit code
    monkeypatch.setattr(subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=1, stdout=b'', stderr=b'Connection refused'))
    with pytest.raises(CaptureError, match='capture_failed'):
        capture_clip(test_camera, 'ffmpeg')

    # Incomplete / too few frames
    monkeypatch.setattr(subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0, stdout=b'garbage', stderr=b''))
    with pytest.raises(CaptureError, match='insufficient_frames'):
        capture_clip(test_camera, 'ffmpeg')


def test_extract_jpeg_frames():
    out1 = io.BytesIO()
    Image.new('RGB', (10, 10), (255, 0, 0)).save(out1, 'JPEG')
    out2 = io.BytesIO()
    Image.new('RGB', (10, 10), (0, 255, 0)).save(out2, 'JPEG')
    data = out1.getvalue() + out2.getvalue()

    frames = extract_jpeg_frames(data)
    assert len(frames) == 2
    assert frames[0].shape == (10, 10, 3)
