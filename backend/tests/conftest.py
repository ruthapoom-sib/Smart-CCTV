import pytest
from backend.flood.contracts import Camera, CameraConfig, Reading


@pytest.fixture
def catalog():
    return [Camera('03', 'Road', 'https://camerai1.iticfoundation.org/hls/ccs03.m3u8', [0]),
            Camera('13', 'Shared road', 'https://camerai1.iticfoundation.org/hls/ccs13.m3u8', [4, 5])]


@pytest.fixture
def config_factory():
    return lambda camera_id='03', **kw: CameraConfig(camera_id, roi=[(0,0),(1,0),(1,1),(0,1)], enabled=True, **kw)


@pytest.fixture
def reading_factory():
    def make(camera_id='03', **kw):
        data = dict(captured_at=1000., processed_at=1001., status='clear', water_coverage_pct=0.,
                    model_score=.1, model_id='trained-model', model_revision='trained', config_revision=1)
        data.update(kw)
        return Reading(camera_id, **data)
    return make
