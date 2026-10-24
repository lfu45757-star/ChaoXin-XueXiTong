"""Check release integrity, private-file exclusions and known local secrets."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
import json
import re
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8-sig'))['version']
archive = root.parent / f'chaoxing-agent-{version}.zip'
secrets = []
token = root / 'data/token.txt'
if token.exists():
    secrets.append(token.read_bytes().strip())

def collect(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if re.search(r'key|token|password|secret', key, re.I) and isinstance(item, str) and len(item) > 7:
                secrets.append(item.encode())
            else:
                collect(item)
    elif isinstance(value, list):
        for item in value:
            collect(item)

config = root / 'data/provider.json'
if config.exists():
    collect(json.loads(config.read_text(encoding='utf-8-sig')))
env = root / '.env'
if env.exists():
    for line in env.read_text(encoding='utf-8-sig').splitlines():
        if '=' not in line or line.lstrip().startswith('#'):
            continue
        key, value = line.split('=', 1)
        value = value.strip().strip('\"\'')
        if re.search(r'key|token|password|secret', key, re.I) and len(value) > 7:
            secrets.append(value.encode())

with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    manifest = json.loads(z.read('chaoxing-agent/release-files.json'))
    assert manifest['version'] == version
    manifest_names = set(manifest['files']) | {'release-files.json'}
    actual = set()
    for name in z.namelist():
        assert name.startswith('chaoxing-agent/')
        rel = name.split('/', 1)[1]
        path = PurePosixPath(rel)
        assert '..' not in path.parts and not path.is_absolute()
        assert not {'data', 'node_modules', '.git'} & set(path.parts)
        assert rel != '.env' and not path.name.startswith('live-')
        assert path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.log'}
        data = z.read(name)
        assert not any(secret and secret in data for secret in secrets), f'Local secret in {rel}'
        assert not re.search(rb'(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})', data), f'Credential pattern in {rel}'
        assert not re.search(rb'(?:cpi|clazzid|courseId|courseid|chapterId)=[0-9]{6,}', data), f'Course identifier in {rel}'
        if rel in manifest['files']:
            assert sha256(data).hexdigest() == manifest['files'][rel]['sha256'], rel
        actual.add(rel)
    assert actual == manifest_names
    assert json.loads(z.read('chaoxing-agent/extension/manifest.json'))['version'] == version
checksum = sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.sha256').write_text(f'{checksum}  {archive.name}\n', encoding='utf-8')
print(json.dumps({'version': version, 'files': len(actual), 'integrity': 'passed',
                  'private_file_and_secret_checks': 'passed', 'sha256': checksum}))
