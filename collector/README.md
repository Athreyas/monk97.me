# labpush — the collector

Runs **on the hypervisor host**: it sees every guest on the LAN and can read
the GPU with `nvidia-smi`. Stdlib Python only.

## One-time setup in Uptime Kuma

Create a **status page** with slug `lab` and add every monitor from
`docs/lab-monitors.md` to it. The monitor **names** must match the keys in
`publish-map.json` (`pve`, `npm`, `ollama`, …). A monitor that is not in the
map is silently not published — that is the point.

## Install (as root on the host)

    useradd -r -s /usr/sbin/nologin labpush
    mkdir -p /opt/labpush /etc/labpush /var/lib/labpush
    cp labpush.py publish-map.json /opt/labpush/
    # the ingest token is generated locally and kept outside this repo
    install -m 600 -o labpush /path/to/lab-ingest.token /etc/labpush/token
    cat > /etc/labpush/env <<'ENV'
    KUMA_URL=http://<kuma-host>:3001
    KUMA_SLUG=lab
    INGEST_URL=https://lab.monk97.me/api/ingest
    TOKEN_FILE=/etc/labpush/token
    STATE_DIR=/var/lib/labpush
    ENV
    chown -R labpush /var/lib/labpush
    cp labpush.service /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now labpush
    journalctl -fu labpush

Check the payload before trusting it: `sudo -u labpush env $(cat /etc/labpush/env) python3 /opt/labpush/labpush.py --print`.

## Incidents

`/var/lib/labpush/incidents.json` — a JSON list of
`{"date":"YYYY-MM-DD","title":"…","duration_min":N,"resolved":true}`. Hand-
written on purpose: an incident deserves a sentence, not an auto-generated one.

## What leaves the box

Labels from the map, up/down states, percentages, 90 daily buckets per
service, and host numbers (cpu, mem, disk, gpu, load, uptime). The edge
worker additionally rejects any push containing an IP, port, hostname suffix
or URL, so a misconfigured map still cannot publish an address.
