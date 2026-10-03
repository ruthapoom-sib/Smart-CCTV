"""Install the exact licensed Microsoft checkpoint when Hub TLS is unavailable.

Download URL is published in microsoft/unilm/beit README. No remote code execution,
no random or missing tensors: restricted torch loader plus strict state loading.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SOURCE_URL = 'https://github.com/addf400/files/releases/download/v1.0/beit_base_patch16_640_pt22k_ft22ktoade20k.pth'
SOURCE_SHA256 = '95bba2fea9f5f6e09293463d128d0f9958642c32605f8161f234cd85923be11a'
SOURCE_REVISION = '31c5b904ca1bf2afb4c234a6675c683a4e5fc7cd'
MODEL_ID = 'microsoft/unilm/beit-base-ade20k'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--license', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT/'runtime/flood/models')
    args = parser.parse_args()
    if digest(args.checkpoint) != SOURCE_SHA256:
        parser.error('Checkpoint SHA256 does not match the reviewed Microsoft artifact')
    license_text = args.license.read_text('utf-8')
    if 'The MIT License (MIT)' not in license_text or 'Copyright (c) Microsoft Corporation' not in license_text:
        parser.error('Microsoft MIT license required')
    import torch
    from transformers import BeitConfig, BeitForSemanticSegmentation, BeitImageProcessor
    from backend.flood.beit_conversion import convert_state_dict
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
    classes = checkpoint['meta']['CLASSES']
    if len(classes) != 150 or (classes[21], classes[26], classes[60], classes[128]) != ('water', 'sea', 'river', 'lake'):
        raise ValueError('Unexpected ADE20K class mapping')
    labels = {i: name.strip() for i, name in enumerate(classes)}
    config = BeitConfig(image_size=640, num_labels=150, use_relative_position_bias=True,
        out_indices=[3,5,7,11], id2label=labels, label2id={v:k for k,v in labels.items()})
    model = BeitForSemanticSegmentation(config).eval()
    model.load_state_dict(convert_state_dict(checkpoint['state_dict'], config), strict=True)
    args.output.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.output, safe_serialization=True)
    BeitImageProcessor(size=640, do_center_crop=False).save_pretrained(args.output)
    shutil.copyfile(args.license, args.output/'LICENSE')
    files = ['config.json', 'preprocessor_config.json', 'model.safetensors', 'LICENSE']
    manifest = {'model_id': MODEL_ID, 'revision': SOURCE_REVISION, 'license': 'mit',
        'retrieved_at': datetime.now(timezone.utc).isoformat(), 'class_names': labels,
        'source': SOURCE_URL, 'source_sha256': SOURCE_SHA256,
        'license_source': f'https://github.com/microsoft/unilm/blob/{SOURCE_REVISION}/LICENSE',
        'conversion_source': 'https://github.com/huggingface/transformers/blob/02d8fb9784e8f14a1251e4c992cd82a5762417c6/src/transformers/models/beit/convert_beit_unilm_to_pytorch.py',
        'files': {name:digest(args.output/name) for name in files}}
    (args.output/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'model_id':MODEL_ID, 'revision':SOURCE_REVISION, 'strict_weights_loaded':True, 'output':str(args.output)}))


if __name__ == '__main__':
    main()
