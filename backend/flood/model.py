import hashlib
import json
import re
from pathlib import Path
import numpy as np
from .contracts import Prediction

WATER_NAMES = {'water', 'river', 'sea', 'lake'}
MODEL_ID = 'microsoft/beit-base-finetuned-ade-640-640'
class ModelError(RuntimeError): pass


def load_verified_manifest(path):
    path = Path(path)
    manifest = json.loads((path / 'manifest.json').read_text('utf-8'))
    licensed_models = {MODEL_ID:'apache-2.0', 'microsoft/unilm/beit-base-ade20k':'mit'}
    if manifest.get('model_id') not in licensed_models or not re.fullmatch('[0-9a-f]{40}', manifest.get('revision','')):
        raise ValueError('Unreviewed model')
    if manifest.get('license') != licensed_models[manifest['model_id']] or not manifest.get('files'):
        raise ValueError('Unreviewed license')
    if manifest['model_id'] == 'microsoft/unilm/beit-base-ade20k':
        if manifest.get('source_sha256') != '95bba2fea9f5f6e09293463d128d0f9958642c32605f8161f234cd85923be11a':
            raise ValueError('Unreviewed checkpoint')
    for name, expected in manifest['files'].items():
        candidate = (path / name).resolve()
        if not candidate.is_relative_to(path.resolve()) or not candidate.is_file():
            raise ValueError('Missing model file')
        with candidate.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                raise ValueError('Model hash mismatch')
    if not any(n.endswith('.safetensors') for n in manifest['files']):
        raise ValueError('Safe weights required')
    return manifest

def validate_image(image):
    pixels = np.asarray(image.convert('RGB'), dtype=np.float32)
    if pixels.mean() < 5 or pixels.std() < 2:
        raise ModelError('image_quality')

def semantic_prediction(logits, labels, size, pixel_score, model_id, revision):
    import torch
    indices = [int(k) for k, v in labels.items() if v.strip().lower() in WATER_NAMES]
    if not indices: raise ModelError('water_labels_missing')
    if logits.ndim != 4 or not torch.isfinite(logits).all(): raise ModelError('invalid_logits')
    restored = torch.nn.functional.interpolate(logits.float(), size=(size[1], size[0]), mode='bilinear', align_corners=False)
    probabilities = restored.softmax(1)
    probs = probabilities[0, indices].sum(0).clamp(0, 1).cpu().numpy()
    winner = probabilities[0].argmax(0)
    water_class = torch.isin(winner, torch.tensor(indices, device=winner.device)).cpu().numpy()
    return Prediction(water_class & (probs >= pixel_score), probs, model_id, revision)

class Segmenter:
    def __init__(self, model_path: Path, device='cpu'):
        path = Path(model_path)
        try:
            self.manifest = load_verified_manifest(path)
            from transformers import AutoImageProcessor, AutoModelForSemanticSegmentation
            import torch
            self.processor = AutoImageProcessor.from_pretrained(path, local_files_only=True, trust_remote_code=False)
            self.model = AutoModelForSemanticSegmentation.from_pretrained(path, local_files_only=True,
                use_safetensors=True, trust_remote_code=False).to(device).eval()
            self.device = device
            if not any(v.strip().lower() in WATER_NAMES for v in self.model.config.id2label.values()):
                raise ModelError('water_labels_missing')
        except ModelError: raise
        except Exception as error: raise ModelError('model_unavailable') from error

    def predict(self, image, pixel_score=.5):
        import torch
        validate_image(image)
        inputs = self.processor(images=image, return_tensors='pt').to(self.device)
        with torch.inference_mode(): outputs = self.model(**inputs)
        return semantic_prediction(outputs.logits, self.model.config.id2label, image.size, pixel_score,
            self.manifest['model_id'], self.manifest['revision'])
