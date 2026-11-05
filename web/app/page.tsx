"use client";

import { FormEvent, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const learner = "student-demo";
type Term = { term: string; definition: string };
type Explanation = { simple: string; mental_model: string; steps: string[]; example: string; quiz: string };
type Stats = { xp: number; level: number; streak: number; streak_freezes: number; credits: number; daily_goal: number; daily_progress: number; badges: string[] };
type History = { term: string; action: string; score: number; feedback: string; created_at: string };
const emptyStats: Stats = { xp: 0, level: 1, streak: 0, streak_freezes: 1, credits: 10, daily_goal: 3, daily_progress: 0, badges: [] };

function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const shapes: Record<string, React.ReactNode> = {
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20M8 7h8M8 11h7"/></>,
    spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2z"/><path d="m19 17 .8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>,
    flame: <path d="M12 22c4 0 7-3 7-7 0-3-1.7-5.1-4.3-8.2.1 2.5-1 3.4-1.5 3.8C13 7.3 11.7 4.8 9.5 2 9.8 6.4 5 9.3 5 15a7 7 0 0 0 7 7Z"/>,
    arrow: <><path d="M5 12h13M13 6l6 6-6 6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    trophy: <><path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4"/></>,
  };
  return <svg {...props}>{shapes[name]}</svg>;
}

async function jsonApi(path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail ?? "Something went wrong. Please try again.");
  return data;
}

