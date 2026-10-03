from pathlib import Path
import os
import re
import uuid
import numpy as np
from PIL import Image
from .geometry import roi_mask


class RainEvidenceStore:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        if root.is_symlink():
            raise ValueError('Evidence root cannot be a link')
        self.root = root.resolve()

    def _path(self, ident: str, kind: str) -> Path | None:
        if not re.fullmatch(r'[a-f0-9]{32}', ident) or kind not in ('image', 'overlay'):
            return None
        if self.root.is_symlink() or self.root.resolve() != self.root:
            raise ValueError('Evidence root moved')
        file = self.root / f'{ident}.{kind}.jpg'
        if file.is_symlink() or file.resolve().parent != self.root:
            return None
        return file

    def save(self, frame: np.ndarray, streak_mask: np.ndarray, roi: list[tuple[float, float]]) -> str:
        ident = uuid.uuid4().hex
        if frame.ndim == 2:
            frame_rgb = np.stack([frame] * 3, axis=-1)
        else:
            frame_rgb = frame.copy()

        h, w = frame_rgb.shape[:2]
        r_mask = roi_mask(roi, w, h)
        combined_mask = (streak_mask.astype(bool) & r_mask) if streak_mask is not None else np.zeros((h, w), dtype=bool)

        # Base image
        img = Image.fromarray(frame_rgb.astype('uint8'))

        # Overlay: draw cyan/mint highlights on streak pixels
        overlay_arr = frame_rgb.copy()
        if combined_mask.any():
            # Highlight streaks with bright cyan/mint [80, 230, 255]
            overlay_arr[combined_mask] = (overlay_arr[combined_mask] * 0.3 + np.array([80, 230, 255]) * 0.7).astype('uint8')
        overlay_img = Image.fromarray(overlay_arr.astype('uint8'))

        for kind, val in [('image', img), ('overlay', overlay_img)]:
            final = self._path(ident, kind)
            temp = final.with_suffix(final.suffix + '.tmp')
            val.save(temp, format='JPEG', quality=85)
            os.replace(temp, final)

        return ident

    def resolve(self, ident: str, kind: str = 'image') -> Path | None:
        file = self._path(ident, kind)
        return file if file and file.is_file() else None

    def prune(self, now: float, days: int = 7) -> int:
        removed = 0
        if self.root.is_symlink() or self.root.resolve() != self.root:
            raise ValueError('Evidence root moved')
        cutoff = now - days * 86400
        for file in self.root.iterdir():
            if not file.is_file() or file.is_symlink() or file.resolve().parent != self.root:
                continue
            if not re.fullmatch(r'[a-f0-9]{32}\.(image|overlay)\.jpg', file.name):
                continue
            if file.stat().st_mtime < cutoff:
                file.unlink()
                removed += 1
        return removed
