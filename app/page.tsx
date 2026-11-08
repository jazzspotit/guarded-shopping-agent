"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ModelMessage = { role: string; content: unknown };
type ToolEvent = { id: string; tool: string; input: unknown; output: any };
type Turn =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; events: ToolEvent[] }
  | { kind: "note"; text: string };
type Policy = { budgetUsd: number; approvalThresholdUsd: number; blockedMerchants: string[] };
type Order = {
  orderId: string;
  status: string;
  approveUrl?: string;
  captureId?: string;
  refundId?: string;
  createdAt: string;
  events: { at: string; type: string; detail?: string }[];
  product: { title: string; price: number; image: string | null; merchant: string };
};

const SUGGESTIONS = [
  "Find a pour-over coffee kettle under $60 for my dad's birthday",
  "I need a waterproof phone pouch for a motorcycle trip, max $25",
  "Get me a gift for a coffee lover, around $40",
];
const STORAGE_KEY = "gsa-state-v1";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [messages, setMessages] = useState<ModelMessage[]>([]);
  const [policy, setPolicy] = useState<Policy>({ budgetUsd: 60, approvalThresholdUsd: 40, blockedMerchants: [] });
  const [approvedIds, setApprovedIds] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  // Restore state (survives the PayPal redirect) and read the return status.
  useEffect(() => {
    const s = load(STORAGE_KEY, null as null | { turns: Turn[]; messages: ModelMessage[]; policy: Policy; approvedIds: string[] });
    if (s) {
      setTurns(s.turns);
      setMessages(s.messages);
      setPolicy(s.policy);
      setApprovedIds(s.approvedIds);
    }
    const q = new URLSearchParams(window.location.search);
    const order = q.get("order");
    const status = q.get("status");
    if (order && status) {
      const ok = status === "COMPLETED";
      const text = ok
        ? `Payment completed for order ${order}.`
        : status === "CANCELLED"
          ? `You cancelled order ${order} in PayPal.`
          : `Order ${order}: ${status}${q.get("error") ? ` — ${q.get("error")}` : ""}`;
      setBanner({ ok, text });
      setTurns((t) => [...t, { kind: "note", text }]);
      setMessages((m) => [...m, { role: "user", content: `[app event] PayPal order ${order} is now ${status}.` }]);
      window.history.replaceState(null, "", "/");
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ turns, messages, policy, approvedIds }));
    } catch {}
  }, [turns, messages, policy, approvedIds, hydrated]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  // Poll order timeline (includes webhook events).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/orders", { cache: "no-store" });
        const d = await r.json();
        if (alive) setOrders(d.orders ?? []);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const send = useCallback(
    async (text: string, extraApproved?: string[]) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      const approved = extraApproved ? [...new Set([...approvedIds, ...extraApproved])] : approvedIds;
      if (extraApproved) setApprovedIds(approved);
      const next = [...messages, { role: "user", content: trimmed }];
      setTurns((t) => [...t, { kind: "user", text: trimmed }]);
      setMessages(next);
      setInput("");
      setBusy(true);
      try {
        const r = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: next, policy, approvedIds: approved }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        setModel(d.model);
        setMessages([...next, ...d.messages]);
        setTurns((t) => [...t, { kind: "assistant", text: d.text, events: d.toolEvents ?? [] }]);
      } catch (e) {
        setTurns((t) => [...t, { kind: "note", text: `⚠️ ${e instanceof Error ? e.message : String(e)}` }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, policy, approvedIds],
  );

  const reset = () => {
    setTurns([]);
    setMessages([]);
    setApprovedIds([]);
    setBanner(null);
  };

  const allEvents = turns.flatMap((t) => (t.kind === "assistant" ? t.events : []));

  return (
    <main className="app">
      <header className="top">
        <h1>🛡️ Guarded Shopping Agent</h1>
        <span className="tag">Give an AI a budget, not your card · Channel3 search + PayPal checkout</span>
        {model && <span className="pill">{model}</span>}
        <span className="pill">PayPal sandbox</span>
      </header>
      {banner && <div className={`banner ${banner.ok ? "ok" : "bad"}`}>{banner.text}</div>}

      <section className="panel chat">
        <div className="thread" ref={threadRef}>
          {turns.length === 0 && (
            <div className="empty">
              Tell the agent what you need and your budget. It searches real products, checks your rules, and prepares a
              PayPal checkout — you always confirm the payment.
            </div>
          )}
          {turns.map((t, i) =>
            t.kind === "user" ? (
              <div key={i} className="msg user">{t.text}</div>
            ) : t.kind === "note" ? (
              <div key={i} className="msg note">{t.text}</div>
            ) : (
              <div key={i} className="msg assistant">
                {t.events.map((ev) => (
                  <EventView key={ev.id} ev={ev} approvedIds={approvedIds} onApprove={(pid, title, price) =>
                    send(`I approve buying "${title}" for $${price.toFixed(2)}. Go ahead and create the checkout.`, [pid])
                  } />
                ))}
                {t.text && <div className="bubble">{t.text}</div>}
              </div>
            ),
          )}
          {busy && <div className="thinking">Agent is working…</div>}
        </div>
        {turns.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="btn" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            value={input}
            placeholder="e.g. A birthday gift for my dad who likes coffee, under $60"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button className="btn primary" disabled={busy || !input.trim()}>Send</button>
          <button type="button" className="btn" onClick={reset} disabled={busy}>Reset</button>
        </form>
      </section>

      <aside className="side">
        <div className="panel">
          <h2>Guardrails (enforced server-side)</h2>
          <div className="field">
            <label htmlFor="budget">Hard budget cap ($)</label>
            <input id="budget" type="number" min={1} value={policy.budgetUsd}
              onChange={(e) => setPolicy({ ...policy, budgetUsd: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="thr">Ask me above ($)</label>
            <input id="thr" type="number" min={0} value={policy.approvalThresholdUsd}
              onChange={(e) => setPolicy({ ...policy, approvalThresholdUsd: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="blk">Blocked merchants</label>
            <input id="blk" className="wide" placeholder="amazon.com, ebay.com" value={policy.blockedMerchants.join(", ")}
              onChange={(e) => setPolicy({ ...policy, blockedMerchants: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
          </div>
        </div>

        <div className="panel">
          <h2>Agent activity · {allEvents.length} tool calls</h2>
          <div className="activity">
            {allEvents.length === 0 && <div className="empty">Every Channel3 and PayPal call the agent makes shows up here.</div>}
            {allEvents.map((ev) => (
              <details key={ev.id} className="ev">
                <summary>
                  <span className={`dot ${dotClass(ev)}`} />
                  <span className="tool">{ev.tool}</span>
                  <span style={{ color: "var(--muted)" }}>{summarize(ev)}</span>
                </summary>
                <pre>{JSON.stringify({ input: ev.input, output: ev.output }, null, 2)}</pre>
              </details>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Orders (live · PayPal webhooks)</h2>
          {orders.length === 0 && <div className="empty">No orders yet.</div>}
          {orders.map((o) => (
            <div key={o.orderId} className="order">
              <div className="row">
                <strong style={{ fontSize: 13 }}>{o.product.title}</strong>
                <span className={`status ${o.status}`}>{o.status}</span>
              </div>
              <div className="row" style={{ color: "var(--muted)" }}>
                <span>${o.product.price.toFixed(2)} · {o.product.merchant}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{o.orderId}</span>
              </div>
              <ol>
                {o.events.map((e, i) => (
                  <li key={i}>{e.type}{e.detail ? ` — ${e.detail}` : ""}</li>
                ))}
              </ol>
              {o.status === "COMPLETED" && !o.refundId && (
                <button className="btn" style={{ marginTop: 6, fontSize: 12 }} disabled={busy}
                  onClick={() => send(`I changed my mind — please refund order ${o.orderId}.`)}>
                  Ask agent to refund
                </button>
              )}
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}

function EventView({ ev, approvedIds, onApprove }: {
  ev: ToolEvent;
  approvedIds: string[];
  onApprove: (productId: string, title: string, price: number) => void;
}) {
  const o = ev.output ?? {};
  if (ev.tool === "search_products" && Array.isArray(o.products)) {
    if (!o.products.length) return <div className="decision block">No in-stock products matched within budget.</div>;
    return (
      <div className="cards">
        {o.products.map((p: any) => (
          <div key={p.product_id} className="card">
            {p.image && <img src={p.image} alt={p.title} loading="lazy" />}
            <div className="t">{p.title}</div>
            <div className="m">{p.brand ? `${p.brand} · ` : ""}{p.merchant}</div>
            <div className="price">${Number(p.price_usd).toFixed(2)}{p.was_usd && p.was_usd > p.price_usd ? <s>${Number(p.was_usd).toFixed(2)}</s> : null}</div>
          </div>
        ))}
      </div>
    );
  }
  if ((ev.tool === "check_policy" || (ev.tool === "create_checkout" && o.created === false)) && o.decision) {
    const approved = approvedIds.includes(o.product_id);
    return (
      <div className={`decision ${o.decision}`}>
        <span>
          <strong>{o.decision === "allow" ? "✓ Allowed" : o.decision === "block" ? "✕ Blocked" : "⚠ Needs your approval"}</strong>
          {" · "}{o.title} — {(o.reasons ?? []).join(" ")}
        </span>
        {o.decision === "needs_approval" && !approved && (
          <button className="btn" onClick={() => onApprove(o.product_id, o.title, Number(o.price_usd))}>
            Approve ${Number(o.price_usd).toFixed(2)}
          </button>
        )}
      </div>
    );
  }
  if (ev.tool === "create_checkout" && o.created) {
    return (
      <div className="checkout">
        {o.image && <img src={o.image} alt="" />}
        <div className="grow">
          <div style={{ fontWeight: 600, fontSize: 14 }}>{o.title}</div>
          <div className="m" style={{ fontSize: 12, color: "var(--muted)" }}>
            ${Number(o.price_usd).toFixed(2)} · {o.merchant} · order {o.order_id}
          </div>
        </div>
        <a className="btn pp" href={o.approve_url}>Review &amp; pay with PayPal</a>
      </div>
    );
  }
  if (ev.tool === "refund_order" && o.refunded) {
    return <div className="decision allow"><span>↩ Refund {o.refund_id} · {o.status} · ${o.amount}</span></div>;
  }
  if (o.error) return <div className="decision block"><span>{ev.tool}: {String(o.error)}</span></div>;
  return null;
}

function dotClass(ev: ToolEvent) {
  const o = ev.output ?? {};
  if (o.error || o.decision === "block") return "bad";
  if (o.decision === "needs_approval") return "warn";
  if (o.created || o.refunded || o.decision === "allow") return "ok";
  return "";
}

function summarize(ev: ToolEvent): string {
  const i: any = ev.input ?? {};
  const o: any = ev.output ?? {};
  switch (ev.tool) {
    case "search_products": return `"${i.query}" → ${o.count ?? 0} results`;
    case "check_policy": return `${o.decision ?? "?"} · $${o.price_usd ?? "?"}`;
    case "create_checkout": return o.created ? `order ${o.order_id}` : `refused (${o.decision ?? "error"})`;
    case "get_order_status": return `${o.status ?? "?"}`;
    case "refund_order": return o.refunded ? `refund ${o.refund_id}` : "not refunded";
    default: return "";
  }
}
