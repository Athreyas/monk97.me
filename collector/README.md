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
    INGEST_URL=https://monk97-lab.pages.dev/api/ingest
    TOKEN_FILE=/etc/labpush/token
    STATE_DIR=/var/lib/labpush
    ENV
    chown -R labpush /var/lib/labpush
    cp labpush.service /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now labpush
    journalctl -fu labpush

**Use the `pages.dev` URL, not the custom domain.** The custom domain may
resolve to something else inside the network (split-horizon DNS is the point
of a lab), in which case the push lands on an internal reverse proxy and
comes back 404 from a server that has never heard of `/api/ingest`. The
`pages.dev` hostname is only ever the edge.

### Backup store fill

The vitals strip shows how full the backup datastore is (`host.backup`), red
from 80% — a full PBS quota fails every nightly job while the server and its
monitor stay green. labpush cannot query the PVE API as an unprivileged user,
so root dumps the storage list for it every five minutes:

    echo '*/5 * * * * root pvesh get /nodes/$(hostname)/storage --output-format json > /var/lib/labpush/storage.json.tmp && mv /var/lib/labpush/storage.json.tmp /var/lib/labpush/storage.json' > /etc/cron.d/labpush-storage

It watches the first storage of type `pbs`; set `BACKUP_STORAGE=<id>` in
`/etc/labpush/env` to pick another. A dump older than 30 minutes is ignored,
and the meter disappears rather than show a stale number.

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
