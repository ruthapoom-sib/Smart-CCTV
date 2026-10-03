import io
import re
import subprocess
import time
from datetime import datetime
from PIL import Image
from .contracts import Capture

class CaptureError(RuntimeError): pass

def parse_playlist(text):
    if not text.startswith('#EXTM3U') or '#EXTINF:' not in text:
        raise CaptureError('invalid_playlist')
    seq = re.search(r'#EXT-X-MEDIA-SEQUENCE:(\d+)', text)
    stamp = re.search(r'#EXT-X-PROGRAM-DATE-TIME:([^\r\n]+)', text)
    try: source_at = datetime.fromisoformat(stamp[1].replace('Z', '+00:00')).timestamp() if stamp else None
    except ValueError: raise CaptureError('invalid_playlist')
    return {'media_sequence': int(seq[1]) if seq else None, 'source_at': source_at}

def capture_frame(camera, ffmpeg='ffmpeg', timeout=20):
    # subprocess.run kills and reaps the child on timeout. No shell or arbitrary URL input.
    command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-rw_timeout', str(int(timeout * 1_000_000)), '-i', camera.stream_url,
        '-frames:v', '1', '-vf', 'scale=w=min(1280\\,iw):h=-2',
        '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']
    try:
        result = subprocess.run(command, shell=False, timeout=timeout, capture_output=True)
    except subprocess.TimeoutExpired: raise CaptureError('capture_timeout')
    except (FileNotFoundError, OSError): raise CaptureError('ffmpeg_unavailable')
    if result.returncode: raise CaptureError('capture_failed')
    try:
        image = Image.open(io.BytesIO(result.stdout)); image.load(); image = image.convert('RGB')
        if image.width < 16 or image.height < 16: raise ValueError()
    except Exception: raise CaptureError('invalid_frame')
    # FFmpeg fetches the playlist itself; a separate request cannot prove frame provenance.
    return Capture(camera.id, image, time.time(), source_at=None, media_sequence=None)
