# Adapted from Hugging Face Transformers (Apache-2.0), Copyright 2021 HuggingFace.
# Reference: https://github.com/huggingface/transformers/blob/02d8fb9784e8f14a1251e4c992cd82a5762417c6/src/transformers/models/beit/convert_beit_unilm_to_pytorch.py
"""Deterministic conversion of Microsoft's ADE20K BEiT checkpoint tensors."""

def convert_state_dict(original, config):
    state = dict(original)
    renames = {
        'backbone.cls_token': 'beit.embeddings.cls_token',
        'backbone.patch_embed.proj.weight': 'beit.embeddings.patch_embeddings.projection.weight',
        'backbone.patch_embed.proj.bias': 'beit.embeddings.patch_embeddings.projection.bias',
    }
    for head in ('decode_head', 'auxiliary_head'):
        for suffix in ('weight', 'bias'):
            renames[f'{head}.conv_seg.{suffix}'] = f'{head}.classifier.{suffix}'
    layer_names = {
        'norm1': 'layernorm_before', 'norm2': 'layernorm_after',
        'attn.proj': 'attention.output.dense', 'mlp.fc1': 'intermediate.dense',
        'mlp.fc2': 'output.dense',
    }
    for i in range(config.num_hidden_layers):
        src = f'backbone.blocks.{i}.'
        dest = f'beit.encoder.layer.{i}.'
        for old, new in layer_names.items():
            for suffix in ('weight', 'bias'):
                renames[src+old+'.'+suffix] = dest+new+'.'+suffix
        renames[src+'gamma_1'] = dest+'lambda_1'
        renames[src+'gamma_2'] = dest+'lambda_2'
        attn = dest+'attention.attention.'
        weight = state.pop(src+'attn.qkv.weight')
        dim = config.hidden_size
        state[attn+'query.weight'] = weight[:dim, :]
        state[attn+'key.weight'] = weight[dim:dim*2, :]
        state[attn+'value.weight'] = weight[-dim:, :]
        renames[src+'attn.q_bias'] = attn+'query.bias'
        renames[src+'attn.v_bias'] = attn+'value.bias'
        for suffix in ('relative_position_bias_table', 'relative_position_index'):
            renames[src+'attn.'+suffix] = attn+'relative_position_bias.'+suffix
    for old, new in renames.items():
        state[new] = state.pop(old)
    return {key.replace('backbone.fpn', 'fpn'): value.contiguous() for key, value in state.items()}
