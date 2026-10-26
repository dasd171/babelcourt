import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTRACT_ADDRESS,
  Wallet,
  addrUrl,
  connectInjected,
  forgetBurner,
  formatGen,
  fundTestGen,
  getBalance,
  loadBurner,
  newBurner,
  read,
  short,
  txUrl,
  waitAccepted,
  write,
} from "./genlayer";
import { prefilter, REASON_LABEL } from "./prefilter";

interface Submission {
  translator: string;
  text: string;
  judged: boolean;
  passed: boolean;
  reason_code: string;
  score: number;
  prefiltered: boolean;
}
interface Job {
  id: number;
  requester: string;
  title: string;
  source_text: string;
  source_url: string;
  target_lang: string;
  glossary: Record<string, string>;
  style_notes: string;
  reward_wei: string;
  reward_points: number;
  deadline_ts: number;
  max_submissions: number;
  status: string;
  winner_index: number;
  judged_at: number;
  appeal_deadline_ts: number;
  judge_rounds: number;
  appeal_used: boolean;
  appealed_by: string;
  pairwise_log: string;
  submission_count: number;
  submissions: Submission[];
}
interface TxEntry {
  label: string;
  hash?: string;
  state: "signing" | "pending" | "accepted" | "error";
  detail?: string;
}

