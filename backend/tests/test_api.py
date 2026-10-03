from dataclasses import replace
import time
from fastapi.testclient import TestClient
from backend.flood.api import create_app
from backend.flood.settings import Settings

def test_config_auth_conflict_and_validation(tmp_path):
    app = create_app(Settings(runtime=tmp_path, admin_token='test-private-token'))
    with TestClient(app) as c:
        assert c.get('/api/flood/cameras').status_code == 200
        assert 'test-private-token' not in c.get('/api/flood/health').text
        assert c.get('/api/flood/cameras/99/config').status_code == 404
        payload = {'expected_revision':0, 'enabled':True, 'roi':[[0,0],[1,0],[1,1],[0,1]]}
        assert c.put('/api/flood/cameras/03/config', json=payload).status_code == 401
        auth = {'Authorization':'Bearer test-private-token'}
        assert c.put('/api/flood/cameras/03/config', json=payload, headers=auth).status_code == 200
        assert c.put('/api/flood/cameras/03/config', json=payload, headers=auth).status_code == 409
        payload['expected_revision']=1; payload['roi']=[[0,0],[2,0],[1,1]]
        assert c.put('/api/flood/cameras/03/config', json=payload, headers=auth).status_code == 422
        assert c.get('/api/flood/analytics?start=100&end=10').status_code == 422
        assert c.get('/api/flood/analytics?start=0&end=3000000').status_code == 422
        assert c.get('/api/flood/evidence/'+'0'*32).status_code == 404
        assert c.get('/api/flood/cameras/03/snapshot').status_code == 401
        assert c.get('/api/flood/cameras/03/snapshot', headers=auth).status_code == 404
        assert c.get('/api/flood/health', headers={'Origin':'https://evil.invalid'}).headers.get('access-control-allow-origin') is None

def test_evidence_expired_vs_unknown_and_worker_unavailable(tmp_path, config_factory, reading_factory):
    app = create_app(Settings(runtime=tmp_path))
    app.state.store.save_config(config_factory(), 0)
    app.state.store.record(reading_factory(captured_at=time.time()-10, processed_at=time.time(), evidence_id='a'*32), 1)
    with TestClient(app) as c:
        assert c.get('/api/flood/evidence/'+'a'*32).status_code == 410
        assert c.get('/api/flood/health').json()['worker']['available'] is False
        assert c.get('/api/flood/cameras').json()['cameras'][0]['reading']['status']=='clear'
