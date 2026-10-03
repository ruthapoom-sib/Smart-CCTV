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
