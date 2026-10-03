from types import SimpleNamespace
import torch
from backend.flood.beit_conversion import convert_state_dict


def test_original_attention_weights_are_split_in_qkv_order():
    config = SimpleNamespace(num_hidden_layers=0, hidden_size=2)
    original = {'backbone.cls_token': torch.tensor([1.]),
        'backbone.patch_embed.proj.weight': torch.tensor([2.]),
        'backbone.patch_embed.proj.bias': torch.tensor([3.]),
        'decode_head.conv_seg.weight': torch.tensor([4.]),
        'decode_head.conv_seg.bias': torch.tensor([5.]),
        'auxiliary_head.conv_seg.weight': torch.tensor([6.]),
        'auxiliary_head.conv_seg.bias': torch.tensor([7.]),
        'backbone.fpn1.0.weight': torch.tensor([8.])}
    result = convert_state_dict(original, config)
    assert result['beit.embeddings.cls_token'].item() == 1
    assert result['decode_head.classifier.weight'].item() == 4
    assert result['fpn1.0.weight'].item() == 8
    assert 'backbone.cls_token' in original


def test_each_attention_projection_and_relative_bias_is_preserved():
    config = SimpleNamespace(num_hidden_layers=1, hidden_size=2)
    original = {f'backbone.blocks.0.{key}': torch.tensor([1.]) for key in (
        'norm1.weight','norm1.bias','attn.proj.weight','attn.proj.bias',
        'norm2.weight','norm2.bias','mlp.fc1.weight','mlp.fc1.bias',
        'mlp.fc2.weight','mlp.fc2.bias','gamma_1','gamma_2',
        'attn.q_bias','attn.v_bias','attn.relative_position_bias_table','attn.relative_position_index')}
    original['backbone.blocks.0.attn.qkv.weight'] = torch.arange(12).reshape(6,2)
    for key in ('cls_token','patch_embed.proj.weight','patch_embed.proj.bias'):
        original['backbone.'+key] = torch.tensor([1.])
    for head in ('decode_head','auxiliary_head'):
        for key in ('weight','bias'):
            original[f'{head}.conv_seg.{key}'] = torch.tensor([1.])
    result = convert_state_dict(original, config)
    prefix = 'beit.encoder.layer.0.attention.attention.'
    assert result[prefix+'query.weight'].tolist() == [[0,1],[2,3]]
    assert result[prefix+'key.weight'].tolist() == [[4,5],[6,7]]
    assert result[prefix+'value.weight'].tolist() == [[8,9],[10,11]]
    assert result[prefix+'relative_position_bias.relative_position_index'].item() == 1
