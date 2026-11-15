import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowUp,
  ArrowUpRight,
  Check,
  Clipboard,
  Copy,
  File,
  Image as ImageIcon,
  Link as LinkIcon,
  Monitor,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { z } from "zod";
import {
  identitySchema,
  type Identity,
  type Device,
  type Metadata,
  type Transfer,
  pairSchema,
} from "../../../packages/protocol";
import { utf8 } from "../../../packages/protocol/crypto";
import * as api from "./client";
import "./style.css";
type Item = Transfer & { info: Metadata; key: string };
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
const remaining = (expires: number) => {
  const minutes = Math.max(0, Math.ceil((expires - Date.now()) / 60000));
  return minutes >= 60
    ? `${Math.ceil(minutes / 60)}h left`
    : `${minutes}m left`;
};
const deviceName = () =>
  /iPhone|iPad/.test(navigator.userAgent)
    ? "My iPhone"
    : /Mac/.test(navigator.userAgent)
      ? "My Mac browser"
      : "Remote browser";
function App() {
  const [identity, setIdentity] = useState(api.storedIdentity),
    [initialized, setInitialized] = useState<boolean | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pair, setPair] = useState<api.PendingPair | null>(null),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(deviceName),
    [secret, setSecret] = useState("");
  const [items, setItems] = useState<Item[]>([]),
    [devices, setDevices] = useState<Device[]>([]),
    [queue, setQueue] = useState<Array<{ id: string }>>([]),
    [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<"inbox" | "connections">("inbox"),
    [target, setTarget] = useState("owner"),
    [text, setText] = useState(""),
    [drag, setDrag] = useState(false),
    [filter, setFilter] = useState("");
  const [code, setCode] = useState(""),
    [approval, setApproval] = useState<z.infer<typeof pairSchema> | null>(null),
    [preview, setPreview] = useState<{
      name: string;
      text?: string;
      url?: string;
    } | null>(null),
    [downloads, setDownloads] = useState<Set<string>>(new Set());
  const sending = useRef(false),
    refreshing = useRef(false),
    fileInput = useRef<HTMLInputElement>(null);
  const run = async (work: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void api
      .getHealth()
      .then((h) => setInitialized(h.initialized))
      .catch((e) => setError(message(e)));
    void api.loadPair().then((p) => {
      if (p && p.expiresAt > Date.now()) setPair(p);
    });
  }, []);
  useEffect(() => {
    if (!pair || identity) return;
    const interval = setInterval(() => {
      void api
        .pollPair(pair)
        .then((next) => {
          if (next) {
            setIdentity(next);
            setPair(null);
          }
        })
        .catch((e) => {
          setError(message(e));
          if (Date.now() > pair.expiresAt) {
            setPair(null);
            void api.cancelPair();
          }
        });
    }, 2000);
    return () => clearInterval(interval);
  }, [pair, identity]);
  const refresh = useCallback(async () => {
    if (!identity || refreshing.current) return;
    refreshing.current = true;
    try {
      const nextDevices =
        identity.scope === "owner" ? await api.getDevices(identity) : [];
      const transfers = await api.getTransfers(identity);
      const next = await Promise.all(
        transfers.map(async (item) => {
          const key = await api.scopeKey(item.scope, identity, nextDevices);
          return {
            ...item,
            key,
            info: await api.metadataFor(item, key).catch(() => ({
              name: "Unreadable item",
              type: "application/octet-stream",
              kind: "file" as const,
            })),
          };
        }),
      );
      setDevices(nextDevices);
      setItems(next);
      setQueue(await api.queueFor(identity));
      setConnected(true);
    } catch (e) {
      setConnected(false);
      setError(message(e));
    } finally {
      refreshing.current = false;
    }
  }, [identity]);
  const flush = useCallback(async () => {
    if (!identity || sending.current || !navigator.onLine) return;
    sending.current = true;
    try {
      for (const entry of await api.queueFor(identity)) {
        try {
          await api.sendQueued(entry, identity);
        } catch (e) {
          setError(message(e));
          break;
        }
      }
      setQueue(await api.queueFor(identity));
    } finally {
      sending.current = false;
    }
    await refresh();
  }, [identity, refresh]);
  useEffect(() => {
    void refresh();
    void flush();
    const interval = setInterval(() => {
      if (!document.hidden) {
        void flush();
      }
    }, 5000);
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", online);
    };
  }, [refresh, flush]);
  useEffect(
    () => () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  async function sendFiles(files: globalThis.File[]) {
    if (!identity) return;
    const scope = identity.scope === "session" ? identity.id : target,
      key = await api.scopeKey(scope, identity, devices);
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024)
        throw new Error(`${file.name} exceeds the 25 MiB limit.`);
      await api.enqueue(
        {
          name: file.name,
          type: file.type || "application/octet-stream",
          kind: "file",
        },
        new Uint8Array(await file.arrayBuffer()),
        scope,
        key,
        identity,
      );
    }
    setQueue(await api.queueFor(identity));
    await flush();
  }
  async function sendText() {
    if (!identity || !text.trim()) return;
    const scope = identity.scope === "session" ? identity.id : target,
      key = await api.scopeKey(scope, identity, devices);
    await api.enqueue(
      { name: text.trim().slice(0, 100), type: "text/plain", kind: "text" },
      utf8(text),
      scope,
      key,
      identity,
    );
    setText("");
    setQueue(await api.queueFor(identity));
    await flush();
  }
  async function read(item: Item) {
    const data = await api.download(item, item.key, identity!);
    setDownloads((previous) => new Set(previous).add(item.id));
    return data;
  }
  async function openItem(item: Item) {
    if (item.info.kind === "text") {
      setPreview({
        name: "Shared text",
        text: new TextDecoder().decode(await read(item)),
      });
    } else if (
      item.info.type.startsWith("image/") &&
      !item.info.type.includes("svg")
    ) {
      setPreview({
        name: item.info.name,
        url: URL.createObjectURL(
          new Blob([await read(item)], { type: item.info.type }),
        ),
      });
    } else {
      api.saveBytes(await read(item), item.info.name, item.info.type);
    }
  }
  function forget() {
    localStorage.removeItem("relay-identity");
    setIdentity(null);
    setItems([]);
    setPair(null);
    setError("");
    setNotice("Disconnected from this browser.");
  }
  async function restore(file: globalThis.File) {
    const restored = identitySchema.parse(
      JSON.parse(await file.text()) as unknown,
    );
    if (restored.server !== location.origin)
      throw new Error(`Open ${restored.server} to restore this recovery file.`);
    api.saveIdentity(restored);
    setIdentity(restored);
  }
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (identity) setDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (identity)
          void run(() => sendFiles(Array.from(e.dataTransfer.files)));
      }}
    >
      <header>
        <div className="brand">
          <Radio size={24} />
          <strong>Relay</strong>
        </div>
        <div className="header-right">
          {identity && (
            <>
              <span className={`status ${connected ? "online" : ""}`}>
                <span />
                {connected ? "Connected" : "Connecting"}
              </span>
              <button
                className="quiet"
                onClick={forget}
                title="Disconnect this browser"
              >
                <Unplug size={16} />
                <span>Disconnect</span>
              </button>
            </>
          )}
        </div>
      </header>
      {error && (
        <div className="alert" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss notice">
            <X size={16} />
          </button>
        </div>
      )}
      {!identity ? (
        <main className="onboarding">
          <div>
            <h1>
              Your things.
              <br />
              On the other device.
            </h1>
            <p className="lead">
              A temporary inbox for text, images, and files.
              <br />
              Send in either direction. Nothing to email.
            </p>
          </div>
          <section className="connect-panel">
            <label>
              Device name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoComplete="off"
              />
            </label>
            {initialized === false ? (
              <>
                <h2>Create your inbox</h2>
                <p>Enter the setup secret saved by your Relay service.</p>
                <label>
                  Setup secret
                  <input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <button
                  className="primary"
                  disabled={busy || !name.trim() || !secret}
                  onClick={() =>
                    void run(async () => {
                      setIdentity(await api.setup(secret, name));
                      setSecret("");
                      setInitialized(true);
                    })
                  }
                >
                  Create inbox <ArrowUpRight size={16} />
                </button>
              </>
            ) : pair ? (
              <>
                <h2>Approve this connection</h2>
                <p>
                  On a trusted device, open Connections and enter this code.
                </p>
                <code className="pair-code">
                  {pair.code.match(/.{1,4}/g)?.join(" ")}
                </code>
                <p>
                  {pair.scope === "owner"
                    ? "Personal device: access to your full inbox."
                    : "Temporary session: access only to its own transfers."}
                </p>
                <p className="small">
                  Expires{" "}
                  {new Date(pair.expiresAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  . Compare this code before approving.
                </p>
                <button
                  onClick={() => {
                    setPair(null);
                    void api.cancelPair();
                  }}
                >
                  Cancel request
                </button>
              </>
            ) : (
              <>
                <h2>Connect to your inbox</h2>
                <p>Approve once from a device you already trust.</p>
                <button
                  className="primary"
                  disabled={busy || !name.trim() || initialized === null}
                  onClick={() =>
                    void run(async () => {
                      setPair(await api.startPair(name, "owner"));
                    })
                  }
                >
                  Connect personal device <Plus size={16} />
                </button>
                <button
                  disabled={busy || !name.trim() || initialized === null}
                  onClick={() =>
                    void run(async () => {
                      setPair(await api.startPair(name, "session"));
                    })
                  }
                >
                  Start temporary session <Monitor size={16} />
                </button>
                <p className="small">
                  Use a temporary session on remote or shared computers. It
                  cannot see your existing inbox.
                </p>
              </>
            )}
            <label className="restore">
              Restore from a recovery file
              <input
                type="file"
                accept="application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void run(() => restore(file));
                  e.target.value = "";
                }}
              />
            </label>
          </section>
        </main>
      ) : (
        <main className="workspace">
          <aside>
            <div className="device-label">
              <Monitor size={17} />
              <span>{identity.name}</span>
            </div>
            <nav>
              <button
                className={tab === "inbox" ? "selected" : ""}
                onClick={() => setTab("inbox")}
              >
                <ArrowDownToLine size={17} />
                Inbox<span>{items.length}</span>
              </button>
              {identity.scope === "owner" && (
                <button
                  className={tab === "connections" ? "selected" : ""}
                  onClick={() => setTab("connections")}
                >
                  <Monitor size={17} />
                  Connections
                  <span>
                    {
                      devices.filter(
                        (d) =>
                          !d.revoked &&
                          (!d.expiresAt || d.expiresAt > Date.now()),
                      ).length
                    }
                  </span>
                </button>
              )}
            </nav>
            <div className="aside-foot">
              <ShieldCheck size={17} />
              <p>
                Encrypted on your device.
                <br />
                Items expire after 24 hours.
              </p>
              {identity.scope === "session" && (
                <p>
                  Temporary session
                  <br />
                  {remaining(identity.expiresAt!)}
                </p>
              )}
            </div>
          </aside>
          <div className="content">
            {tab === "inbox" ? (
              <>
                <div className="section-head">
                  <div>
                    <h1>Inbox</h1>
                    <p>
                      {identity.scope === "owner"
                        ? "Available across your personal devices."
                        : "Only transfers shared with this session."}
                    </p>
                  </div>
                  <button
                    className="icon"
                    onClick={() => void run(refresh)}
                    aria-label="Refresh inbox"
                  >
                    <RefreshCw size={17} />
                  </button>
                </div>
                <section
                  className="composer"
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.length) {
                      e.preventDefault();
                      void run(() => sendFiles(files));
                    }
                  }}
                >
                  <div className="compose-top">
                    <span>Send to</span>
                    {identity.scope === "owner" ? (
                      <select
                        aria-label="Destination"
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                      >
                        <option value="owner">My devices</option>
                        {devices
                          .filter(
                            (d) =>
                              d.scope === "session" &&
                              !d.revoked &&
                              d.expiresAt! > Date.now(),
                          )
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <strong>My personal devices</strong>
                    )}
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste text or a link. Drop files anywhere."
                    aria-label="Text to send"
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void run(sendText);
                      }
                    }}
                  />
                  <div className="compose-bottom">
                    <input
                      hidden
                      ref={fileInput}
                      type="file"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        void run(() => sendFiles(files));
                      }}
                    />
                    <button
                      onClick={() => fileInput.current?.click()}
                      disabled={busy}
                    >
                      <Plus size={17} />
                      Add files
                    </button>
                    <span className="small">25 MiB per file</span>
                    <button
                      className="primary"
                      disabled={busy || !text.trim()}
                      onClick={() => void run(sendText)}
                    >
                      Send <ArrowUp size={16} />
                    </button>
                  </div>
                </section>
                {queue.length > 0 && (
                  <section className="queued">
                    <div>
                      <strong>{queue.length} queued</strong>
                      <span>
                        Encrypted locally.{" "}
                        {navigator.onLine
                          ? "Retrying while this page is open."
                          : "Waiting for a connection."}
                      </span>
                    </div>
                    <button onClick={() => void run(flush)} disabled={busy}>
                      Retry
                    </button>
                    <button
                      title="Discard queued uploads"
                      onClick={() =>
                        void run(async () => {
                          for (const e of queue)
                            await api.discardQueued(e.id, identity);
                          setQueue([]);
                        })
                      }
                    >
                      <X size={15} />
                    </button>
                  </section>
                )}
                <div className="list-head">
                  <span>
                    {items.length} {items.length === 1 ? "item" : "items"}
                  </span>
                  <input
                    type="search"
                    aria-label="Filter inbox"
                    placeholder="Find an item"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                {items.length === 0 ? (
                  <div className="empty">
                    <ArrowDownToLine size={30} />
                    <h2>Ready for the next thing</h2>
                    <p>
                      Send from another device, or add something above.
                      <br />
                      It will be here until it expires.
                    </p>
                  </div>
                ) : (
                  <div className="item-list">
                    {items
                      .filter((i) =>
                        i.info.name
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                      )
                      .map((item) => (
                        <article key={item.id} className="item">
                          <div className="item-symbol">
                            {item.info.kind === "text" ? (
                              /^https?:\/\//.test(item.info.name) ? (
                                <LinkIcon size={20} />
                              ) : (
                                <Clipboard size={20} />
                              )
                            ) : item.info.type.startsWith("image/") ? (
                              <ImageIcon size={20} />
                            ) : (
                              <File size={20} />
                            )}
                          </div>
                          <button
                            className="item-main"
                            onClick={() => void run(() => openItem(item))}
                          >
                            <strong>{item.info.name}</strong>
                            <span>
                              {item.info.kind === "text"
                                ? "Text"
                                : bytes(Math.max(0, item.size - 28))}{" "}
                              · {remaining(item.expiresAt)}
                              {downloads.has(item.id) ? " · Downloaded" : ""}
                              {item.scope !== "owner"
                                ? ` · ${devices.find((d) => d.id === item.scope)?.name ?? "This session"}`
                                : ""}
                            </span>
                          </button>
                          <div className="item-actions">
                            {item.info.kind === "text" && (
                              <button
                                className="icon"
                                title="Copy text"
                                aria-label={`Copy ${item.info.name}`}
                                onClick={() =>
                                  void run(async () => {
                                    await navigator.clipboard.writeText(
                                      new TextDecoder().decode(
                                        await read(item),
                                      ),
                                    );
                                    setNotice("Copied to clipboard.");
                                  })
                                }
                              >
                                <Copy size={16} />
                              </button>
                            )}
                            <button
                              className="icon"
                              title="Save a copy"
                              aria-label={`Save ${item.info.name}`}
                              onClick={() =>
                                void run(async () =>
                                  api.saveBytes(
                                    await read(item),
                                    item.info.kind === "text"
                                      ? "shared-text.txt"
                                      : item.info.name,
                                    item.info.type,
                                  ),
                                )
                              }
                            >
                              <ArrowDownToLine size={16} />
                            </button>
                            <button
                              className="icon"
                              title="Delete from Relay"
                              aria-label={`Delete ${item.info.name}`}
                              onClick={() =>
                                void run(async () => {
                                  await api.removeTransfer(item.id, identity);
                                  await refresh();
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </article>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="section-head">
                  <div>
                    <h1>Connections</h1>
                    <p>Approve a device or end its access.</p>
                  </div>
                </div>
                <section className="approval">
                  <h2>Approve a connection</h2>
                  <p>Enter the code displayed on the new device.</p>
                  <div className="inline">
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="ABCD 1234 EFGH"
                      aria-label="Pairing code"
                    />
                    <button
                      disabled={busy || code.replace(/\s/g, "").length !== 12}
                      onClick={() =>
                        void run(async () =>
                          setApproval(await api.findPair(code, identity)),
                        )
                      }
                    >
                      Find device
                    </button>
                  </div>
                  {approval && (
                    <div className="approval-detail">
                      <strong>{approval.name}</strong>
                      <p>
                        {approval.scope === "owner"
                          ? "Personal device. This grants full inbox access and permission to approve devices."
                          : "Temporary browser. This grants access only to transfers in its session, for 4 hours."}
                      </p>
                      <code>{approval.code.match(/.{1,4}/g)?.join(" ")}</code>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api.approvePair(approval, identity);
                            setApproval(null);
                            setCode("");
                            setNotice("Connection approved.");
                            await refresh();
                          })
                        }
                      >
                        <Check size={16} />
                        Approve matching code
                      </button>
                      <button onClick={() => setApproval(null)}>Cancel</button>
                    </div>
                  )}
                </section>
                <div className="device-list">
                  {devices.map((device) => (
                    <div className="device" key={device.id}>
                      {device.scope === "session" ? (
                        <Monitor size={20} />
                      ) : (
                        <Smartphone size={20} />
                      )}
                      <div>
                        <strong>
                          {device.name}
                          {device.id === identity.id ? " (this device)" : ""}
                        </strong>
                        <span>
                          {device.revoked
                            ? "Revoked"
                            : device.expiresAt
                              ? remaining(device.expiresAt)
                              : "Personal device"}
                        </span>
                      </div>
                      {!device.revoked && device.id !== identity.id && (
                        <button
                          onClick={() =>
                            void run(async () => {
                              await api.revoke(device.id, identity);
                              await refresh();
                            })
                          }
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <section className="recovery">
                  <h2>Recovery file</h2>
                  <p>
                    Keep a recovery file somewhere private. Anyone with it can
                    access your inbox. Without a trusted device or this file,
                    encrypted items cannot be recovered.
                  </p>
                  <button
                    onClick={() =>
                      api.saveBytes(
                        utf8(JSON.stringify(identity, null, 2)),
                        "relay-recovery.json",
                        "application/json",
                      )
                    }
                  >
                    Save recovery file <ArrowDownToLine size={16} />
                  </button>
                </section>
              </>
            )}
          </div>
        </main>
      )}
      {drag && (
        <div className="drop-overlay">
          <ArrowDownToLine size={36} />
          <h2>Drop to send</h2>
          <p>
            To{" "}
            {identity?.scope === "session"
              ? "your personal devices"
              : target === "owner"
                ? "your devices"
                : devices.find((d) => d.id === target)?.name}
          </p>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <section
            className="preview"
            role="dialog"
            aria-modal="true"
            aria-label={preview.name}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2>{preview.name}</h2>
              <button
                className="icon"
                autoFocus
                onClick={() => setPreview(null)}
                aria-label="Close preview"
              >
                <X size={20} />
              </button>
            </div>
            {preview.url ? (
              <img src={preview.url} alt={preview.name} />
            ) : (
              <pre>{preview.text}</pre>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
