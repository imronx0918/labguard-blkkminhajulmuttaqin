# Alternatif Docker untuk agent. Membutuhkan --network host dan CAP_NET_ADMIN.
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends python3 nftables dnsmasq ca-certificates && rm -rf /var/lib/apt/lists/*
COPY . /opt/labguard-agent
ENTRYPOINT ["python3", "/opt/labguard-agent/labguard_agent.py", "--config", "/etc/labguard-agent/agent.json"]
CMD ["run"]
