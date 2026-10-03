from pathlib import Path
import yaml
from fastapi.testclient import TestClient
from backend.flood.api import create_app
from backend.flood.settings import Settings

ROOT=Path(__file__).resolve().parents[2]
def test_compose_shared_persistence_and_loopback_binding():
    config=yaml.safe_load((ROOT/'compose.flood.yaml').read_text('utf-8'))
    api=config['services']['flood-api'];worker=config['services']['flood-worker']
    assert api['volumes']==worker['volumes']
    assert api['ports']==['127.0.0.1:8100:8100']
    assert worker['command'][-1]=='backend.flood.worker'
    assert 'prepare-flood-model.py' in (ROOT/'docs/flood-operations.md').read_text('utf-8')

def test_missing_model_ffmpeg_and_token_do_not_disable_read_api(tmp_path):
    app=create_app(Settings(runtime=tmp_path,model_path=tmp_path/'missing-model',ffmpeg='not-installed-ffmpeg'))
    with TestClient(app) as c:
        health=c.get('/api/flood/health').json()
        assert health['model']['available'] is False and health['dependencies']['ffmpeg'] is False
        assert c.get('/api/flood/cameras').status_code==200
        assert c.put('/api/flood/cameras/03/config',json={'expected_revision':0}).status_code==401
