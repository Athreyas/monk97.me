#!/usr/bin/env python3
"""labpush — the lab's collector. Runs inside the network, pushes out.

Every 60s: read Uptime Kuma's status-page heartbeat feed and the host's own
/proc, roll monitors up through publish-map.json (fail closed), and push the
result to lab.monk97.me/api/ingest — but only when something changed, or
every HEARTBEAT seconds regardless so the page's timestamp stays honest.

Nothing addressable leaves this box: the map supplies every label, and the
edge refuses a push containing anything that looks like an address anyway.

Stdlib only. Python 3.8+. Config via environment:
  KUMA_URL      http://<kuma-host>:3001        (required)
  KUMA_SLUG     status page slug               (default: lab)
  INGEST_URL    https://lab.monk97.me/api/ingest
  TOKEN_FILE    /etc/labpush/token
  STATE_DIR     /var/lib/labpush               (daily history lives here)
  HEARTBEAT     seconds between forced pushes  (default 300)
  INTERVAL      poll seconds                   (default 60)
  STORAGE_FILE  pvesh storage dump             (default /var/lib/labpush/storage.json)
  BACKUP_STORAGE  PVE storage id to watch      (default: the first of type pbs)
Flags: --once (single cycle) --print (emit payload, no push) --selftest
"""
import json, os, re, sys, time, shutil, subprocess, urllib.request, urllib.error, datetime as dt, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = {
    'KUMA_URL':   os.environ.get('KUMA_URL', ''),
    'KUMA_SLUG':  os.environ.get('KUMA_SLUG', 'lab'),
    'INGEST_URL': os.environ.get('INGEST_URL', 'https://lab.monk97.me/api/ingest'),
    'TOKEN_FILE': os.environ.get('TOKEN_FILE', '/etc/labpush/token'),
    'STATE_DIR':  os.environ.get('STATE_DIR', '/var/lib/labpush'),
    'HEARTBEAT':  int(os.environ.get('HEARTBEAT', '300')),
    'INTERVAL':   int(os.environ.get('INTERVAL', '60')),
    'MAP':        os.environ.get('PUBLISH_MAP', os.path.join(HERE, 'publish-map.json')),
    'STORAGE_FILE':   os.environ.get('STORAGE_FILE', '/var/lib/labpush/storage.json'),
    'BACKUP_STORAGE': os.environ.get('BACKUP_STORAGE', ''),
}

def log(*a): print(dt.datetime.now().strftime('%H:%M:%S'), *a, flush=True)

def http_json(url, timeout=10):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'accept': 'application/json'}), timeout=timeout) as r:
        return json.load(r)

# ── Uptime Kuma ───────────────────────────────────────────────────────────
# /api/status-page/<slug>          -> publicGroupList[].monitorList[] (id, name)
# /api/status-page/heartbeat/<slug> -> heartbeatList{id:[{status,time}]}, uptimeList{"id_24":x}

def read_kuma():
    base = CFG['KUMA_URL'].rstrip('/')
    page = http_json(f"{base}/api/status-page/{CFG['KUMA_SLUG']}")
    hb = http_json(f"{base}/api/status-page/heartbeat/{CFG['KUMA_SLUG']}")
    monitors = {}
    for g in page.get('publicGroupList', []):
        for m in g.get('monitorList', []):
            beats = hb.get('heartbeatList', {}).get(str(m['id']), [])
            # Kuma status: 1 up, 0 down, 2 pending, 3 maintenance
            last = beats[-1]['status'] if beats else None
            up24 = hb.get('uptimeList', {}).get(f"{m['id']}_24")
            day_ok = (sum(1 for b in beats if b.get('status') == 1) / len(beats)) if beats else None
            monitors[m['name']] = {'up': last == 1, 'pending': last in (2, 3), 'maint': last == 3,
                                   'up24': up24, 'day': day_ok}
    return monitors

# ── host vitals ───────────────────────────────────────────────────────────