const now = () => Math.floor(Date.now() / 1000);
const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function useTicker(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function countdown(ts: number) {
  const d = ts - now();
  if (d <= 0) return "passed";
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  return h ? `${h}h ${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}

export default function App() {
  const [wallet, setWallet] = useState<Wallet>(() => loadBurner() || { mode: "none" });
  const [balance, setBalance] = useState<bigint | null>(null);
  const [tab, setTab] = useState<"jobs" | "create" | "board" | "how">("jobs");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [txs, setTxs] = useState<TxEntry[]>([]);
  const [loadErr, setLoadErr] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      const [list, c] = await Promise.all([read<Job[]>("list_jobs", [""]), read<number>("get_job_count")]);
      setJobs(list);
      setCount(c);
      setLoadErr("");
    } catch (e: any) {
      setLoadErr(e?.message || String(e));
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    if (wallet.address) setBalance(await getBalance(wallet.address));
  }, [wallet.address]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  const run = useCallback(
    async (label: string, fn: string, args: any[], value: bigint = 0n) => {
      const idx = Date.now();
      const patch = (p: Partial<TxEntry>) =>
        setTxs((all) => all.map((t: any) => (t._id === idx ? { ...t, ...p } : t)));
      setTxs((all) => [{ _id: idx, label, state: "signing" } as any, ...all].slice(0, 6));
      try {
        const hash = await write(fn, args, value);
        patch({ hash, state: "pending" });
        const r = await waitAccepted(hash);
        const lr = r?.consensus_data?.leader_receipt;
        const receipt = Array.isArray(lr) ? lr[0] : lr;
        const exec = receipt?.execution_result;
        const readable = receipt?.result?.payload?.readable;
        if (exec && exec !== "SUCCESS") {
          patch({ state: "error", detail: String(readable || exec).slice(0, 160) });
        } else {
          patch({ state: "accepted", detail: readable ? `returned ${readable}` : undefined });
        }
        await refresh();
        await refreshBalance();
        return true;
      } catch (e: any) {
        patch({ state: "error", detail: (e?.shortMessage || e?.message || String(e)).slice(0, 200) });
        return false;
      }
    },
    [refresh, refreshBalance],
  );

  const job = useMemo(() => jobs?.find((j) => j.id === selected) || null, [jobs, selected]);

  return (
    <div className="page">
      <header className="top">
        <div className="brand" onClick={() => { setTab("jobs"); setSelected(null); }}>
          <span className="logo">文A</span>
          <div>
            <h1>BabelCourt</h1>
            <p>Translation bounties judged by GenLayer validator consensus</p>
          </div>
        </div>
        <WalletBox wallet={wallet} setWallet={setWallet} balance={balance} refreshBalance={refreshBalance} />
      </header>

      <div className="netbar">
        <span className="dot" /> GenLayer Studionet · contract{" "}
        <a href={addrUrl(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="mono">
          {short(CONTRACT_ADDRESS)}
        </a>{" "}
        · {count === null ? "reading live state…" : `${count} job${count === 1 ? "" : "s"} on-chain`}
        {loadErr && <span className="err"> · read error: {loadErr}</span>}
      </div>

      <nav className="tabs">
        {(["jobs", "create", "board", "how"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); setSelected(null); }}>
            {{ jobs: "Jobs", create: "Post a job", board: "Reputation", how: "How judging works" }[t]}
          </button>
        ))}
      </nav>

      {txs.length > 0 && (
        <div className="txlog">
          {txs.map((t: any) => (
            <div key={t._id} className={`tx ${t.state}`}>
              <b>{t.label}</b>
              <span>
                {t.state === "signing" && "signing…"}
                {t.state === "pending" && "validators are working (LLM/web calls can take 1–3 min)…"}
                {t.state === "accepted" && "accepted by consensus"}
                {t.state === "error" && "failed"}
                {t.detail && ` — ${t.detail}`}
              </span>
              {t.hash && (
                <a href={txUrl(t.hash)} target="_blank" rel="noreferrer" className="mono">
                  {short(t.hash)} ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <main>
        {tab === "jobs" && !job && <JobList jobs={jobs} onOpen={setSelected} />}
        {tab === "jobs" && job && (
          <JobDetail job={job} wallet={wallet} run={run} back={() => setSelected(null)} />
        )}
        {tab === "create" && (
          <CreateJob
            wallet={wallet}
            run={async (...a) => {
              const ok = await run(...a);
              if (ok) setTab("jobs");
              return ok;
            }}
          />
        )}
        {tab === "board" && <Board />}
        {tab === "how" && <How />}
      </main>
      <footer>
        Open source ·{" "}
        <a href="https://github.com/dasd171/kiro" target="_blank" rel="noreferrer">GitHub source</a>{" "}
        · Built on <a href="https://genlayer.com" target="_blank" rel="noreferrer">GenLayer</a>
      </footer>
    </div>
  );
}

function WalletBox({ wallet, setWallet, balance, refreshBalance }: {
  wallet: Wallet; setWallet: (w: Wallet) => void; balance: bigint | null; refreshBalance: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const demo = async () => {
    setBusy("Creating demo wallet & funding 10 test GEN…");
    setErr("");
    try {
      const w = loadBurner() || newBurner();
      setWallet(w);
      await fundTestGen(w.address!, 10);
      [1500, 4000, 8000].forEach((ms) => setTimeout(refreshBalance, ms));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };
  const mm = async () => {
    setErr("");
    try {
      setWallet(await connectInjected());
    } catch (e: any) {
      setErr(e.message);
    }
  };
  if (wallet.mode === "none")
    return (
      <div className="wallet">
        <button className="primary" onClick={demo} disabled={!!busy}>Try demo wallet</button>
        <button onClick={mm}>MetaMask</button>
        {busy && <small>{busy}</small>}
        {err && <small className="err">{err}</small>}
      </div>
    );
  return (
    <div className="wallet">
      <div className="who">
        <span className="pill">{wallet.mode === "burner" ? "Demo burner" : "Injected wallet"}</span>
        <a className="mono" href={addrUrl(wallet.address!)} target="_blank" rel="noreferrer">{short(wallet.address)}</a>
        <span className="bal">{balance === null ? "…" : `${formatGen(balance)} GEN`}</span>
      </div>
      <div className="row">
        <button onClick={async () => { setBusy("funding…"); try { await fundTestGen(wallet.address!, 10); [1500, 4000, 8000].forEach((ms) => setTimeout(refreshBalance, ms)); } catch (e: any) { setErr(e.message); } setBusy(""); }}>
          +10 test GEN
        </button>
        {wallet.mode === "burner" && (
          <button onClick={() => { forgetBurner(); setWallet(newBurner()); [500, 3000].forEach((ms) => setTimeout(refreshBalance, ms)); }} title="Act as a different person (e.g. requester vs translator)">
            New identity
          </button>
        )}
        <button onClick={() => { if (wallet.mode === "burner") forgetBurner(); setWallet({ mode: "none" }); }}>Disconnect</button>
      </div>
      {busy && <small>{busy}</small>}
      {err && <small className="err">{err}</small>}
    </div>
  );
}

function StatusChip({ s }: { s: string }) {
  return <span className={`chip st-${s}`}>{s}</span>;
}

function JobList({ jobs, onOpen }: { jobs: Job[] | null; onOpen: (id: number) => void }) {
  useTicker(5000);
  if (!jobs) return <p className="muted">Reading jobs from the contract…</p>;
  if (!jobs.length) return <p className="muted">No jobs yet — post the first one.</p>;
  return (
    <div className="grid">
      {jobs.map((j) => (
        <button key={j.id} className="card job" onClick={() => onOpen(j.id)}>
          <div className="cardtop">
            <span className="mono muted">#{j.id}</span>
            <StatusChip s={j.status} />
          </div>
          <h3>{j.title}</h3>
          <p className="snippet">{j.source_text.slice(0, 150)}{j.source_text.length > 150 ? "…" : ""}</p>
          <div className="meta">
            <span className="lang">→ {j.target_lang}</span>
            <span>{BigInt(j.reward_wei) > 0n ? `${formatGen(j.reward_wei)} GEN escrowed` : `${j.reward_points} pts`}</span>
            <span>{j.submission_count}/{j.max_submissions} submissions</span>
            {j.status === "open" && <span>closes {countdown(j.deadline_ts)}</span>}
            {j.source_url && <span title={j.source_url}>🌐 web snapshot</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

function JobDetail({ job, wallet, run, back }: {
  job: Job; wallet: Wallet; back: () => void;
  run: (label: string, fn: string, args: any[], value?: bigint) => Promise<boolean>;
}) {
  useTicker(1000);
  const [text, setText] = useState("");
  const me = wallet.address;
  const isRequester = eq(me, job.requester);
  const mine = job.submissions.findIndex((s) => eq(s.translator, me));
  const check = text.trim() ? prefilter(job.source_text, text, job.glossary) : "";
  const deadlinePassed = now() > job.deadline_ts;
  const capReached = job.submission_count >= job.max_submissions;
  const appealOpen = job.status === "judged" && !job.appeal_used && now() <= job.appeal_deadline_ts;
  const canAppeal = appealOpen && (isRequester || (mine >= 0 && mine !== job.winner_index));
  const canFinalize = job.status === "judged" && (job.appeal_used || now() > job.appeal_deadline_ts);

  return (
    <div className="detail">
      <button className="link" onClick={back}>← all jobs</button>
      <div className="dhead">
        <div>
          <span className="mono muted">Job #{job.id}</span> <StatusChip s={job.status} />
          <h2>{job.title}</h2>
          <p className="muted">
            requested by <a className="mono" href={addrUrl(job.requester)} target="_blank" rel="noreferrer">{short(job.requester)}</a>
            {isRequester && " (you)"} · target <b>{job.target_lang}</b> ·{" "}
            {BigInt(job.reward_wei) > 0n ? <b>{formatGen(job.reward_wei)} GEN in escrow</b> : null}
            {job.reward_points > 0 && ` + ${job.reward_points} reputation pts`}
          </p>
        </div>
        <div className="clock">
          {job.status === "open" && <><small>submissions close</small><b>{countdown(job.deadline_ts)}</b></>}
          {job.status === "judged" && !job.appeal_used && <><small>appeal window</small><b>{countdown(job.appeal_deadline_ts)}</b></>}
          {job.status === "judged" && job.appeal_used && <><small>appeal used by</small><b className="mono">{short(job.appealed_by)}</b></>}
        </div>
      </div>

      <section className="two">
        <div className="panel">
          <h4>Source text {job.source_url && <a href={job.source_url} target="_blank" rel="noreferrer" className="small">snapshotted by validators from {new URL(job.source_url).host} ↗</a>}</h4>
          <blockquote>{job.source_text}</blockquote>
        </div>
        <div className="panel">
          <h4>Glossary <small className="muted">(checked deterministically on-chain)</small></h4>
          {Object.keys(job.glossary).length === 0 ? <p className="muted">none</p> : (
            <table className="gloss"><tbody>
              {Object.entries(job.glossary).map(([k, v]) => <tr key={k}><td>{k}</td><td>→</td><td><b>{v}</b></td></tr>)}
            </tbody></table>
          )}
          <h4>Style notes</h4>
          <p>{job.style_notes || <span className="muted">none</span>}</p>
        </div>
      </section>

      <section>
        <h3>Submissions & verdicts {job.judge_rounds > 0 && <small className="muted">· judged {job.judge_rounds}× {job.pairwise_log && `· tournament ${job.pairwise_log}`}</small>}</h3>
        {job.submissions.length === 0 && <p className="muted">No submissions yet.</p>}
        <div className="subs">
          {job.submissions.map((s, i) => (
            <div key={i} className={`sub ${s.judged ? (s.passed ? "pass" : "fail") : ""} ${i === job.winner_index ? "winner" : ""}`}>
              <div className="subhead">
                <span className="mono">#{i} · {short(s.translator)}{eq(s.translator, me) && " (you)"}</span>
                {i === job.winner_index && <span className="crown">🏆 winner</span>}
                {s.judged ? (
                  <>
                    <span className={`chip ${s.passed ? "ok" : "bad"}`}>{s.passed ? "PASS" : "FAIL"}</span>
                    <span className="chip code" title={REASON_LABEL[s.reason_code]}>{s.reason_code}</span>
                    <span className="score" title="score bucket 0-4">{[0, 1, 2, 3].map((k) => <i key={k} className={k < s.score ? "f" : ""} />)}<em>{s.score}/4</em></span>
                    {s.prefiltered && <span className="chip pre" title="Rejected by the deterministic pre-filter — no LLM call needed">pre-filter</span>}
                  </>
                ) : <span className="chip">pending</span>}
              </div>
              <p className="subtext">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="actions">
        {job.status === "open" && (
          <div className="panel">
            <h4>Submit a translation</h4>
            {!me && <p className="muted">Connect a wallet (Demo works instantly) to submit.</p>}
            {me && isRequester && <p className="muted">You posted this job — requesters can't submit. Use “New identity” in demo mode to act as a translator.</p>}
            {me && mine >= 0 && <p className="muted">You already submitted (#{mine}).</p>}
            {me && !isRequester && mine < 0 && !deadlinePassed && !capReached && (
              <>
                <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Your ${job.target_lang} translation…`} maxLength={4000} />
                <div className="precheck">
                  {text.trim() === "" ? <span className="muted">Live pre-check mirrors the contract's deterministic filter.</span>
                    : check ? <span className="err">Pre-filter would reject: <b>{check}</b> — {REASON_LABEL[check]}</span>
                    : <span className="okc">Passes deterministic pre-checks (glossary, fences, not a copy). Semantics are up to the validators.</span>}
                  <span className="muted">{text.length}/4000</span>
                </div>
                <button className="primary" disabled={!text.trim()} onClick={async () => { if (await run(`Submit to job #${job.id}`, "submit_translation", [job.id, text])) setText(""); }}>
                  Submit translation
                </button>
              </>
            )}
          </div>
        )}
        <div className="panel">
          <h4>Court actions</h4>
          <div className="row wrap">
            {job.status === "open" && (
              <button className="primary" disabled={!me || job.submission_count === 0 || !(isRequester || deadlinePassed || capReached)}
                onClick={() => run(`Judge job #${job.id}`, "judge", [job.id])}
                title="Requester any time; anyone after the deadline or when the cap is reached">
                ⚖️ Judge now
              </button>
            )}
            {job.status === "judged" && (
              <button disabled={!canAppeal} onClick={() => run(`Appeal job #${job.id}`, "appeal", [job.id])}
                title="One full re-judgment by a fresh round of validators. Requester or a losing translator, within 30 min.">
                ↺ Appeal (re-judge)
              </button>
            )}
            {job.status === "judged" && (
              <button className="primary" disabled={!me || !canFinalize} onClick={() => run(`Finalize job #${job.id}`, "finalize", [job.id])}>
                💸 Finalize & pay out
              </button>
            )}
            {job.status === "open" && isRequester && job.submission_count === 0 && (
              <button onClick={() => run(`Cancel job #${job.id}`, "cancel_job", [job.id])}>Cancel & refund</button>
            )}
          </div>
          <p className="muted small">
            {job.status === "open" && "Judging runs the pre-filter, then every validator grades each submission with an LLM; the leader's grades stand only if validators agree on pass/fail, injection flags and scores within ±1."}
            {job.status === "judged" && (job.winner_index >= 0 ? `Provisional winner: #${job.winner_index}. ` : "No submission passed — finalizing refunds the requester. ") + (canFinalize ? "Ready to finalize." : "Finalize unlocks after the appeal window or once the appeal is used.")}
            {job.status === "finalized" && (job.winner_index >= 0 ? `Paid to #${job.winner_index} and reputation recorded.` : "Escrow refunded to the requester.")}
          </p>
        </div>
      </section>
    </div>
  );
}

