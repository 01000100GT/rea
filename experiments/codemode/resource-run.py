"""Run one owned experiment in a bounded, transient Linux systemd scope."""

import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid


def available_bytes():
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemAvailable:'):
            return int(line.split()[1]) * 1024
    raise RuntimeError('MemAvailable unavailable')


def main():
    args = sys.argv[1:]
    if args and args[0] == '--':
        args = args[1:]
    if not args:
        raise SystemExit('Usage: resource-run.py -- COMMAND ARGS...')
    gib = 1024 ** 3
    if available_bytes() < 8 * gib:
        raise SystemExit('Refusing experiment: less than 8 GiB available')
    unit = 'rea-codemode-' + uuid.uuid4().hex + '.scope'
    command = [
        'systemd-run', '--user', '--scope', '--unit=' + unit,
        '-p', 'MemoryMax=4G', '-p', 'MemoryHigh=2G', '-p', 'MemorySwapMax=0',
        '-p', 'CPUQuota=100%', '-p', 'TasksMax=96',
        'taskset', '-c', str(min(os.sched_getaffinity(0))), *args,
    ]
    process = subprocess.Popen(command)
    peak = 0
    abort = None
    started = time.monotonic()
    try:
        group = None
        while process.poll() is None:
            if group is None:
                reply = subprocess.run(
                    ['systemctl', '--user', 'show', unit, '--value',
                     '--property=ControlGroup'],
                    capture_output=True, text=True, check=False,
                )
                path = reply.stdout.strip()
                if path:
                    group = Path('/sys/fs/cgroup') / path.lstrip('/')
            current = group / 'memory.current' if group else None
            if current and current.exists():
                peak = max(peak, int(current.read_text()))
            if peak > 3 * gib:
                abort = 'scope_memory_early_stop'
            elif available_bytes() < 4 * gib:
                abort = 'host_available_memory_early_stop'
            if abort:
                subprocess.run(['systemctl', '--user', 'stop', unit], check=False)
                break
            time.sleep(0.1)
        code = process.wait()
    except BaseException:
        subprocess.run(['systemctl', '--user', 'stop', unit], check=False)
        process.wait()
        raise
    finally:
        print(json.dumps({
            'resource_scope': unit, 'peak_cgroup_bytes_sampled': peak,
            'elapsed_seconds': round(time.monotonic() - started, 3),
            'abort': abort, 'hard_memory_bytes': 4 * gib,
            'early_stop_bytes': 3 * gib, 'cpu_quota_percent': 100,
        }), file=sys.stderr)
    raise SystemExit(125 if abort else code)


if __name__ == '__main__':
    main()