def cpu_pct(sample=0.5):
    def snap():
        with open('/proc/stat') as f:
            p = f.readline().split()[1:]
        p = list(map(int, p)); return sum(p), p[3] + (p[4] if len(p) > 4 else 0)
    t0, i0 = snap(); time.sleep(sample); t1, i1 = snap()
    return 100.0 * (1 - (i1 - i0) / max(1, t1 - t0))

def mem():
    kv = {}
    with open('/proc/meminfo') as f:
        for line in f:
            k, v = line.split(':'); kv[k] = int(v.split()[0])
    total = kv['MemTotal'] / 1048576; avail = kv.get('MemAvailable', kv['MemFree']) / 1048576
    return total, total - avail

def gpu():
    if not shutil.which('nvidia-smi'): return None
    try:
        out = subprocess.check_output(['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu',
                                       '--format=csv,noheader,nounits'], timeout=5, text=True).strip().splitlines()[0]
        name, util, mu, mt, temp = [x.strip() for x in out.split(',')]
        name = name.replace('NVIDIA ', '').replace('GeForce ', '')
        return {'model': name, 'util_pct': float(util), 'mem_pct': 100.0 * float(mu) / max(1.0, float(mt)), 'temp_c': int(float(temp))}
    except Exception:
        return None

# The backup datastore fills silently: a full PBS quota fails every nightly
# job while the server itself stays up and its monitor stays green. labpush
# is unprivileged and cannot ask the PVE API, so a root cron line dumps
# `pvesh get /nodes/<node>/storage` to STORAGE_FILE and this reads it.
BACKUP_WARN_PCT = 80.0

def backup_store():
    path = CFG['STORAGE_FILE']
    try:
        if time.time() - os.path.getmtime(path) > 1800: return None   # a stale dump is not a reading
        with open(path) as f: rows = json.load(f)
    except Exception:
        return None
    want = CFG['BACKUP_STORAGE']
    for r in rows:
        if (r.get('storage') == want) if want else (r.get('type') == 'pbs'):
            total, used = r.get('total') or 0, r.get('used') or 0
            if not r.get('active') or total <= 0: return None
            p = round(100.0 * used / total, 1)
            return {'used_pct': p, 'used_gb': round(used / 1e9, 1), 'total_gb': round(total / 1e9, 1),
                    'warn': p >= BACKUP_WARN_PCT}
    return None

