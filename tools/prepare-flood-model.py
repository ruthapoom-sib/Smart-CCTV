"""Explicit, pinned download of licensed pretrained weights; never runs during API startup."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

MODEL = 'microsoft/beit-base-finetuned-ade-640-640'
def main():
    from huggingface_hub import HfApi, snapshot_download
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path('runtime/flood/models'))
    parser.add_argument('--model', default=MODEL, choices=[MODEL])
    args = parser.parse_args()
    info = HfApi().model_info(args.model)
    if info.card_data.get('license') != 'apache-2.0': raise RuntimeError('License must be reviewed before download')
    names = [f.rfilename for f in info.siblings]
    if 'model.safetensors' not in names: raise RuntimeError('Pretrained safetensors unavailable')
    args.output.mkdir(parents=True, exist_ok=True)
    snapshot_download(args.model, revision=info.sha, local_dir=args.output,
        allow_patterns=['config.json', 'preprocessor_config.json', 'model.safetensors', 'README.md'])
    filenames = ['config.json', 'preprocessor_config.json', 'model.safetensors', 'README.md']
    config = json.loads((args.output / 'config.json').read_text('utf-8'))
    manifest = {'model_id': args.model, 'revision': info.sha, 'license': 'apache-2.0',
        'retrieved_at': datetime.now(timezone.utc).isoformat(), 'class_names': config['id2label'],
        'source': f'https://huggingface.co/{args.model}/tree/{info.sha}',
        'license_source': f'https://huggingface.co/{args.model}/blob/{info.sha}/README.md',
        'files': {n: hashlib.sha256((args.output/n).read_bytes()).hexdigest() for n in filenames}}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'model_id': args.model, 'revision': info.sha, 'output': str(args.output)}))
if __name__ == '__main__': main()
