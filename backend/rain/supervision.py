"""Killable detector process; a hung detector cannot stop capture or heartbeat."""
import multiprocessing as mp
import threading
import time
from .detector import RainDetector


class DetectorError(RuntimeError):
    pass


def _detector_child(connection, factory):
    try:
        detector = factory()
        while True:
            frames, roi, thresholds = connection.recv()
            try:
                connection.send(('ok', detector.analyze(frames, roi, thresholds)))
            except Exception:
                connection.send(('error', 'detector_failed'))
    except (EOFError, OSError):
        pass
    finally:
        connection.close()


class DetectorSupervisor:
    def __init__(self, timeout=10, detector_factory=RainDetector):
        self.timeout = timeout
        self.factory = detector_factory
        self.process = self.connection = None
        self.lock = threading.Lock()

    def analyze(self, frames, roi, thresholds):
        with self.lock:
            started = time.monotonic()
            if self.process is None:
                context = mp.get_context('spawn')
                self.connection, child = context.Pipe()
                self.process = context.Process(target=_detector_child, args=(child, self.factory), daemon=True)
                self.process.start()
                child.close()
            connection = self.connection
            done = threading.Event()
            outcome = {}

            def transact():
                try:
                    connection.send((frames, roi, thresholds))
                    outcome['response'] = connection.recv()
                except (EOFError, OSError):
                    outcome['response'] = ('error', 'detector_unavailable')
                finally:
                    done.set()

            transport = threading.Thread(target=transact, daemon=True)
            transport.start()
            if not done.wait(max(0, self.timeout - (time.monotonic() - started))):
                self.close()
                transport.join(timeout=2)
                raise DetectorError('detector_timeout')
            transport.join()
            status, value = outcome['response']
            if status != 'ok':
                self.close()
                raise DetectorError(value)
            return value

    def close(self):
        if self.process:
            if self.process.is_alive():
                self.process.terminate()
            self.process.join(timeout=2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join()
        if self.connection:
            self.connection.close()
        self.process = self.connection = None