function CreateJob({ wallet, run }: { wallet: Wallet; run: (label: string, fn: string, args: any[], value?: bigint) => Promise<boolean> }) {
  const [mode, setMode] = useState<"text" | "url">("url");
  const [title, setTitle] = useState("GenLayer docs: Optimistic Democracy intro → 中文");
  const [source, setSource] = useState("");
  const [url, setUrl] = useState("https://docs.genlayer.com/understand-genlayer-protocol/what-is-genlayer");
  const [anchor, setAnchor] = useState("GenLayer is a blockchain for applications");
  const [maxChars, setMaxChars] = useState(420);
  const [lang, setLang] = useState("zh-CN");
  const [gloss, setGloss] = useState<[string, string][]>([["Intelligent Contract", "智能合约（Intelligent Contract）"], ["validators", "验证者"]]);
  const [style, setStyle] = useState("Technical documentation tone; keep product names in English.");
  const [minutes, setMinutes] = useState(60);
  const [maxSubs, setMaxSubs] = useState(3);
  const [gen, setGen] = useState("1");
  const [points, setPoints] = useState(50);

  const glossaryJson = JSON.stringify(Object.fromEntries(gloss.filter(([k, v]) => k.trim() && v.trim())));
  const value = (() => { try { const [w, f = ""] = gen.split("."); return BigInt(w || "0") * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18)); } catch { return 0n; } })();

  const submit = () => {
    if (mode === "text")
      return run("Create job", "create_job", [title, source, lang, glossaryJson, style, minutes, maxSubs, points], value);
    return run("Create job from URL (validators fetch the page)", "create_job_from_url",
      [title, url, anchor, maxChars, lang, glossaryJson, style, minutes, maxSubs, points], value);
  };

  return (
    <div className="panel form">
      <h3>Post a translation job</h3>
      <div className="seg">
        <button className={mode === "url" ? "on" : ""} onClick={() => setMode("url")}>🌐 Snapshot a web page</button>
        <button className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>✍️ Paste text</button>
      </div>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
      {mode === "text" ? (
        <label>Source text (20–3000 chars)<textarea rows={6} value={source} onChange={(e) => setSource(e.target.value)} maxLength={3000} /></label>
      ) : (
        <>
          <label>Page URL (https) — every validator renders it and they must agree on the excerpt<input value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          <div className="row">
            <label className="grow">Start at anchor phrase<input value={anchor} onChange={(e) => setAnchor(e.target.value)} maxLength={120} /></label>
            <label>Max chars<input type="number" value={maxChars} min={100} max={3000} onChange={(e) => setMaxChars(+e.target.value)} /></label>
          </div>
        </>
      )}
      <div className="row">
        <label>Target language<input value={lang} onChange={(e) => setLang(e.target.value)} placeholder="zh-CN, es, ja…" /></label>
        <label>Deadline (minutes)<input type="number" value={minutes} min={1} onChange={(e) => setMinutes(+e.target.value)} /></label>
        <label>Max submissions (2–6)<input type="number" value={maxSubs} min={2} max={6} onChange={(e) => setMaxSubs(+e.target.value)} /></label>
      </div>
      <div className="row">
        <label>Reward escrow (GEN, sent as value)<input value={gen} onChange={(e) => setGen(e.target.value)} /></label>
        <label>Bonus reputation points<input type="number" value={points} min={0} max={10000} onChange={(e) => setPoints(+e.target.value)} /></label>
      </div>
      <label>Glossary — required renderings, enforced deterministically before any LLM call</label>
      {gloss.map(([k, v], i) => (
        <div className="row" key={i}>
          <input value={k} placeholder="source term" onChange={(e) => setGloss(gloss.map((g, j) => (j === i ? [e.target.value, g[1]] : g)))} />
          <input value={v} placeholder="required translation" onChange={(e) => setGloss(gloss.map((g, j) => (j === i ? [g[0], e.target.value] : g)))} />
          <button onClick={() => setGloss(gloss.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="link" onClick={() => setGloss([...gloss, ["", ""]])}>+ add term</button>
      <label>Style notes<input value={style} onChange={(e) => setStyle(e.target.value)} maxLength={500} /></label>
      <button className="primary big" disabled={!wallet.address} onClick={submit}>
        {wallet.address ? `Post job${value > 0n ? ` & escrow ${gen} GEN` : ""}` : "Connect a wallet first"}
      </button>
      <p className="muted small">Tip: in Demo mode, post as one identity, then click “New identity” to submit translations as someone else.</p>
    </div>
  );
}

function Board() {
  const [lang, setLang] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    setRows(null);
    read<any[]>("get_leaderboard", [lang]).then(setRows).catch(() => setRows([]));
  }, [lang]);
  return (
    <div className="panel">
      <h3>Translator reputation <small className="muted">(+10 per passing translation, +100 + bonus per win)</small></h3>
      <label className="inline">Language <input value={lang} onChange={(e) => setLang(e.target.value)} placeholder="all (or zh-CN, es…)" /></label>
      {!rows ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">No finalized jobs yet for this filter.</p> : (
        <table className="board"><thead><tr><th>#</th><th>Translator</th><th>Language</th><th>Points</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.address + r.lang}><td>{i + 1}</td><td><a className="mono" href={addrUrl(r.address)} target="_blank" rel="noreferrer">{short(r.address)}</a></td><td>{r.lang}</td><td><b>{r.points}</b></td></tr>
          ))}</tbody></table>
      )}
    </div>
  );
}