def host():
    total, used = mem()
    du = shutil.disk_usage(os.environ.get('DISK_PATH', '/'))
    with open('/proc/loadavg') as f: load1 = float(f.read().split()[0])
    with open('/proc/uptime') as f: up = float(f.read().split()[0])
    return {
        'cpu_pct': round(cpu_pct(), 1), 'load1': round(load1, 2), 'cores': os.cpu_count() or 1,
        'mem_pct': round(100.0 * used / total, 1), 'mem_used_gb': round(used, 1), 'mem_total_gb': round(total, 1),
        'disk_pct': round(100.0 * du.used / du.total, 1), 'disk_used_gb': round(du.used / 1e9, 1), 'disk_total_gb': round(du.total / 1e9, 1),
        'gpu': gpu(), 'uptime_days': int(up // 86400), 'backup': backup_store(),
    }

# ── host spec: the static hardware underneath the meters ──────────────────
# Read once per process. These are constants for the life of the box, so the
# page can show what the lab *is*, not only how hard it is working.

# Same shape as the edge worker's refusal rule. A spec row that trips it is
# dropped here rather than being allowed to sink the entire push.
_ADDRISH = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b|\.lab\.monk97\.me|\.lab\b|https?://|:\d{2,5}\b|\.local\b|\.ts\.net\b', re.I)

def _read(path, default=''):
    try:
        with open(path) as f: return f.read().strip()
    except Exception: return default

def _lscpu():
    kv = {}
    try:
        for line in subprocess.check_output(['lscpu'], timeout=5, text=True).splitlines():
            if ':' in line:
                k, v = line.split(':', 1); kv[k.strip()] = v.strip()
    except Exception: pass
    return kv

def _cpu_spec():
    kv = _lscpu()
    model = kv.get('Model name', '')
    base = ''
    if '@' in model:
        model, _, base = model.partition('@')
        base = base.strip().replace('GHz', '').strip()
    # drop the registered-trademark noise vendors put in /proc/cpuinfo
    model = model.replace('(R)', '').replace('(TM)', '').replace(' CPU', '')
    model = ' '.join(model.split())
    try:
        cores = int(kv.get('Core(s) per socket', 0)) * int(kv.get('Socket(s)', 1))
    except ValueError:
        cores = 0
    threads = os.cpu_count() or 0
    bits = [model] if model else []
    if cores and threads: bits.append('%dC / %dT' % (cores, threads))
    elif threads:         bits.append('%dT' % threads)
    try:
        top = float(kv.get('CPU max MHz', 0)) / 1000.0
    except ValueError:
        top = 0.0
    try: base_f = float(base)
    except ValueError: base_f = 0.0
    if base_f and top >= 1: bits.append('%.1f–%.1f GHz' % (base_f, top))
    elif base_f:            bits.append('%.1f GHz' % base_f)
    return ' · '.join(bits)

def _gpu_spec():
    if not shutil.which('nvidia-smi'): return ''
    try:
        out = subprocess.check_output(
            ['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
            timeout=5, text=True).strip().splitlines()
    except Exception:
        return ''
    cards = []
    for line in out:
        try:
            name, mib = [x.strip() for x in line.split(',')]
        except ValueError:
            continue
        name = name.replace('NVIDIA ', '').replace('GeForce ', '')
        cards.append('%s · %d GB' % (name, round(float(mib) / 1024)))
    if len(cards) > 1:
        return '%d× %s' % (len(cards), cards[0])
    return cards[0] if cards else ''

def _mem_spec():
    total, _ = mem()
    # MemTotal is always a little under the installed capacity (firmware
    # reserves some); round to the nearest 8 GB to name the actual sticks.
    installed = int(round(total / 8.0) * 8) or int(round(total))
    return '%d GB' % installed

def _disk_spec():
    total, kinds = 0, set()
    try:
        names = sorted(os.listdir('/sys/block'))
    except Exception:
        names = []
    for d in names:
        if d.startswith(('loop', 'ram', 'sr', 'dm-', 'zram', 'md')): continue
        if _read('/sys/block/%s/removable' % d, '0') == '1': continue
        try:
            sectors = int(_read('/sys/block/%s/size' % d, '0'))
        except ValueError:
            continue
        if sectors <= 0: continue
        total += sectors * 512
        if d.startswith('nvme'):                                  kinds.add('NVMe')
        elif _read('/sys/block/%s/queue/rotational' % d, '') == '0': kinds.add('SATA SSD')
        else:                                                      kinds.add('HDD')
    if not total: return ''
    size = ('%.1f TB' % (total / 1e12)) if total >= 1e12 else ('%d GB' % round(total / 1e9))
    order = [k for k in ('NVMe', 'SATA SSD', 'HDD') if k in kinds]
    return '%s · %s' % (size, ' + '.join(order)) if order else size

def _uplink_spec():
    """Link rate of the interface carrying the default route. A bridge has no
    rate of its own, so resolve it to the fastest physical port beneath it."""
    iface = ''
    try:
        for line in subprocess.check_output(['ip', 'route'], timeout=5, text=True).splitlines():
            if line.startswith('default') and ' dev ' in line:
                parts = line.split(); iface = parts[parts.index('dev') + 1]; break
    except Exception:
        pass
    if not iface: return ''
    members = []
    brif = '/sys/class/net/%s/brif' % iface
    if os.path.isdir(brif):
        try: members = sorted(os.listdir(brif))
        except Exception: members = []
        # veth/tap members report a fictional 10 Gb/s; only a port with a
        # backing device (PCI/USB) has a real link rate.
        members = [m for m in members if os.path.exists('/sys/class/net/%s/device' % m)]
    best = 0
    for cand in (members or [iface]):
        try: sp = int(_read('/sys/class/net/%s/speed' % cand, '0'))
        except ValueError: continue
        if sp > best: best = sp
    if best <= 0: return ''
    return '%d GbE' % (best // 1000) if best >= 1000 else '%d Mb/s' % best

def _platform_spec():
    try:
        v = subprocess.check_output(['pveversion'], timeout=5, text=True).strip()
        tag = v.split('/')[1]                       # pve-manager/9.2.11/<hash>
        return 'Proxmox VE ' + '.'.join(tag.split('.')[:2])
    except Exception:
        pass
    name = ''
    for line in _read('/etc/os-release').splitlines():
        if line.startswith('PRETTY_NAME='):
            name = line.split('=', 1)[1].strip().strip('"'); break
    return name

_SPEC_CACHE = None

def spec():
    """[{k,v}] — ordered, display-ready, and scrubbed. Cached: hardware does
    not change between cycles, and lscpu/nvidia-smi are not free."""
    global _SPEC_CACHE
    if _SPEC_CACHE is not None: return _SPEC_CACHE
    rows = [('CPU', _cpu_spec()), ('GPU', _gpu_spec()), ('MEMORY', _mem_spec()),
            ('STORAGE', _disk_spec()), ('NETWORK', _uplink_spec()), ('PLATFORM', _platform_spec())]
    out = []
    for k, v in rows:
        if not v: continue
        if _ADDRISH.search(v):
            log('spec: dropped %s, value looks addressable' % k); continue
        out.append({'k': k, 'v': v})
    _SPEC_CACHE = out
    return out

# ── history: one value per monitor per day, the worst seen that day ───────

def hist_path(): return os.path.join(CFG['STATE_DIR'], 'history.json')

def load_hist():
    try:
        with open(hist_path()) as f: return json.load(f)
    except Exception: return {}

def save_hist(h):
    os.makedirs(CFG['STATE_DIR'], exist_ok=True)
    tmp = hist_path() + '.tmp'
    with open(tmp, 'w') as f: json.dump(h, f)
    os.replace(tmp, hist_path())

# A day is {"u": samples that were up, "n": samples taken}: one sample per
# monitor per poll. Uptime is then a count - u/n for a day, sum(u)/sum(n) for
# any span - rather than a reading. The first version stored the *lowest*
# rolling figure seen that day, which made a three-minute blip and a
# twenty-hour outage indistinguishable, and was not uptime at all.

def _cell(v, minutes=1440):
    """A history cell as (up, samples). Cells written before the change are a
    bare ratio; give them the weight of the minutes they covered."""
    if isinstance(v, dict): return int(v.get('u', 0)), int(v.get('n', 0))
    minutes = max(1, int(minutes))
    return int(round(float(v) * minutes)), minutes

def update_hist(h, monitors, today, minutes_today=1440):
    for name, m in monitors.items():
        # up, or in a declared maintenance window. Pending is Kuma retrying
        # before it calls a failure - not yet down, but not evidence of up.
        ok = 1 if (m['up'] or m.get('maint')) else 0
        d = h.setdefault(name, {})
        u, n = _cell(d[today], minutes_today) if today in d else (0, 0)
        d[today] = {'u': u + ok, 'n': n + 1}
    cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=120)).isoformat()
    for d in h.values():
        for k in [k for k in d if k < cutoff]: del d[k]

def days_for(h, name, today, window):
    """[(up, samples) | None] for each of the last `window` days, oldest first."""
    d = h.get(name, {}); t = dt.date.fromisoformat(today)
    out = []
    for i in range(window):
        k = (t - dt.timedelta(days=window - 1 - i)).isoformat()
        out.append(_cell(d[k]) if k in d else None)
    return out

def ratio(u, n): return round(u / n, 4) if n else None
def pct(u, n):   return round(100.0 * u / n, 2) if n else 100.0

# ── assemble ──────────────────────────────────────────────────────────────

def build(monitors, hist, pmap, now):
    today = now.date().isoformat(); window = pmap.get('window_days', 90)
    update_hist(hist, {k: v for k, v in monitors.items() if k in pmap['monitors']}, today,
                now.hour * 60 + now.minute)
    cats = {c['id']: {'id': c['id'], 'label': c['label'], 'services': [], 'beats': None} for c in pmap['categories']}
    unmapped = []
    for name, m in monitors.items():
        # `pub`, not `spec` — spec() is the host-hardware collector and a local
        # of that name shadows it, breaking the payload two lines from here
        pub = pmap['monitors'].get(name)
        if not pub: unmapped.append(name); continue           # fail closed
        days = days_for(hist, name, today, window)
        u = sum(x[0] for x in days if x); n = sum(x[1] for x in days if x)
        cats[pub['category']]['services'].append({
            'label': pub['label'], 'state': 'up' if m['up'] else ('degraded' if m['pending'] else 'down'),
            'uptime': pct(u, n), 'beats': [ratio(*x) if x else None for x in days],
            '_u': u, '_n': n, '_first': next((i for i, x in enumerate(days) if x), None)})
    out_cats = []
    for c in cats.values():
        if not c['services']: continue
        n = len(c['services'][0]['beats'])
        c['beats'] = [None if all(s['beats'][i] is None for s in c['services'])
                      else min(s['beats'][i] for s in c['services'] if s['beats'][i] is not None) for i in range(n)]
        c['_u'] = sum(s['_u'] for s in c['services']); c['_n'] = sum(s['_n'] for s in c['services'])
        c['uptime'] = pct(c['_u'], c['_n'])         # sample-weighted, not a mean of means
        states = {s['state'] for s in c['services']}
        c['state'] = 'operational' if states == {'up'} else ('outage' if states == {'down'} else 'degraded')
        out_cats.append(c)
    total = sum(len(c['services']) for c in out_cats)
    states = {c['state'] for c in out_cats}
    # how long the numbers have actually been measured: a figure over seven
    # days must not be captioned as one over ninety
    firsts = [s['_first'] for c in out_cats for s in c['services'] if s['_first'] is not None]
    measured = (window - min(firsts)) if firsts else 0
    since = (now.date() - dt.timedelta(days=measured - 1)).isoformat() if measured else None
    all_u = sum(c['_u'] for c in out_cats); all_n = sum(c['_n'] for c in out_cats)
    for c in out_cats:
        c.pop('_u', None); c.pop('_n', None)
        for s in c['services']:
            for k in ('_u', '_n', '_first'): s.pop(k, None)
    doc = {
        'v': 1, 'generated_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'window_days': window,
        'summary': {
            'state': 'operational' if states <= {'operational'} else ('outage' if states == {'outage'} else 'degraded'),
            'services': total, 'nodes': pmap.get('nodes', 0), 'gpus': pmap.get('gpus', 0),
            'uptime': pct(all_u, all_n),
            'measured_days': measured, 'since': since,
        },
        'host': host() if os.path.exists('/proc/stat') else None,
        'spec': spec() if os.path.exists('/proc/stat') else [],
        'categories': out_cats,
        'incidents': load_incidents(),
    }
    return doc, unmapped

def load_incidents():
    try:
        with open(os.path.join(CFG['STATE_DIR'], 'incidents.json')) as f: return json.load(f)
    except Exception: return []

def fingerprint(doc):
    # everything except the timestamp and the live host numbers
    d = dict(doc); d.pop('generated_at', None); d.pop('host', None)
    return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()

def push(doc):
    with open(CFG['TOKEN_FILE']) as f: token = f.read().strip()
    body = json.dumps(doc, separators=(',', ':')).encode()
    # Cloudflare's integrity check rejects the stdlib's default
    # "Python-urllib/3.x" signature with 403 error code 1010, so say who we
    # actually are. The bearer token is what authenticates; this is identity.
    req = urllib.request.Request(CFG['INGEST_URL'], data=body, method='POST',
                                 headers={'authorization': 'Bearer ' + token,
                                          'content-type': 'application/json',
                                          'user-agent': 'labpush/1.0 (+https://lab.monk97.me)',
                                          'accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as r: return r.status, r.read().decode()

def cycle(state, pmap, do_push=True, do_print=False):
    now = dt.datetime.now(dt.timezone.utc)
    monitors = read_kuma()
    hist = load_hist()
    doc, unmapped = build(monitors, hist, pmap, now)
    if not do_print: save_hist(hist)
    if unmapped and state.get('warned') != sorted(unmapped):
        log('not published (unmapped in publish-map.json):', ', '.join(sorted(unmapped))); state['warned'] = sorted(unmapped)
    if do_print: print(json.dumps(doc, indent=1)); return
    fp = fingerprint(doc); due = time.time() - state.get('pushed_at', 0) >= CFG['HEARTBEAT']
    if fp != state.get('fp') or due:
        if do_push:
            try:
                st, body = push(doc); log('pushed', st, body[:80], '(change)' if fp != state.get('fp') else '(heartbeat)')
                state['fp'] = fp; state['pushed_at'] = time.time()
            except urllib.error.HTTPError as e:
                log('push refused', e.code, e.read().decode()[:200])
            except Exception as e:
                log('push failed', repr(e))

def selftest():
    fake = {'pve': {'up': True, 'pending': False, 'up24': 1.0, 'day': 1.0},
            'ollama': {'up': False, 'pending': False, 'up24': 0.9, 'day': 0.9},
            'not-in-map': {'up': True, 'pending': False, 'up24': 1.0, 'day': 1.0}}
    CFG['STATE_DIR'] = '/tmp/labpush-selftest'
    with open(CFG['MAP']) as f: pmap = json.load(f)
    doc, unmapped = build(fake, {}, pmap, dt.datetime(2026, 9, 17, tzinfo=dt.timezone.utc))
    assert unmapped == ['not-in-map'], unmapped
    labels = {s['label'] for c in doc['categories'] for s in c['services']}
    assert labels == {'Hypervisor', 'LLM inference'}, labels
    assert doc['summary']['state'] == 'degraded', doc['summary']
    blob = json.dumps(doc)
    assert 'not-in-map' not in blob and '192.168' not in blob
    # backup store: picked by type, warns from 80%, ignores a stale dump
    os.makedirs(CFG['STATE_DIR'], exist_ok=True)
    CFG['STORAGE_FILE'] = os.path.join(CFG['STATE_DIR'], 'storage.json')
    def dump(used):
        with open(CFG['STORAGE_FILE'], 'w') as f:
            json.dump([{'storage': 'local', 'type': 'dir', 'active': 1, 'total': 100, 'used': 99},
                       {'storage': 'pbs-x', 'type': 'pbs', 'active': 1, 'total': 400e9, 'used': used}], f)
    dump(100e9); b = backup_store()
    assert b == {'used_pct': 25.0, 'used_gb': 100.0, 'total_gb': 400.0, 'warn': False}, b
    dump(320e9); assert backup_store()['warn'] is True
    os.utime(CFG['STORAGE_FILE'], (0, 0)); assert backup_store() is None
    os.remove(CFG['STORAGE_FILE']); assert backup_store() is None
    print('selftest ok:', doc['summary'])

if __name__ == '__main__':
    if '--selftest' in sys.argv: selftest(); sys.exit(0)
    if not CFG['KUMA_URL']: sys.exit('KUMA_URL is required')
    with open(CFG['MAP']) as f: pmap = json.load(f)
    state = {}
    if '--once' in sys.argv or '--print' in sys.argv:
        cycle(state, pmap, do_push='--print' not in sys.argv, do_print='--print' in sys.argv); sys.exit(0)
    log('labpush up; polling every', CFG['INTERVAL'], 's, heartbeat', CFG['HEARTBEAT'], 's')
    while True:
        try: cycle(state, pmap)
        except Exception as e: log('cycle failed', repr(e))
        time.sleep(CFG['INTERVAL'])
