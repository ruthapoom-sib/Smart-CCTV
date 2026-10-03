"""Start/stop the local API, both detectors and viewer as one background service."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'runtime/detection'
STOP = RUNTIME / 'stop'
STATE = RUNTIME / 'state.json'


@contextmanager
def service_lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as stream:
        stream.seek(0, 2)
        if stream.tell() == 0:
            stream.write(b'1')
            stream.flush()
        stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise RuntimeError('Detection supervisor is already running') from exc
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def assert_ports_available(ports):
    for port in ports:
        with socket.socket() as probe:
            try:
                if os.name == 'nt':
                    probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                probe.bind(('127.0.0.1', port))
            except OSError as exc:
                raise RuntimeError(f'Port {port} is already in use; stop its existing service before starting Detection') from exc


def running():
    try:
        state = json.loads(STATE.read_text())
        return 0 <= time.time()-state['heartbeat'] < 15
    except (OSError, ValueError, KeyError):
        return False


def start():
    if running():
        print('Detection service is already running. http://127.0.0.1:8000/#analyst')
        return
    RUNTIME.mkdir(parents=True, exist_ok=True)
    instance = secrets.token_hex(16)
    with (RUNTIME/'supervisor.log').open('ab') as log:
        options = {'cwd':ROOT, 'stdin':subprocess.DEVNULL, 'stdout':log, 'stderr':log}
        if os.name == 'nt':
            options['creationflags'] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW
        else:
            options['start_new_session'] = True
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'run', '--instance', instance], **options)
    deadline = time.monotonic()+45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Startup failed. See runtime/detection/supervisor.log')
        if running() and json.loads(STATE.read_text()).get('instance') == instance:
            try:
                with urlopen('http://127.0.0.1:8100/api/flood/health', timeout=2) as response:
                    if response.status == 200:
                        print('Detection started. http://127.0.0.1:8000/#analyst')
                        print('Private ROI token: runtime/detection/admin-token.txt (do not publish)')
                        return
            except OSError:
                pass
        time.sleep(.2)
    STOP.touch()
    raise RuntimeError('API startup deadline exceeded. See runtime/detection/*.log')


def run(instance):
    assert_ports_available([8100,8000])
    STOP.unlink(missing_ok=True)
    sys.path.insert(0, str(ROOT))
    from backend.flood.settings import load_settings
    from backend.flood.model import load_verified_manifest
    settings = load_settings()
    load_verified_manifest(settings.model_path)
    token_path = RUNTIME/'admin-token.txt'
    if not token_path.exists():
        token_path.write_text(secrets.token_urlsafe(32), encoding='utf-8')
        if os.name != 'nt':
            token_path.chmod(0o600)
    env = dict(os.environ)
    env.setdefault('FLOOD_ADMIN_TOKEN', token_path.read_text('utf-8').strip())
    env.setdefault('RAIN_ADMIN_TOKEN', env['FLOOD_ADMIN_TOKEN'])
    env.setdefault('FLOOD_ORIGINS', 'http://127.0.0.1:8000,http://localhost:8000,https://smart-cctv-beige.vercel.app')
    if 'FLOOD_DEVICE' not in env:
        import torch
        env['FLOOD_DEVICE'] = 'cuda' if torch.cuda.is_available() else 'cpu'
    commands = {
        'api':[sys.executable,'-m','uvicorn','backend.flood.api:app','--host','127.0.0.1','--port','8100'],
        'flood-worker':[sys.executable,'-m','backend.flood.worker'],
        'rain-worker':[sys.executable,'-m','backend.rain.worker'],
        'viewer':['node',str(ROOT/'tools/serve.cjs')],
    }
    children = {}
    logs = {}
    stopping = False

    def stop_signal(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop_signal)
    signal.signal(signal.SIGINT, stop_signal)
    try:
        while not stopping and not STOP.exists():
            for name, command in commands.items():
                if name not in children or children[name].poll() is not None:
                    if name not in logs:
                        logs[name] = (RUNTIME/f'{name}.log').open('ab')
                    options = {'cwd':ROOT,'env':env,'stdin':subprocess.DEVNULL,
                        'stdout':logs[name],'stderr':logs[name]}
                    if os.name == 'nt':
                        options['creationflags'] = subprocess.CREATE_NO_WINDOW
                    children[name] = subprocess.Popen(command, **options)
            temporary = STATE.with_suffix('.tmp')
            if any(children[name].poll() is not None for name in ('api','viewer')):
                raise RuntimeError('API/viewer exited during startup; see their logs')
            temporary.write_text(json.dumps({'pid':os.getpid(),'heartbeat':time.time(),'instance':instance,
                'device':env['FLOOD_DEVICE'],'children':{k:p.pid for k,p in children.items()}}))
            temporary.replace(STATE)
            time.sleep(1)
    finally:
        for child in children.values():
            if child.poll() is None:
                if os.name == 'nt':
                    subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],
                        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False)
                else:
                    child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
        for log in logs.values():
            log.close()
        STATE.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start','run','stop','status'])
    parser.add_argument('--instance', default='foreground')
    args = parser.parse_args()
    if args.action == 'start':
        start()
    elif args.action == 'run':
        with service_lock(RUNTIME/'supervisor.lock'):
            run(args.instance)
    elif args.action == 'stop':
        RUNTIME.mkdir(parents=True, exist_ok=True)
        STOP.touch()
        deadline = time.monotonic()+20
        while STATE.exists() and time.monotonic() < deadline:
            time.sleep(.2)
        if STATE.exists():
            raise RuntimeError('Shutdown deadline exceeded; inspect supervisor.log')
        print('Detection stopped.')
    else:
        print(json.dumps({'running':running()}))


if __name__ == '__main__':
    main()
