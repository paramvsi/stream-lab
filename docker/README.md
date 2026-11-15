# Local Flink clusters

One compose file covers every supported version (docs/FLINK_API.md: 1.20 and 2.x):

```sh
FLINK_VERSION=2.2 docker compose -f docker/compose.yml up -d   # 1.20 | 2.0 | 2.2 | 2.3
FLINK_VERSION=2.2 docker compose -f docker/compose.yml down -v
```

Each version gets its own compose project (`streamlab-flink-<version>`). They all use ports 8081, 8083 and 9092, so run one at a time.

| Service           | Host address                                    |
| ----------------- | ----------------------------------------------- |
| REST API / Web UI | http://localhost:8081                           |
| SQL Gateway       | http://localhost:8083 (`GET /v1/info`)          |
| Kafka             | localhost:9092 (kafka:19092 inside the network) |

Not here yet (added with the milestone that needs them):

- the Kafka SQL connector jar for the gateway (M9), and the sample data loader (M7);
- Caddy proxy with a base path and basic auth, self-signed TLS, mTLS, the HA leader-kill compose, and toxiproxy (M6, M11).
