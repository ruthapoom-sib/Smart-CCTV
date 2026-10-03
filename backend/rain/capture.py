import io
import subprocess
import time
from dataclasses import dataclass
import numpy as np
from PIL import Image
from .contracts import Camera


class CaptureError(Exception):
    pass


@dataclass(frozen=True)
class RainCapture:
    camera_id: str
    frames: list[np.ndarray]
    clip_started_at: float
    captured_at: float
    source_at: float | None = None
    fps: float = 8.0


def extract_jpeg_frames(data: bytes, max_frames: int = 16) -> list[np.ndarray]:
    frames = []
    start = 0
    SOI = b'\xff\xd8'
    EOI = b'\xff\xd9'

    while len(frames) < max_frames:
        idx = data.find(SOI, start)
        if idx == -1:
            break
        end = data.find(EOI, idx + 2)
        if end == -1:
            break
        end += 2
        chunk = data[idx:end]
        try:
            with Image.open(io.BytesIO(chunk)) as img:
                frames.append(np.asarray(img.convert('RGB')))
        except Exception:
            pass
        start = end
    return frames


def capture_clip(
    camera: Camera,
    ffmpeg: str = 'ffmpeg',
    duration: float = 2.0,
    fps: int = 8,
    max_width: int = 640,
    timeout: float = 20.0,
) -> RainCapture:
    cmd = [
        ffmpeg,
        '-nostdin',
        '-y',
        '-loglevel', 'error',
        '-t', str(duration),
        '-i', camera.stream_url,
        '-vf', f'fps={fps},scale=w=min(iw\\,{max_width}):h=-2',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-q:v', '5',
        '-'
    ]

    clip_started_at = time.time()
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            shell=False,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise CaptureError('capture_timeout') from exc
    except Exception as exc:
        raise CaptureError('capture_spawn_failed') from exc

    captured_at = time.time()
    if proc.returncode != 0:
        msg = proc.stderr.decode('utf-8', errors='ignore').strip()
        raise CaptureError(f'capture_failed: {msg[:100]}')

    data = proc.stdout
    if len(data) > 32 * 1024 * 1024:
        raise CaptureError('capture_output_exceeded')

    frames = extract_jpeg_frames(data, max_frames=int(duration * fps))
    if len(frames) < max(4, int(duration * fps * 0.5)):
        raise CaptureError('insufficient_frames')

    return RainCapture(
        camera_id=camera.id,
        frames=frames,
        clip_started_at=clip_started_at,
        captured_at=captured_at,
        fps=float(fps),
    )
