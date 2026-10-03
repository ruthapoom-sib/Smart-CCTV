import numpy as np
import pytest
from PIL import Image
from backend.rain.evidence import RainEvidenceStore


def test_rain_evidence_save_resolve_and_prune(tmp_path):
    store = RainEvidenceStore(tmp_path / 'evidence')
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    frame[:, :] = [120, 120, 120]

    # Mask with streak at x=50, y=20..80
    streak_mask = np.zeros((100, 100), dtype=bool)
    streak_mask[20:80, 50] = True
    roi = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]

    ident = store.save(frame, streak_mask, roi)
    assert len(ident) == 32

    # Resolve image and overlay
    img_path = store.resolve(ident, 'image')
    assert img_path is not None and img_path.is_file()

    ov_path = store.resolve(ident, 'overlay')
    assert ov_path is not None and ov_path.is_file()

    # Invalid ident or kind returns None
    assert store.resolve('nonexistent_id') is None
    assert store.resolve(ident, 'invalid_kind') is None
    assert store.resolve('../escape', 'image') is None

    # Prune old evidence
    removed = store.prune(now=100000.0, days=7)
    # The files were just created with mtime ~ now, so 0 removed if now is small, or all removed if now is far future
    removed = store.prune(now=2e9, days=7)
    assert removed >= 2
    assert store.resolve(ident, 'image') is None
