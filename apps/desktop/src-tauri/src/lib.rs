//! The desktop shell (FLINK_API.md "How the app reaches a cluster"): every cluster request goes through the one
//! command `flink_request`, which adds the base URL, base path, login (from the OS keychain), headers, proxy and
//! timeout. Secrets never reach JS after save and are never logged: this crate logs nothing.
//! ponytail: direct + HTTP proxy only; token command, mTLS, CA files, SSH and port-forward come with CONN-06/12.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const SERVICE: &str = "Stream Lab";

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum Auth {
    None,
    Basic { user: String },
    Bearer,
    TokenCommand,
    Mtls,
}

#[derive(Deserialize)]
struct Header {
    name: String,
    value: Option<String>,
    secret: bool,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum Transport {
    Direct,
    Proxy { url: String, user: Option<String> },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Gateway {
    url: String,
    same_login: bool,
    auth: Option<Auth>,
}

/// The saved connection as JS holds it (no secrets in it).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conn {
    id: String,
    url: String,
    base_path: String,
    auth: Auth,
    headers: Vec<Header>,
    transport: Transport,
    gateway: Option<Gateway>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Req {
    method: String,
    path: String,
    query: Option<HashMap<String, String>>,
    body: Option<serde_json::Value>,
    timeout_ms: Option<u64>,
    gateway: Option<bool>,
}

#[derive(Serialize)]
pub struct Resp {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
    url: String,
}

/// TransportFailure in packages/flink/src/http.ts.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    kind: &'static str,
    host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_s: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    proxy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
}

impl Failure {
    fn new(kind: &'static str, host: &str) -> Self {
        Failure {
            kind,
            host: host.into(),
            port: None,
            timeout_s: None,
            reason: None,
            proxy: None,
            status: None,
        }
    }
    fn io(host: &str, reason: &str) -> Self {
        Failure {
            reason: Some(reason.into()),
            ..Failure::new("io", host)
        }
    }
}

/// The secret part names match secretKey() in packages/flink/src/connection.ts.
fn key(conn: &str, part: &str) -> String {
    format!("streamlab/{conn}/{part}")
}

fn secret(k: &str) -> Result<Option<String>, keyring::Error> {
    match keyring::Entry::new(SERVICE, k)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

/// base URL + base path + path, with exactly one "/" at each join.
fn join(base: &str, base_path: &str, path: &str) -> String {
    let mut out = base.trim_end_matches('/').to_string();
    let bp = base_path.trim_matches('/');
    if !bp.is_empty() {
        out.push('/');
        out.push_str(bp);
    }
    out.push('/');
    out.push_str(path.trim_start_matches('/'));
    out
}

/// A reqwest error as its transport kind. The text checks follow hyper/rustls's messages.
fn classify(
    e: &reqwest::Error,
    host: &str,
    port: Option<u16>,
    timeout_s: u64,
    proxy: Option<&str>,
) -> Failure {
    if e.is_timeout() {
        return Failure {
            timeout_s: Some(timeout_s),
            ..Failure::new("timeout", host)
        };
    }
    let mut chain = String::new();
    let mut src: Option<&dyn std::error::Error> = Some(e);
    while let Some(s) = src {
        chain.push_str(&s.to_string().to_lowercase());
        chain.push(' ');
        src = s.source();
    }
    kind_of(&chain, host, port, proxy)
}

fn kind_of(chain: &str, host: &str, port: Option<u16>, proxy: Option<&str>) -> Failure {
    if let Some(p) = proxy {
        if chain.contains("407") || chain.contains("tunnel") || chain.contains("proxy") {
            let status = ["407", "403", "502", "503"]
                .iter()
                .find(|s| chain.contains(*s))
                .and_then(|s| s.parse().ok());
            return Failure {
                proxy: Some(p.into()),
                status,
                ..Failure::new("proxy", host)
            };
        }
    }
    if chain.contains("dns error")
        || chain.contains("failed to lookup")
        || chain.contains("nodename nor servname")
    {
        return Failure::new("dns", host);
    }
    if chain.contains("connection refused") {
        return Failure {
            port,
            ..Failure::new("refused", host)
        };
    }
    if chain.contains("unknownissuer")
        || chain.contains("unknown issuer")
        || chain.contains("self-signed")
        || chain.contains("self signed")
        || chain.contains("notvalidforname")
        || chain.contains("expired")
    {
        let reason = if chain.contains("notvalidforname") {
            "name mismatch"
        } else if chain.contains("expired") {
            "expired"
        } else if chain.contains("self") {
            "self-signed"
        } else {
            "unknown issuer"
        };
        return Failure {
            reason: Some(reason.into()),
            ..Failure::new("tls_untrusted", host)
        };
    }
    if chain.contains("tls") || chain.contains("certificate") || chain.contains("handshake") {
        return Failure {
            reason: Some("TLS handshake failed".into()),
            ..Failure::new("tls_other", host)
        };
    }
    if chain.contains("reset") {
        return Failure::io(host, "connection reset");
    }
    Failure::io(host, "connection closed")
}

#[tauri::command]
async fn flink_request(
    conn: Conn,
    req: Req,
    inline: Option<HashMap<String, String>>,
) -> Result<Resp, Failure> {
    // Test before save: the form's typed secrets, by part ("login", "gateway", "proxy"); else the keychain.
    let inline = inline.unwrap_or_default();
    let secret = |part: &str| match inline.get(part) {
        Some(v) => Ok(Some(v.clone())),
        None => secret(&key(&conn.id, part)),
    };
    let to_gateway = req.gateway.unwrap_or(false);
    let base = match (&conn.gateway, to_gateway) {
        (Some(g), true) => g.url.clone(),
        _ => conn.url.clone(),
    };
    let parsed = reqwest::Url::parse(&base).map_err(|_| Failure::io(&base, "invalid address"))?;
    let host = parsed.host_str().unwrap_or("").to_string();
    let port = parsed.port_or_known_default();
    // The gateway's base path is its own address's; the REST base path is only for REST.
    let url = join(
        &base,
        if to_gateway && conn.gateway.is_some() {
            ""
        } else {
            &conn.base_path
        },
        &req.path,
    );
    let timeout_ms = req.timeout_ms.unwrap_or(10_000);
    // CONN-KEYCHAIN in JS: the platform's text is not passed on (it can name the entry).
    let keychain = |_: keyring::Error| Failure::new("keychain", &host);

    let mut b = reqwest::Client::builder().timeout(Duration::from_millis(timeout_ms));
    let mut proxy_url = None;
    if let Transport::Proxy { url: p, user } = &conn.transport {
        let mut px =
            reqwest::Proxy::all(p).map_err(|_| Failure::io(&host, "invalid proxy address"))?;
        if let Some(u) = user {
            let pw = secret("proxy").map_err(keychain)?.unwrap_or_default();
            px = px.basic_auth(u, &pw);
        }
        proxy_url = Some(p.clone());
        b = b.proxy(px);
    }
    let client = b.build().map_err(|_| Failure::io(&host, "client setup"))?;
    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|_| Failure::io(&host, "bad method"))?;
    let mut rb = client.request(method, &url);
    if let Some(q) = &req.query {
        rb = rb.query(q);
    }
    if let Some(body) = &req.body {
        rb = rb.json(body);
    }

    // The login: the gateway's own when it has one, else the REST login.
    let (auth, part) = match (&conn.gateway, to_gateway) {
        (
            Some(Gateway {
                same_login: false,
                auth: Some(a),
                ..
            }),
            true,
        ) => (a, "gateway"),
        _ => (&conn.auth, "login"),
    };
    match auth {
        Auth::None => {}
        Auth::Basic { user } => {
            let pw = secret(part).map_err(keychain)?.unwrap_or_default();
            let raw = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pw}"));
            rb = rb.header("Authorization", format!("Basic {raw}"));
        }
        Auth::Bearer => {
            let t = secret(part).map_err(keychain)?.unwrap_or_default();
            rb = rb.header("Authorization", format!("Bearer {t}"));
        }
        Auth::TokenCommand | Auth::Mtls => {
            return Err(Failure::io(&host, "this login type is not supported yet"))
        }
    }
    for h in &conn.headers {
        let v = if h.secret || h.value.is_none() {
            secret(&format!("header:{}", h.name.trim().to_lowercase())).map_err(keychain)?
        } else {
            h.value.clone()
        };
        if let Some(v) = v {
            rb = rb.header(h.name.trim(), v);
        }
    }

