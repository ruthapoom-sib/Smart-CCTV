import numpy as np
import pytest
from PIL import Image
from backend.flood.model import Segmenter, ModelError, semantic_prediction, validate_image

def test_model_missing_never_generates_prediction(tmp_path):
    with pytest.raises(ModelError, match='model_unavailable'): Segmenter(tmp_path / 'missing')

def test_semantic_grouping_probability_shape_and_threshold():
    import torch
    logits = torch.tensor([[[[0., 0.]], [[2., -2.]], [[1., -1.]]]])
    result = semantic_prediction(logits, {0:'road', 1:'water', 2:'river'}, (4, 2), .5, 'test', 'revision')
    assert result.water_mask.shape == (2, 4)
    assert result.water_mask[:, 0].all() and not result.water_mask[:, -1].any()
    assert np.isfinite(result.water_prob).all() and result.water_prob.max() <= 1

def test_empty_labels_and_nan_are_rejected():
    import torch
    with pytest.raises(ModelError, match='water_labels_missing'):
        semantic_prediction(torch.zeros(1, 1, 2, 2), {0:'road'}, (2,2), .5, 'm', 'r')
    with pytest.raises(ModelError, match='invalid_logits'):
        semantic_prediction(torch.full((1,1,2,2), float('nan')), {0:'water'}, (2,2), .5, 'm', 'r')

def test_grouped_probability_alone_cannot_label_road_as_water():
    import torch
    logits=torch.tensor([[[[.7]],[[0.]],[[0.]]]])
    p=semantic_prediction(logits,{0:'road',1:'water',2:'river'},(1,1),.4,'m','r')
    assert p.water_prob[0,0]>.4 and not p.water_mask[0,0]

def test_dark_and_blank_images_unknown():
    for color in [(0,0,0), (100,100,100)]:
        with pytest.raises(ModelError, match='image_quality'): validate_image(Image.new('RGB', (32,32), color))


def test_microsoft_original_manifest_requires_reviewed_source_hash(tmp_path):
    import hashlib
    import json
    from backend.flood.model import load_verified_manifest
    files = {}
    for name in ('config.json','preprocessor_config.json','model.safetensors','LICENSE'):
        (tmp_path/name).write_bytes(b'regression fixture')
        files[name] = hashlib.sha256(b'regression fixture').hexdigest()
    manifest = {'model_id':'microsoft/unilm/beit-base-ade20k',
        'revision':'31c5b904ca1bf2afb4c234a6675c683a4e5fc7cd','license':'mit', 'files':files,
        'source_sha256':'95bba2fea9f5f6e09293463d128d0f9958642c32605f8161f234cd85923be11a'}
    (tmp_path/'manifest.json').write_text(json.dumps(manifest))
    assert load_verified_manifest(tmp_path)['license'] == 'mit'
    manifest['source_sha256'] = '0'*64
    (tmp_path/'manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        load_verified_manifest(tmp_path)


def test_tampered_model_file_is_rejected_before_load(tmp_path):
    import json
    from backend.flood.model import load_verified_manifest
    (tmp_path/'model.safetensors').write_bytes(b'tampered')
    (tmp_path/'manifest.json').write_text(json.dumps({'model_id':'microsoft/beit-base-finetuned-ade-640-640',
        'revision':'a'*40,'license':'apache-2.0', 'files':{'model.safetensors':'0'*64}}))
    with pytest.raises(ValueError):
        load_verified_manifest(tmp_path)
