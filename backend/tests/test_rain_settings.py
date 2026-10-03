from backend.rain.settings import load_settings


def test_runtime_and_cadence_environment_are_used(tmp_path, monkeypatch):
    monkeypatch.setenv('RAIN_RUNTIME', str(tmp_path))
    monkeypatch.setenv('RAIN_CADENCE_SECONDS', '15')
    monkeypatch.setenv('RAIN_FRESHNESS_SECONDS', '90')
    monkeypatch.setenv('RAIN_CAPTURE_MAX_CONCURRENCY', '1')
    settings = load_settings()
    assert settings.db_path == tmp_path / 'rain.sqlite3'
    assert settings.evidence_root == tmp_path / 'evidence'
    assert settings.target_interval_seconds == 15
    assert settings.fresh_age_seconds == 90
    assert settings.capture_concurrency == 1


def test_paths_are_independent_of_current_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = load_settings()
    assert settings.catalog_path.is_file()
    assert settings.db_path.is_absolute()
