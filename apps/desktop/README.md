# apps/desktop

The Tauri 2 shell around the same React code (FLINK_API.md). `src-tauri/` holds the Rust side: the one command
`flink_request` (direct and HTTP proxy; none, basic, bearer and custom headers, secrets from the OS keychain) and
`secret_set` / `secret_delete`.

- Run: `pnpm --filter @sl/desktop tauri dev` (needs Rust: `rustup`).
- Rust tests: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.
- Not built yet: token command, mTLS and CA files, SSH and Kubernetes tunnels (CONN-06/12), installers (INST-01).
