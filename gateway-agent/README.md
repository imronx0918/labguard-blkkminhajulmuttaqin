# LAB GATEWAY AGENT

Agent Python 3 (hanya pustaka standar) yang berjalan di Ubuntu Server pada jaringan lab.
Lihat `../docs/gateway-setup.md` untuk instalasi lengkap.

```
python3 labguard_agent.py init-config --server https://labguard.sekolah.sch.id --out /etc/labguard-agent/agent.json
python3 labguard_agent.py --config /etc/labguard-agent/agent.json pair --code ABCDE-FGHJK
python3 labguard_agent.py --config /etc/labguard-agent/agent.json validate   # dry-run
python3 labguard_agent.py --config /etc/labguard-agent/agent.json run
```

Uji: `python3 -m unittest discover -s tests -v`
