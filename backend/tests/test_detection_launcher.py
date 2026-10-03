import importlib.util
from pathlib import Path
import socket
import pytest

spec = importlib.util.spec_from_file_location('detection_launcher', Path(__file__).resolve().parents[2]/'tools/run-detection.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def test_existing_listener_is_rejected_before_startup():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0))
        listener.listen()
        with pytest.raises(RuntimeError,match='already in use'):
            launcher.assert_ports_available([listener.getsockname()[1]])


def test_second_supervisor_cannot_acquire_lifetime_lock(tmp_path):
    path = tmp_path/'supervisor.lock'
    with launcher.service_lock(path):
        with pytest.raises(RuntimeError,match='already running'):
            with launcher.service_lock(path):
                pytest.fail('A second owner acquired the supervisor lock')
    with launcher.service_lock(path):
        pass