function How() {
  return (
    <div className="panel how">
      <h3>How a BabelCourt verdict is reached</h3>
      <ol>
        <li><b>Source snapshot.</b> For URL jobs each validator renders the page and cuts the excerpt starting at the anchor. The leader's excerpt is accepted only if a validator's own excerpt matches (≥ 90 % word overlap), so the text everyone translates is agreed on-chain.</li>
        <li><b>Deterministic pre-filter.</b> No LLM: empty or copied text → <code>untranslated</code>; mismatched code fences → <code>formatting</code>; a glossary term missing → <code>glossary</code>; known injection phrases → <code>injection</code>. Identical on every node, costs nothing.</li>
        <li><b>LLM grading with a fixed vocabulary.</b> Each remaining submission is fenced as untrusted data and graded against one rubric. Output is reduced to <code>{"{reason_code, score 0–4}"}</code>; anything off-vocabulary becomes <code>meaning_error</code>, and <i>pass</i> is derived (reason <code>ok</code> and score ≥ 2), never trusted from the model.</li>
        <li><b>Custom validator rule</b> (<code>gl.vm.run_nondet</code>): validators re-grade and agree if pass/fail matches, nobody disagrees about <code>injection</code>, and scores differ by ≤ 1. Honest models converge; a lying leader doesn't.</li>
        <li><b>Winner.</b> Highest score among passing submissions. Ties go to a pairwise tournament whose nondet blocks return only <code>A</code>/<code>B</code>/<code>TIE</code>; validators accept if they agree or either sees a tie (then the earlier submission keeps the lead).</li>
        <li><b>Appeal & payout.</b> Requester or any loser can trigger one full re-judgment within 30 min. Finalize pays the escrow to the winner via a native GEN transfer (or refunds the requester) and records per-language reputation.</li>
      </ol>
      <p className="muted">Reason codes: {Object.entries(REASON_LABEL).map(([k, v]) => <span key={k} className="chip code" title={v}>{k}</span>)}</p>
    </div>
  );
}
