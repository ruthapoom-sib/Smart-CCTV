import numpy as np
import pytest
from backend.rain.contracts import RainThresholds
from backend.rain.detector import RainDetector


def test_detector_blank_or_dark_yields_unknown():
    detector = RainDetector()
    thresholds = RainThresholds()
    roi = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]

    # Blank/black frames
    black_frames = [np.zeros((100, 100, 3), dtype=np.uint8) for _ in range(16)]
    res, mask = detector.analyze(black_frames, roi, thresholds)
    assert res.raw_status == 'unknown'
    assert res.reason == 'low_contrast_or_blank'


def test_detector_insufficient_frames():
    detector = RainDetector()
    thresholds = RainThresholds()
    roi = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]

    # Only 3 frames
    frames = [np.full((100, 100, 3), 100, dtype=np.uint8) for _ in range(3)]
    res, mask = detector.analyze(frames, roi, thresholds)
    assert res.raw_status == 'unknown'
    assert res.reason == 'insufficient_frames'


def test_detector_static_dry_scene():
    detector = RainDetector()
    thresholds = RainThresholds()
    roi = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]

    # 16 identical naturalistic static frames (e.g. gradient texture)
    y, x = np.mgrid[0:100, 0:100]
    base = ((x + y) % 150 + 50).astype(np.uint8)
    frames = [np.stack([base]*3, axis=-1) for _ in range(16)]

    res, mask = detector.analyze(frames, roi, thresholds)
    assert res.raw_status == 'dry'
    assert res.score is not None and res.score < 0.2
    assert not mask.any()


def test_detector_synthetic_rain_streaks():
    detector = RainDetector()
    thresholds = RainThresholds(min_intensity_diff=8.0, min_streak_aspect=1.8, min_streaks=4, min_frame_ratio=0.35)
    roi = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]

    # Base texture
    y, x = np.mgrid[0:100, 0:100]
    base = ((x * 2 + y * 2) % 100 + 60).astype(np.uint8)
    frames = [np.stack([base]*3, axis=-1).copy() for _ in range(16)]

    # Add vertical streaks in frames 4 through 14 in the ROI (y: 20..80, x: 20..80)
    import random
    rng = random.Random(42)
    for i in range(4, 15):
        for _ in range(10):
            sx = rng.randint(20, 75)
            sy = rng.randint(20, 65)
            length = rng.randint(10, 20)
            # Add thin bright streak
            frames[i][sy:sy+length, sx, :] = np.clip(frames[i][sy:sy+length, sx, :].astype(int) + 35, 0, 255)

    res, mask = detector.analyze(frames, roi, thresholds)
    assert res.raw_status == 'rainy'
    assert res.score > 0.4
    assert mask.any()