    let r = rb
        .send()
        .await
        .map_err(|e| classify(&e, &host, port, timeout_ms / 1000, proxy_url.as_deref()))?;
    let status = r.status().as_u16();
    let final_url = r.url().to_string();
    let headers = r
        .headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|v| (k.as_str().to_lowercase(), v.to_string()))
        })
        .collect();
    let body = r
        .text()
        .await
        .map_err(|e| classify(&e, &host, port, timeout_ms / 1000, proxy_url.as_deref()))?;
    Ok(Resp {
        status,
        headers,
        body,
        url: final_url,
    })
}

/// Keychain writes from the connection form's save (CONN-03). The error text is the platform's, never the secret.
#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    keyring::Entry::new(SERVICE, &key)
        .and_then(|e| e.set_password(&value))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match keyring::Entry::new(SERVICE, &key).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            flink_request,
            secret_set,
            secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stream Lab");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_has_one_slash_at_each_seam() {
        assert_eq!(
            join("https://h:8081/", "", "/jobs/overview"),
            "https://h:8081/jobs/overview"
        );
        assert_eq!(
            join("https://h", "/proxy/app_1/", "config"),
            "https://h/proxy/app_1/config"
        );
        assert_eq!(
            join("https://h/", "flink", "/v1/info"),
            "https://h/flink/v1/info"
        );
    }

    #[test]
    fn kinds_from_error_text() {
        let k = |s: &str, p: Option<&str>| kind_of(s, "h", Some(8081), p).kind;
        assert_eq!(
            k(
                "error sending request: dns error: failed to lookup address",
                None
            ),
            "dns"
        );
        assert_eq!(
            k("tcp connect error: connection refused (os error 61)", None),
            "refused"
        );
        assert_eq!(
            k("invalid peer certificate: unknownissuer", None),
            "tls_untrusted"
        );
        assert_eq!(
            k("received fatal alert: handshakefailure tls", None),
            "tls_other"
        );
        assert_eq!(k("connection reset by peer", None), "io");
        assert_eq!(
            k("unsuccessful tunnel 407", Some("http://px:3128")),
            "proxy"
        );
        // Without a proxy, a "proxy" word in a message is not a proxy failure.
        assert_eq!(k("connection refused proxy", None), "refused");
    }

    #[test]
    fn proxy_failure_carries_its_status() {
        let f = kind_of("unsuccessful tunnel 407", "h", None, Some("http://px:3128"));
        assert_eq!(f.status, Some(407));
        assert_eq!(f.proxy.as_deref(), Some("http://px:3128"));
    }

    #[test]
    fn conn_deserializes_from_the_js_shape() {
        let c: Conn = serde_json::from_str(
            r#"{"id":"a","name":"n","url":"https://h:8081","kind":"standalone",
          "env":"dev","readOnly":false,"basePath":"","auth":{"type":"basic","user":"u"},
          "headers":[{"name":"X-Team","value":"pay","secret":false},{"name":"X-Key","secret":true}],
          "transport":{"type":"proxy","url":"http://px:3128"},"timeoutMs":10000,"pollMs":5000,
          "gateway":{"url":"https://g:8083","sameLogin":false,"auth":{"type":"bearer"}}}"#,
        )
        .unwrap();
        assert!(matches!(c.auth, Auth::Basic { .. }));
        assert!(matches!(c.transport, Transport::Proxy { .. }));
        assert!(c
            .gateway
            .is_some_and(|g| !g.same_login && matches!(g.auth, Some(Auth::Bearer))));
    }
}
