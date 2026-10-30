"""Keep local run output out of the source tree; bound curated test fixtures."""
from pathlib import PurePosixPath
import subprocess


def violations(entries):
    errors = []
    fixture_bytes = 0
    performance_bytes = 0
    for name, size in entries:
        path = PurePosixPath(name)
        if name.startswith('docs/evidence/') and path.suffix != '.md':
            errors.append(f'Raw evidence must remain local and untracked: {name}')
        if name.startswith('tests/fixtures/'):
            fixture_bytes += size
            if size > 96 * 1024:
                errors.append(f'Extract a smaller regression fixture: {name}')
        if name.startswith('tests/performance/baselines/'):
            performance_bytes += size
            if size > 64 * 1024:
                errors.append(f'Performance baseline must be a bounded summary: {name}')
    if fixture_bytes > 200 * 1024:
        errors.append('Curated regression fixtures exceed the 200 KiB source budget')
    if performance_bytes > 128 * 1024:
        errors.append('Performance summary baselines exceed the 128 KiB source budget')
    return errors


if __name__ == '__main__':
    entries = []
    for row in subprocess.check_output(['git', 'ls-files', '--stage', '-z']).decode().split('\0'):
        if not row:
            continue
        metadata, name = row.split('\t', 1)
        oid = metadata.split()[1]
        entries.append((name, int(subprocess.check_output(['git', 'cat-file', '-s', oid]))))
    errors = violations(entries)
    if errors:
        raise SystemExit('\n'.join(errors))
    print('Evidence policy: tracked summaries and bounded fixtures only')
