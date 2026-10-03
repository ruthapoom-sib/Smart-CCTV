import importlib
import os
import numpy as np
from PIL import Image
import pytest
from backend.flood.contracts import Capture, Prediction


def test_evidence_images_and_safe_retention(tmp_path):
    assert importlib.util.find_spec('backend.flood.evidence'), 'Evidence storage is missing'
    from backend.flood.evidence import EvidenceStore
    e = EvidenceStore(tmp_path / 'evidence')
    c = Capture('03', Image.new('RGB', (10, 10), 'gray'), 1000)
    p = Prediction(np.ones((10, 10), bool), np.ones((10, 10)), 'trained', 'revision')
    ident = e.save(c, p, [(0,0),(1,0),(1,1),(0,1)])
    assert Image.open(e.resolve(ident)).size == (10, 10)
    assert Image.open(e.resolve(ident, 'mask')).getextrema() == (255, 255)
    assert e.resolve('../outside') is None
    assert e.resolve('0'*32) is None
    for f in (tmp_path / 'evidence').iterdir(): os.utime(f, (1000, 1000))
    assert e.prune(now=1000+7*86400+1) == 3
    assert e.resolve(ident) is None