export default function Home() {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Term[]>([]);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [history, setHistory] = useState<History[]>([]);
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<{ score: number; feedback: string } | null>(null);
  const [pendingSearch, setPendingSearch] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"learn" | "history">("learn");

  async function refreshLearner() {
    try {
      const [s, h] = await Promise.all([jsonApi(`/api/stats/${learner}`), jsonApi(`/api/history/${learner}`)]);
      setStats(s); setHistory(h);
    } catch { /* API server can start after the UI. */ }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshLearner(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function findTerms(value: string) {
    setQuery(value); setError("");
    if (!value.trim()) { setSuggestions([]); return; }
    try { setSuggestions(await jsonApi(`/api/glossary?q=${encodeURIComponent(value)}`)); }
    catch { setSuggestions([]); }
  }

  async function streamExplanation(value: string, approvalToken?: string) {
    setBusy(true); setError(""); setStatus("Connecting to your tutor…"); setExplanation(null); setGrade(null); setAnswer(""); setView("learn");
    try {
      const response = await fetch(`${API}/api/explain/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term: value, learner_id: learner, ...(approvalToken ? { approval_token: approvalToken } : {}) }) });
      if (!response.ok || !response.body) { const data = await response.json(); throw new Error(data.detail ?? "Could not start the explanation."); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value: chunk, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
        for (const block of events) {
          const eventName = block.match(/^event: (.+)$/m)?.[1]; const raw = block.match(/^data: (.+)$/m)?.[1]; if (!raw) continue;
          const data = JSON.parse(raw);
          if (eventName === "status") setStatus(data.message);
          if (eventName === "explanation") setExplanation(data);
          if (eventName === "stats") setStats(data);
          if (eventName === "error") throw new Error(data.detail);
          if (eventName === "done") setStatus("");
        }
      }
      await refreshLearner();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not explain that term."); setStatus(""); }
    finally { setBusy(false); setStatus(""); }
  }

  async function handleExplain(event: FormEvent) {
    event.preventDefault();
    const value = term.trim(); if (!value) return;
    await streamExplanation(value);
  }

  async function askForSearch() {
    const value = term.trim(); if (!value) return;
    setBusy(true); setError("");
    try {
      const result = await jsonApi("/api/search-approval", { learner_id: learner, query: value });
      setPendingSearch(result.approval_token);
      setStatus("A web search is waiting for adult approval.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not request approval."); }
    finally { setBusy(false); }
  }

  async function decideSearch(approved: boolean) {
    if (!pendingSearch) return;
    const token = pendingSearch; setPendingSearch(null);
    try {
      await jsonApi(`/api/search-approval/${token}/decision?approved=${approved}&learner_id=${learner}`, {});
      if (approved) await streamExplanation(term.trim(), token); else setStatus("Search was declined. Your local glossary is still available.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not record the decision."); }
  }

  async function submitQuiz(event: FormEvent) {
    event.preventDefault(); if (!explanation || !answer.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await jsonApi("/api/quiz/grade", { term, answer, expected: explanation.simple, learner_id: learner });
      setGrade(result.grade); setStats(result.stats); await refreshLearner();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not grade that answer."); }
    finally { setBusy(false); }
  }

  async function changeGoal(value: number) {
    try { setStats(await jsonApi("/api/goal", { learner_id: learner, daily_goal: value })); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update your goal."); }
  }

  async function applyFreeze() {
    try { setStats(await jsonApi(`/api/streak-freeze/${learner}`, {})); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not use a streak freeze."); }
  }

  const progress = Math.min(100, Math.round(stats.daily_progress / Math.max(1, stats.daily_goal) * 100));
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home"><span className="brand-mark"><span/><span/><span/><span/></span><span>termloop</span></a>
        <div className="student-card clay-inset"><div className="student-avatar">S</div><div><strong>My learning space</strong><span>Student account</span></div><span className="caret">⌄</span></div>
        <div className="side-label">YOUR SPACE</div>
        <button className={`nav-item ${view === "learn" ? "selected" : ""}`} onClick={() => setView("learn")}><Icon name="spark"/><span>Learn a term</span></button>
        <button className={`nav-item ${view === "history" ? "selected" : ""}`} onClick={() => setView("history")}><Icon name="clock"/><span>Learning history</span></button>
        <div className="sidebar-divider"/><div className="side-label">QUICK START</div>
        {["Transformer", "Machine learning", "Prompt engineering", "Neural network"].map((item, i) => <button className="quick-term" key={item} onClick={() => { setTerm(item); void streamExplanation(item); }}><i className={`quick-dot quick-${i}`}/>{item}</button>)}
        <div className="sidebar-spacer"/>
        <div className="level-card clay-card"><div className="level-top"><span className="trophy-icon"><Icon name="trophy" size={17}/></span><span>LEVEL {stats.level}</span></div><strong>Curious explorer</strong><div className="level-progress"><i style={{ width: `${stats.xp % 100}%` }}/></div><div className="level-meta"><span>{stats.xp} XP</span><span>{100 - stats.xp % 100} to next</span></div></div>
        <div className="sidebar-footer"><span className="avatar-small">S</span><span><strong>Student</strong><small>Keep being curious!</small></span><span className="more">···</span></div>
      </aside>

      <section className="main-content" id="home">
        <header className="topbar"><div className="breadcrumb"><span className="breadcrumb-mark"><Icon name="book" size={14}/></span>My learning space <b>›</b> <strong>{view === "learn" ? "Learn a term" : "Learning history"}</strong></div><div className="top-actions"><div className="streak-pill"><Icon name="flame" size={16}/><strong>{stats.streak}</strong><span>day streak</span></div><span className="top-avatar">S</span></div></header>
        <div className="content-wrap">
          {view === "learn" ? <>
            <section className="welcome-row"><div><div className="eyebrow">A LITTLE LEARNING GOES A LONG WAY <span>✳</span></div><h1>Big ideas, made<br className="mobile-break"/> a little simpler.</h1><p>Pick an AI term and we’ll figure it out together.</p></div><div className="daily-goal clay-card"><div className="goal-top"><span>DAILY GOAL</span><select aria-label="Daily learning goal" value={stats.daily_goal} onChange={(e) => void changeGoal(Number(e.target.value))}><option value={1}>1 term</option><option value={3}>3 terms</option><option value={5}>5 terms</option><option value={10}>10 terms</option></select></div><div className="goal-progress"><i style={{ width: `${progress}%` }}/></div><div className="goal-bottom"><strong>{stats.daily_progress} of {stats.daily_goal}</strong><span>terms explored today</span></div></div></section>
            <section className="learning-grid"><div className="learn-column"><form className="search-card clay-card" onSubmit={handleExplain}><div className="search-card-head"><span className="search-icon"><Icon name="search" size={20}/></span><div><strong>What would you like to understand?</strong><span>Start with any AI term that makes you curious.</span></div></div><div className="term-input-wrap"><input value={term} onChange={(e) => { setTerm(e.target.value); void findTerms(e.target.value); }} placeholder="Try “neural network”..." aria-label="AI term to explain" maxLength={160}/><button aria-label="Explain this term" disabled={busy || !term.trim()}><Icon name="arrow" size={18}/></button>{suggestions.length > 0 && query && <div className="suggestions">{suggestions.map((item) => <button key={item.term} type="button" onClick={() => { setTerm(item.term); setQuery(""); setSuggestions([]); }}>{item.term}<span>{item.definition}</span></button>)}</div>}</div><div className="search-card-bottom"><span><i/> School-safe, just for you</span><span>From your AI glossary</span></div></form>
                {(busy || status) && <div className="status-card clay-inset"><span className="loader"/><span>{status || "Your tutor is thinking…"}</span></div>}
                {error && <div className="error-card" role="alert"><strong>Let’s try that another way</strong><span>{error}</span>{error.includes("adult-approved") && <button onClick={() => void askForSearch()}>Request adult-approved search <Icon name="arrow" size={14}/></button>}</div>}
                {pendingSearch && <div className="approval-card clay-card"><div className="approval-icon">!</div><div><strong>Ask an adult before searching</strong><p>This term isn’t in your glossary. An adult can approve one safe web search for “{term}”.</p><div className="approval-actions"><button onClick={() => void decideSearch(true)}>Approve search</button><button onClick={() => void decideSearch(false)}>No thanks</button></div></div></div>}
                {explanation && <div className="explanation-card clay-card"><div className="explanation-heading"><div><span className="section-kicker">LET’S BREAK IT DOWN</span><h2>{term}</h2></div><span className="ready-pill"><Icon name="check" size={13}/> Ready to learn</span></div><div className="simple-box"><span className="box-label"><i/> IN SIMPLE WORDS</span><p>{explanation.simple}</p></div><div className="mental-model"><span className="model-icon">✳</span><div><span className="box-label">PICTURE IT THIS WAY</span><p>{explanation.mental_model}</p></div></div><div className="steps-block"><span className="box-label">THREE LITTLE STEPS</span><ol>{explanation.steps.slice(0, 3).map((step, i) => <li key={i}><span>{i + 1}</span><p>{step}</p></li>)}</ol></div><div className="example-box"><span className="box-label">A REAL-WORLD EXAMPLE</span><p>{explanation.example}</p></div><form className="quiz-block" onSubmit={submitQuiz}><div className="quiz-heading"><span className="quiz-icon">?</span><div><span className="box-label">QUICK CHECK</span><p>{explanation.quiz}</p></div></div><textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Have a go in your own words…" maxLength={1200} rows={2}/><div className="quiz-submit"><span>Short answers are perfect.</span><button disabled={busy || !answer.trim()}>Check my answer <Icon name="arrow" size={14}/></button></div>{grade && <div className="grade-result"><strong>{grade.score} / 3</strong><span>{grade.feedback}</span></div>}</form></div>}
                {!explanation && !busy && !error && <div className="empty-hint"><span className="hint-star">✳</span><div><strong>Curiosity starts with one question.</strong><p>Search for a term above, or pick a quick start to begin.</p></div></div>}
              </div>
              <aside className="right-column"><div className="progress-card clay-card"><div className="panel-head"><div><span className="section-kicker">YOUR LITTLE WINS</span><h2>Learning progress</h2></div><span className="progress-spark">✳</span></div><div className="progress-stats"><div><span>EXPERIENCE</span><strong>{stats.xp}<small> XP</small></strong></div><i/><div><span>LEVEL</span><strong>{stats.level}</strong></div></div><div className="overall-track"><i style={{ width: `${stats.xp % 100}%` }}/></div><div className="next-level"><span>Level {stats.level}</span><span>Level {stats.level + 1}</span></div><div className="badge-row"><span className="badge-icon">✦</span><span><strong>{stats.badges.length ? stats.badges[0].replaceAll("-", " ") : "Your first badge awaits"}</strong><small>{stats.badges.length ? "Badge unlocked — lovely work!" : "Explore terms to earn your first badge"}</small></span><Icon name="arrow" size={15}/></div></div>
                <div className="streak-card clay-card"><div className="streak-head"><span className="flame-icon"><Icon name="flame" size={19}/></span><span className="section-kicker">YOUR STREAK</span><strong>{stats.streak} days</strong></div><p>Little steps add up. Come back tomorrow to keep your streak going.</p><div className="streak-dots">{["M", "T", "W", "T", "F", "S", "S"].map((day, i) => <div key={`${day}${i}`} className={i < Math.min(stats.streak, 7) ? "streak-done" : ""}><span>{day}</span><i>{i < Math.min(stats.streak, 7) ? "✓" : "·"}</i></div>)}</div><button className="freeze-button" onClick={() => void applyFreeze()} disabled={stats.streak_freezes < 1}><span>❄</span> {stats.streak_freezes} streak freeze{stats.streak_freezes === 1 ? "" : "s"} available</button></div>
                <div className="tip-card clay-card"><span className="tip-icon">✧</span><div><span className="section-kicker">A TINY TIP</span><p>Try explaining a new idea to someone else. Teaching helps it stick!</p></div></div></aside></section>
          </> : <section className="history-card clay-card"><div className="history-head"><div><span className="section-kicker">LOOK HOW FAR YOU’VE COME</span><h1>Your learning history</h1><p>Every little question is a step forward.</p></div><span className="history-trophy"><Icon name="trophy" size={25}/></span></div>{history.length ? <div className="history-list">{history.map((item, index) => <div className="history-item" key={`${item.created_at}-${index}`}><span className="history-symbol">{item.action === "quiz" ? "?" : "✳"}</span><div><strong>{item.term}</strong><small>{item.action === "quiz" ? `Quiz · ${item.score}/3 · ${item.feedback}` : "Term explored"}</small></div><time>{new Date(item.created_at).toLocaleDateString()}</time><span className="history-xp">+{item.action === "quiz" ? item.score * 5 : 5} XP</span></div>)}</div> : <div className="history-empty"><span>✳</span><strong>Your story starts with one term.</strong><p>Explore something new and it’ll show up here.</p><button onClick={() => setView("learn")}>Explore a term <Icon name="arrow" size={14}/></button></div>}</section>}
          <footer className="page-footer"><span>Made for curious minds <span>♥</span></span><span>One idea at a time.</span></footer>
        </div>
      </section>
    </main>
  );
}


