from pathlib import Path
import os
import re
import uuid
import numpy as np
from PIL import Image
from .geometry import roi_mask


class EvidenceStore:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        if root.is_symlink(): raise ValueError('Evidence root cannot be a link')
        self.root = root.resolve()

    def _path(self, ident, kind):
        if not re.fullmatch('[a-f0-9]{32}', ident) or kind not in ('image', 'mask', 'overlay'): return None
        if self.root.is_symlink() or self.root.resolve() != self.root: raise ValueError('Evidence root moved')
        file = self.root / f'{ident}.{kind}.{"jpg" if kind == "image" else "png"}'
        if file.is_symlink() or file.resolve().parent != self.root: return None
        return file

    def save(self, capture, prediction, roi):
        ident = uuid.uuid4().hex
        image = capture.image.convert('RGB')
        mask = prediction.water_mask & roi_mask(roi, image.width, image.height)
        mask_image = Image.fromarray(mask.astype('uint8')*255)
        overlay = np.asarray(image).copy()
        overlay[mask] = (overlay[mask]*.55 + np.array([50, 170, 255])*.45).astype('uint8')
        for kind, value in [('image', image), ('mask', mask_image), ('overlay', Image.fromarray(overlay))]:
            final = self._path(ident, kind)
            temporary = final.with_suffix(final.suffix + '.tmp')
            value.save(temporary, format='JPEG' if kind == 'image' else 'PNG')
            os.replace(temporary, final)
        return ident

    def resolve(self, ident, kind='image'):
        file = self._path(ident, kind)
        return file if file and file.is_file() else None

    def prune(self, now, days=7):
        removed = 0
        if self.root.is_symlink() or self.root.resolve() != self.root: raise ValueError('Evidence root moved')
        for file in self.root.iterdir():
            if not file.is_file() or file.is_symlink() or file.resolve().parent != self.root: continue
            if not re.fullmatch(r'[a-f0-9]{32}\.(image\.jpg|mask\.png|overlay\.png)', file.name): continue
            if file.stat().st_mtime < now-days*86400:
                file.unlink(); removed += 1
        return removed
