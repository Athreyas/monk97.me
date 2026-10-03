#!/usr/bin/env python3
"""Generate sites/lab/status.json — the design fixture and schema reference.

This is the exact shape the collector must emit. Note what is absent:
no hostname, no IP, no port, no version, no monitor name from Kuma.
"""
import json, datetime as dt, random

random.seed(97)
TODAY = dt.date.today()
WINDOW = 90

# (date, days, severity) — severity 0.0 = full outage, 0.5 = degraded
INCIDENTS = [
    (dt.date(2026, 9, 11), 1, 0.35, "Relocation — uplink on the wrong NIC", 840),
    (dt.date(2026, 9, 6),  2, 0.55, "Planned: physical relocation", 2880),
    (dt.date(2026, 7, 29), 1, 0.7,  "GPU passthrough lost after host reboot", 95),
]

CATS = [
    ("virtualisation", "Virtualisation", [
        ("Hypervisor", 99.98), ("Guest fleet", 99.71),
        ("Backup server", 99.89), ("Backup freshness", 100.0)]),
    ("network", "Network & DNS", [
        ("Reverse proxy", 99.94), ("DNS filtering", 99.99),
        ("Mesh VPN", 99.87), ("TLS certificates", 100.0)]),
    ("compute", "Compute & AI", [
        ("GPU node", 99.12), ("LLM inference", 98.74),
        ("Chat interface", 97.90), ("Notebook environment", 99.40)]),
    ("storage", "Storage & Backup", [
        ("Network storage", 99.96), ("NFS export", 99.62),
        ("Backup retention", 100.0)]),
    ("observability", "Observability", [
        ("Uptime monitoring", 99.95), ("Metrics", 99.81),
        ("Log aggregation", 99.77)]),
    ("media", "Media & Home", [
        ("Media server", 99.68), ("Home automation bridge", 99.93)]),
    ("access", "Remote Access", [
        ("Isolated browser", 99.55), ("Remote desktop", 98.20),
        ("Tools dashboard", 99.90), ("Documentation", 99.97)]),
]

def beats(sensitivity):
    """90 daily buckets. 1 = clean, 0..1 = partial, None = before records."""
    out = []
    for i in range(WINDOW):
        day = TODAY - dt.timedelta(days=WINDOW - 1 - i)
        v = 1.0
        for idate, ddays, sev, _, _ in INCIDENTS:
            if idate <= day < idate + dt.timedelta(days=ddays):
                v = min(v, 1 - (1 - sev) * sensitivity)
        if v == 1.0 and random.random() < 0.035:
            v = round(random.uniform(0.94, 0.995), 3)
        out.append(round(v, 3))
    return out

cats = []
for cid, label, svcs in CATS:
    sens = 1.0 if cid in ("compute", "access") else 0.7
    up = round(sum(s[1] for s in svcs) / len(svcs), 2)
    cats.append({
        "id": cid, "label": label, "state": "operational",
        "uptime": up,
        # per-service history too, so a flat table view isn't forced to
        # borrow the category's bar and imply something it doesn't measure
        "services": [{"label": n, "state": "up", "uptime": u,
                      "beats": beats(sens)} for n, u in svcs],
        "beats": beats(sens),
    })

total_svcs = sum(len(c["services"]) for c in cats)
doc = {
    "v": 1,
    "fixture": True,   # suppresses the staleness banner during preview
    # the real collector stamps this; for the fixture, "just now" so the
    # staleness path doesn't fire and look like a fault during preview
    "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
                      .isoformat().replace("+00:00", "Z"),
    "window_days": WINDOW,
    "summary": {
        "state": "operational",
        "services": total_svcs,
        "nodes": 12,
        "gpus": 1,
        "uptime": round(sum(c["uptime"] for c in cats) / len(cats), 2),
        "measured_days": WINDOW,
        "since": (TODAY - dt.timedelta(days=WINDOW - 1)).isoformat(),
        "streak_days": 5,
        "mttr_min": 312,
    },
    # host vitals — numbers only, no names that resolve to anything
    "host": {
        "cpu_pct": 14.2, "load1": 0.84, "cores": 32,
        "mem_pct": 61.3, "mem_used_gb": 38.0, "mem_total_gb": 62.0,
        "disk_pct": 21.0, "disk_used_gb": 318.0, "disk_total_gb": 1512.0,
        "gpu": {"model": "RTX 3060 Ti", "util_pct": 3.0, "mem_pct": 22.0, "temp_c": 41},
        "uptime_days": 3,
    },
    # host spec — static hardware. Unlike everything else in this fixture
    # these are the real figures: the collector reads them off the box and
    # will emit exactly this, so the preview matches production.
    "spec": [
        {"k": "CPU",      "v": "Intel Xeon E5-2697A v4 · 16C / 32T · 2.6–3.6 GHz"},
        {"k": "GPU",      "v": "RTX 3060 Ti · 8 GB"},
        {"k": "MEMORY",   "v": "64 GB"},
        {"k": "STORAGE",  "v": "1.5 TB · NVMe + SATA SSD"},
        {"k": "NETWORK",  "v": "1 GbE"},
        {"k": "PLATFORM", "v": "Proxmox VE 9.2"},
    ],
    "categories": cats,
    "incidents": [
        {"date": d.isoformat(), "title": t, "duration_min": m, "resolved": True}
        for d, _, _, t, m in INCIDENTS
    ],
}

with open("sites/lab/status.json", "w") as f:
    json.dump(doc, f, separators=(",", ":"))   # generated feed, not hand-read
    f.write("\n")
print(f"{total_svcs} services / {len(cats)} categories / {WINDOW} beats each")
