import hmac
import pytest
from fastapi.testclient import TestClient
from backend.rain.api import create_rain_app
from backend.rain.contracts import Camera, RainConfig
from backend.rain.settings import RainSettings
from backend.rain.store import RainStore


@pytest.fixture
def catalog():
    return [
        Camera(id='03', name='มุ่งหน้าชลบุรี', stream_url='https://example.com/03.m3u8', groups=[0]),
        Camera(id='05', name='มุ่งหน้าเมืองฉะเชิงเทรา', stream_url='https://example.com/05.m3u8', groups=[0]),
    ]


@pytest.fixture
def app_client(tmp_path, catalog):
    db_file = tmp_path / 'rain.sqlite3'
    ev_dir = tmp_path / 'evidence'
    settings = RainSettings(
        db_path=db_file,
        evidence_root=ev_dir,
        admin_token='secret-token',
        cors_origins=['http://localhost:3000'],
    )
    app = create_rain_app(settings, catalog=catalog)
    return TestClient(app)


def test_rain_api_health(app_client):
    res = app_client.get('/api/rain/health')
    assert res.status_code == 200
    data = res.json()
    assert data['api'] == 'available'
    assert 'worker' in data
    assert data['target_interval_seconds'] == 60.0
    assert data['fresh_age_seconds'] == 180.0


def test_rain_api_cameras(app_client):
    res = app_client.get('/api/rain/cameras')
    assert res.status_code == 200
    data = res.json()
    assert len(data['cameras']) == 2
    assert data['cameras'][0]['id'] == '03'
    assert data['cameras'][0]['reading']['status'] == 'unconfigured'


def test_rain_api_config_auth_and_revision(app_client):
    # GET config without auth is allowed
    res = app_client.get('/api/rain/cameras/03/config')
    assert res.status_code == 200
    assert res.json()['revision'] == 0

    # PUT without auth fails with 401
    payload = {
        'expected_revision': 0,
        'enabled': True,
        'roi': [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]],
        'thresholds': {'min_intensity_diff': 10.0, 'min_streak_aspect': 2.0, 'min_streaks': 5, 'min_frame_ratio': 0.4, 'confirmations': 3},
    }
    res = app_client.put('/api/rain/cameras/03/config', json=payload)
    assert res.status_code == 401

    # PUT with correct auth succeeds
    headers = {'Authorization': 'Bearer secret-token'}
    res = app_client.put('/api/rain/cameras/03/config', json=payload, headers=headers)
    assert res.status_code == 200
    assert res.json()['revision'] == 1
    assert res.json()['enabled'] is True

    # PUT with stale revision fails with 409
    res = app_client.put('/api/rain/cameras/03/config', json=payload, headers=headers)
    assert res.status_code == 409


def test_rain_api_analytics_and_events(app_client):
    res = app_client.get('/api/rain/analytics?start=1000&end=2000&bucket_seconds=300')
    assert res.status_code == 200
    data = res.json()
    assert 'buckets' in data
    assert len(data['buckets']) > 0

    res = app_client.get('/api/rain/events?start=0&end=5000')
    assert res.status_code == 200
    assert 'items' in res.json()


def test_rain_api_evidence_not_found(app_client):
    res = app_client.get('/api/rain/evidence/0123456789abcdef0123456789abcdef')
    assert res.status_code == 404
