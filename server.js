import express from 'express';
import 'dotenv/config';

const app = express();
const PORT = 3000;
const MODEL = 'openai/gpt-oss-20b';

const NO_KEY_MSG = 'Analysis service is temporarily unavailable. Please try again in a moment.';
const FAIL_MSG   = 'Analysis could not be completed. Please try again in a moment.';
const RATE_MSG   = 'Analysis is taking longer than usual. Please try again shortly.';

app.use(express.json());

function fingerprint(key) {
  if (!key) return 'MISSING';
  if (key.length < 12) return 'TOO_SHORT (len=' + key.length + ')';
  return key.slice(0, 8) + '...' + key.slice(-4) + ' (len=' + key.length + ')';
}

function banner() {
  const key = process.env.GROQ_API_KEY;
  const keyStatus =
    !key ? 'MISSING — add GROQ_API_KEY=... to .env' :
    !key.startsWith('gsk_') ? 'SUSPICIOUS — does not start with gsk_' :
    key.length !== 56 ? 'SUSPICIOUS — expected length 56, got ' + key.length :
    'OK';
  console.log('');
  console.log('  Friendlist server');
  console.log('  ---------------------------------------------');
  console.log('  URL:        http://localhost:' + PORT);
  console.log('  Model:      ' + MODEL);
  console.log('  Groq key:   ' + fingerprint(key));
  console.log('  Key status: ' + keyStatus);
  console.log('  Health:     http://localhost:' + PORT + '/api/health');
  console.log('  ---------------------------------------------');
  console.log('');
}

app.get('/api/health', async (req, res) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(503).json({ status: 'down', reason: 'service unavailable' });

  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + key }
    });
    if (r.status === 401) {
      console.error('[health] upstream rejected the key (401)');
      return res.status(503).json({ status: 'down', reason: 'authentication failed' });
    }
    if (!r.ok) {
      console.error('[health] upstream error', r.status);
      return res.status(503).json({ status: 'down', reason: 'upstream error' });
    }
    return res.json({ status: 'ok', model: MODEL });
  } catch (err) {
    console.error('[health] exception', err?.message || err);
    return res.status(503).json({ status: 'down', reason: 'network unreachable' });
  }
});

app.post('/api/analyze-tone', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Please write something first.' });

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.error('[tone] GROQ_API_KEY missing in .env');
    return res.status(503).json({ error: NO_KEY_MSG });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_completion_tokens: 256,
        top_p: 1,
        reasoning_effort: 'low',
        stream: false,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are an emotion classifier. Respond ONLY with a JSON object containing two keys: "label" (one word, lowercase, from this exact list: joy, sadness, anger, fear, excitement, surprise, neutral, disgust, trust) and "score" (a number between 0 and 1 representing confidence). Output valid JSON and nothing else.'
          },
          { role: 'user', content: text }
        ]
      })
    });

    if (response.status === 401) {
      const detail = await response.text();
      console.error('[tone] 401 — key rejected by upstream:', detail);
      return res.status(503).json({ error: FAIL_MSG });
    }
    if (response.status === 429) {
      console.error('[tone] 429 — rate limited by upstream');
      return res.status(429).json({ error: RATE_MSG });
    }
    if (!response.ok) {
      const detail = await response.text();
      console.error('[tone] upstream error', response.status, detail);
      return res.status(503).json({ error: FAIL_MSG });
    }

    const data = await response.json();
    let parsed;
    try {
      parsed = JSON.parse(data.choices[0].message.content);
    } catch (parseErr) {
      console.error('[tone] parse error:', parseErr?.message || parseErr);
      console.error('[tone] raw content:', data?.choices?.[0]?.message?.content);
      return res.status(503).json({ error: FAIL_MSG });
    }

    const label = (parsed.label || 'neutral').toLowerCase();
    const score = typeof parsed.score === 'number' ? parsed.score : 0.5;
    return res.json([{ label: label, score: score }]);
  } catch (err) {
    console.error('[tone] exception:', err?.message || err);
    return res.status(503).json({ error: FAIL_MSG });
  }
});

app.use((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Friendlist</title>
<style>
  /* ============ THEME VARIABLES ============ */
  :root[data-theme="light"] {
    --bg: #ffffff;
    --bg-secondary: #f7f9f9;
    --bg-hover: #e7e7e8;
    --text-main: #0f1419;
    --text-secondary: #536471;
    --border: #eff3f4;
    --accent: #1d9bf0;
    --accent-hover: #1a8cd8;
    --danger: #f4212e;
    --danger-bg: #fdeded;
    --success: #00ba7c;
    --warning: #ffd400;
    --auth-gradient: linear-gradient(135deg, #1d9bf0 0%, #7856ff 100%);
  }

  :root[data-theme="dark"] {
    --bg: #000000;
    --bg-secondary: #16181c;
    --bg-hover: #181818;
    --text-main: #e7e9ea;
    --text-secondary: #71767b;
    --border: #2f3336;
    --accent: #1d9bf0;
    --accent-hover: #1a8cd8;
    --danger: #f4212e;
    --danger-bg: #2c1316;
    --success: #00ba7c;
    --warning: #ffd400;
    --auth-gradient: linear-gradient(135deg, #0a1929 0%, #1e0a29 100%);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background-color: var(--bg);
    color: var(--text-main);
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    transition: background-color 0.3s, color 0.3s;
  }
  button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; }
  input, textarea { font-family: inherit; color: var(--text-main); }

  /* ============ PROFESSIONAL AUTH SCREENS ============ */
  #auth-view {
    display: flex; min-height: 100vh; width: 100%;
  }
  
  /* Left Marketing Panel */
  .auth-left {
    flex: 1.2; background: var(--auth-gradient);
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    padding: 60px; position: relative; overflow: hidden;
  }
  
  /* Background Animated Orbs */
  .auth-left::before, .auth-left::after {
    content: ''; position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.5;
    animation: float 10s ease-in-out infinite;
  }
  .auth-left::before { width: 400px; height: 400px; background: #1d9bf0; top: -100px; left: -100px; }
  .auth-left::after { width: 300px; height: 300px; background: #f91880; bottom: -50px; right: -50px; animation-delay: -5s; }
  
  @keyframes float {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(30px, 50px); }
  }

  .auth-left-content { position: relative; z-index: 10; max-width: 500px; color: #ffffff; }
  .auth-logo-large { 
    font-size: 48px; font-weight: 900; letter-spacing: -1.5px; margin-bottom: 24px;
    display: flex; align-items: center; gap: 12px;
  }
  .auth-logo-large svg { width: 48px; height: 48px; fill: currentColor; }
  .auth-tagline { font-size: 36px; font-weight: 800; line-height: 1.2; margin-bottom: 40px; letter-spacing: -0.5px; }
  
  /* Floating UI Mockup */
  .auth-mockup {
    background: rgba(255, 255, 255, 0.1); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 20px; padding: 20px;
    display: flex; align-items: center; gap: 16px; margin-bottom: 16px;
    animation: slideUp 0.8s ease-out forwards; opacity: 0; transform: translateY(20px);
  }
  .auth-mockup:nth-child(2) { animation-delay: 0.2s; }
  .auth-mockup:nth-child(3) { animation-delay: 0.4s; }
  
  @keyframes slideUp { to { opacity: 1; transform: translateY(0); } }

  .mockup-avatar { width: 48px; height: 48px; border-radius: 50%; background: #ffd400; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #000; font-size: 18px; }
  .mockup-text { flex: 1; }
  .mockup-name { font-weight: 700; font-size: 15px; color: white; }
  .mockup-desc { font-size: 14px; color: rgba(255,255,255,0.7); }
  .mockup-tag { background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 99px; font-size: 12px; font-weight: 700; color: white; }

  /* Right Form Panel */
  .auth-right {
    flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center;
    padding: 40px; background: var(--bg); position: relative;
  }
  
  .auth-form-container {
    width: 100%; max-width: 380px;
    animation: fadeIn 0.4s ease-out;
  }
  
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

  .auth-form-title { font-size: 30px; font-weight: 800; margin-bottom: 32px; letter-spacing: -0.5px; }
  
  /* Floating Label Inputs */
  .input-group { position: relative; margin-bottom: 20px; }
  .input-group input {
    width: 100%; padding: 24px 16px 8px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--bg); font-size: 16px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .input-group input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(29,155,240,0.2); }
  .input-group label {
    position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
    color: var(--text-secondary); font-size: 16px; pointer-events: none;
    transition: all 0.2s ease-out;
  }
  .input-group input:focus ~ label,
  .input-group input:not(:placeholder-shown) ~ label {
    top: 14px; font-size: 12px; color: var(--accent); font-weight: 600;
  }
  
  /* Buttons */
  .btn-auth {
    width: 100%; padding: 16px; border-radius: 99px; background: var(--accent);
    color: white; font-weight: 700; font-size: 16px; margin-top: 10px; margin-bottom: 24px;
    transition: background 0.2s, transform 0.1s;
  }
  .btn-auth:hover { background: var(--accent-hover); }
  .btn-auth:active { transform: scale(0.98); }
  
  .btn-auth-outline {
    width: 100%; padding: 16px; border-radius: 99px; background: transparent;
    color: var(--accent); border: 1px solid var(--border); font-weight: 700; font-size: 16px;
    transition: background 0.2s, border-color 0.2s;
  }
  .btn-auth-outline:hover { background: rgba(29, 155, 240, 0.1); border-color: var(--accent); }

  .auth-links { text-align: left; font-size: 14px; color: var(--text-secondary); line-height: 1.6; }
  .auth-links a { color: var(--accent); cursor: pointer; text-decoration: none; font-weight: 600; }
  .auth-links a:hover { text-decoration: underline; }
  
  .auth-divider { display: flex; align-items: center; text-align: center; margin: 20px 0; color: var(--text-secondary); font-size: 14px; }
  .auth-divider::before, .auth-divider::after { content: ''; flex: 1; border-bottom: 1px solid var(--border); }
  .auth-divider::before { margin-right: 10px; }
  .auth-divider::after { margin-left: 10px; }

  /* ============ MAIN LAYOUT ============ */
  #app-layout { display: none; min-height: 100vh; flex-direction: column; }

  .top-nav {
    position: sticky; top: 0; z-index: 100;
    background: rgba(var(--bg), 0.85); backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border); height: 53px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 16px; max-width: 1265px; margin: 0 auto; width: 100%;
  }
  .nav-brand { color: var(--text-main); display: flex; align-items: center; width: 250px; }
  .nav-brand svg { width: 30px; height: 30px; fill: currentColor; }
  .nav-search { flex: 1; max-width: 400px; margin: 0 20px; position: relative; }
  .nav-search input {
    width: 100%; padding: 10px 16px 10px 44px; border-radius: 99px;
    background: var(--bg-secondary); border: 1px solid transparent; font-size: 15px;
  }
  .nav-search input:focus { outline: none; border-color: var(--accent); background: var(--bg); }
  .nav-search svg { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); fill: var(--text-secondary); width: 18px; height: 18px; }
  
  .nav-actions { display: flex; align-items: center; gap: 12px; width: 250px; justify-content: flex-end; }
  .nav-icon-btn {
    width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    transition: background 0.2s; color: var(--text-main);
  }
  .nav-icon-btn:hover { background: var(--bg-hover); }
  .nav-icon-btn svg { width: 20px; height: 20px; fill: currentColor; }
  
  .user-pill {
    display: flex; align-items: center; gap: 8px; padding: 4px 12px 4px 4px;
    border-radius: 99px; border: 1px solid var(--border); cursor: pointer; transition: background 0.2s;
  }
  .user-pill:hover { background: var(--bg-hover); }
  .user-pill img, .user-pill .avatar { width: 24px; height: 24px; border-radius: 50%; background: #333; display:flex; align-items:center; justify-content:center; font-size:10px; color:white; font-weight:bold; }
  .user-pill span { font-weight: 700; font-size: 14px; }
  .user-pill svg { width: 16px; height: 16px; fill: var(--text-secondary); }

  .main-container {
    display: flex; max-width: 1265px; margin: 0 auto; width: 100%; align-items: flex-start;
  }

  /* ============ LEFT SIDEBAR ============ */
  .left-sidebar { width: 275px; flex-shrink: 0; padding: 12px 12px 12px 0; position: sticky; top: 53px; height: calc(100vh - 53px); overflow-y: auto; }
  
  .profile-card {
    background: var(--bg); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; margin-bottom: 16px;
  }
  .profile-banner { height: 95px; background: #7bc7a6; }
  .profile-info { padding: 12px 16px 16px; position: relative; }
  .profile-avatar-wrap { position: absolute; top: -48px; left: 16px; border: 4px solid var(--bg); border-radius: 50%; background: var(--bg); }
  .profile-avatar {
    width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; 
    font-size: 28px; font-weight: 800; color: white; background: #f48fb1;
  }
  .profile-header { margin-top: 36px; }
  .profile-name { font-size: 18px; font-weight: 800; line-height: 1.2; }
  .profile-handle { color: var(--text-secondary); font-size: 14px; margin-bottom: 12px; }
  .profile-bio { font-size: 14px; margin-bottom: 12px; line-height: 1.4; }
  .profile-stats { display: flex; gap: 20px; font-size: 14px; margin-bottom: 16px; }
  .profile-stats strong { color: var(--text-main); font-weight: 700; }
  .profile-stats span { color: var(--text-secondary); font-weight: 400; }
  .profile-btn {
    display: block; width: 100%; padding: 8px; text-align: center; border-radius: 99px;
    border: 1px solid var(--border); font-weight: 700; font-size: 14px; transition: background 0.2s;
  }
  .profile-btn:hover { background: var(--bg-hover); }

  .suggestions-card {
    background: var(--bg-secondary); border-radius: 16px; padding: 16px;
  }
  .suggestions-title { font-size: 18px; font-weight: 800; margin-bottom: 16px; }
  .suggestion-item { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; cursor: pointer; }
  .suggestion-avatar { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white; flex-shrink: 0; font-size: 16px; }
  .suggestion-info { flex: 1; min-width: 0; }
  .suggestion-name { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .suggestion-handle { color: var(--text-secondary); font-size: 14px; }
  .follow-btn {
    padding: 6px 16px; border-radius: 99px; background: var(--text-main); color: var(--bg);
    font-weight: 700; font-size: 14px; transition: opacity 0.2s;
  }
  [data-theme="dark"] .follow-btn { background: #eff3f4; color: #0f1419; }
  .follow-btn:hover { opacity: 0.8; }
  .show-more { color: var(--accent); font-size: 14px; cursor: pointer; padding: 8px 0; display: block; }
  .show-more:hover { text-decoration: underline; }

  /* ============ CENTER FEED ============ */
  .feed-column { flex: 1; border-left: 1px solid var(--border); border-right: 1px solid var(--border); min-height: 100vh; max-width: 600px; }
  
  .feed-header {
    position: sticky; top: 53px; z-index: 50;
    background: rgba(var(--bg), 0.85); backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border); padding: 16px;
    font-size: 20px; font-weight: 800;
  }

  .composer { padding: 16px; border-bottom: 1px solid var(--border); display: flex; gap: 12px; }
  .composer-input-wrapper { flex: 1; }
  .composer-input {
    width: 100%; border: none; background: transparent; font-size: 20px; resize: none; outline: none; min-height: 60px; color: var(--text-main); padding-top: 12px;
  }
  .composer-input::placeholder { color: var(--text-secondary); }
  .composer-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
  .composer-tools { display: flex; gap: 4px; align-items: center; }
  .tool-pill { 
    display: flex; align-items: center; gap: 4px; color: var(--accent); padding: 6px 12px; 
    border-radius: 99px; border: 1px solid var(--border); font-size: 14px; font-weight: 600; cursor: pointer; 
  }
  .tool-pill:hover { background: rgba(29, 155, 240, 0.1); }
  .tool-pill svg { width: 18px; height: 18px; fill: currentColor; }
  .post-btn {
    background: var(--accent); color: white; font-weight: 700; font-size: 15px;
    padding: 8px 20px; border-radius: 99px; opacity: 0.5; pointer-events: none;
  }
  .post-btn.active { opacity: 1; pointer-events: auto; }
  .post-btn:hover { background: var(--accent-hover); }

  .post { display: flex; padding: 12px 16px; border-bottom: 1px solid var(--border); transition: background 0.2s; cursor: pointer; }
  .post:hover { background: var(--bg-hover); }
  .post-content { flex: 1; min-width: 0; margin-left: 12px; }
  .post-header { display: flex; align-items: center; gap: 4px; font-size: 15px; margin-bottom: 4px; }
  .post-name { font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 4px; }
  .post-name svg { width: 18px; height: 18px; fill: var(--accent); }
  .post-handle, .post-dot, .post-time { color: var(--text-secondary); font-weight: 400; }
  .post-text { font-size: 15px; line-height: 1.5; margin-bottom: 12px; word-break: break-word; white-space: pre-wrap; }
  .post-image { width: 100%; border-radius: 16px; border: 1px solid var(--border); margin-bottom: 12px; }
  
  .post-engagement { display: flex; gap: 20px; margin-bottom: 12px; color: var(--text-secondary); font-size: 13px; align-items: center; }
  .engagement-hearts { display: flex; align-items: center; }
  .engagement-hearts span { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--bg); display: flex; align-items: center; justify-content: center; margin-left: -6px; }
  .engagement-hearts span:first-child { margin-left: 0; background: #f91880; }
  .engagement-hearts span:nth-child(2) { background: #00ba7c; }
  .engagement-hearts span:nth-child(3) { background: var(--accent); }
  
  .post-actions { display: flex; justify-content: space-between; max-width: 425px; }
  .action-pill-btn {
    display: flex; align-items: center; justify-content: center; gap: 8px; flex: 1; padding: 8px;
    border-radius: 99px; border: 1px solid var(--border); font-weight: 600; font-size: 14px;
  }
  .action-pill-btn:hover { background: var(--bg-hover); }
  .action-pill-btn svg { width: 18px; height: 18px; fill: currentColor; }

  /* Comments Section */
  .comments-area { margin-top: 12px; display: none; }
  .comments-area.open { display: block; }
  .comment-composer { display: flex; gap: 12px; margin-bottom: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
  .comment-input-wrap { flex: 1; }
  .comment-input {
    width: 100%; padding: 12px; border-radius: 16px; background: var(--bg-secondary);
    border: 1px solid var(--border); font-size: 15px; resize: none; outline: none;
  }
  .comment-input:focus { border-color: var(--accent); }
  .comment-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
  .inline-tone { display: none; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; padding: 4px 10px; border-radius: 99px; background: rgba(29, 155, 240, 0.1); color: var(--accent); }
  .inline-tone.show { display: inline-flex; }
  .reply-btn { background: var(--accent); color: white; font-weight: 700; padding: 8px 16px; border-radius: 99px; font-size: 14px; }
  .comment-item { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid var(--border); }
  .comment-bubble { font-size: 14px; }
  .comment-bubble .name { font-weight: 700; margin-right: 4px; }

  /* ============ RIGHT SIDEBAR ============ */
  .right-sidebar { width: 350px; flex-shrink: 0; padding: 12px 0 12px 24px; position: sticky; top: 53px; height: calc(100vh - 53px); overflow-y: auto; }
  
  .trends-card {
    background: var(--bg-secondary); border-radius: 16px; padding: 16px; margin-bottom: 16px;
  }
  .trends-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .trends-title { font-size: 20px; font-weight: 800; }
  .trends-header svg { width: 20px; height: 20px; fill: var(--text-main); }
  
  .trend-item { margin-bottom: 20px; cursor: pointer; }
  .trend-item:hover .trend-topic { text-decoration: underline; }
  .trend-category { font-size: 13px; color: var(--text-secondary); }
  .trend-topic { font-size: 15px; font-weight: 700; margin: 2px 0; }
  .trend-count { font-size: 13px; color: var(--text-secondary); }

  /* Tone Result Styling */
  .tone-result-box { padding: 4px 0; text-align: center; }
  .tone-emoji { font-size: 64px; line-height: 1; margin-bottom: 12px; }
  .tone-label { font-size: 13px; color: var(--text-secondary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .tone-emotion { font-size: 28px; font-weight: 800; text-transform: capitalize; margin: 4px 0; }
  .tone-score { font-size: 40px; font-weight: 800; color: var(--accent); line-height: 1; margin: 12px 0; }
  .tone-score span { font-size: 20px; }
  .tone-bar-bg { height: 8px; background: var(--bg-hover); border-radius: 4px; overflow: hidden; margin-bottom: 16px; }
  .tone-bar-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.5s ease; }
  .tone-status { display: inline-block; padding: 6px 14px; border-radius: 99px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .tone-status.high { background: rgba(0, 186, 124, 0.1); color: var(--success); }
  .tone-status.med { background: rgba(255, 212, 0, 0.1); color: var(--warning); }
  .tone-status.low { background: rgba(244, 33, 46, 0.1); color: var(--danger); }

  .tone-empty { text-align: center; padding: 24px 0; color: var(--text-secondary); font-size: 14px; }
  .tone-error { color: var(--danger); background: var(--danger-bg); padding: 12px; border-radius: 8px; font-size: 14px; margin-top: 10px; }

  /* ============ AVATAR COLORS ============ */
  .av-1 { background: #1d9bf0; } .av-2 { background: #ffd400; } .av-3 { background: #f91880; }
  .av-4 { background: #00ba7c; } .av-5 { background: #7856ff; } .av-6 { background: #ff7a00; }

  @media (max-width: 1050px) {
    .right-sidebar { display: none; }
  }
  @media (max-width: 800px) {
    .left-sidebar { display: none; }
    .nav-search { display: none; }
    .feed-column { border: none; }
    .auth-left { display: none; }
    .auth-right { flex: 1; }
  }
</style>
</head>
<body>

<!-- AUTH VIEW (Split Screen) -->
<div id="auth-view" style="display:none;">
  
  <!-- Left Side (Marketing) -->
  <div class="auth-left">
    <div class="auth-left-content">
      <div class="auth-logo-large">
        <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        Friendlist
      </div>
      <div class="auth-tagline">Connect with people who actually get you.</div>
      
      <div class="auth-mockup">
        <div class="mockup-avatar" style="background:#00ba7c;">SJ</div>
        <div class="mockup-text">
          <div class="mockup-name">Sarah Jenkins</div>
          <div class="mockup-desc">Just launched my new project! 🚀</div>
        </div>
        <div class="mockup-tag">New</div>
      </div>
      
      <div class="auth-mockup">
        <div class="mockup-avatar" style="background:#f91880;">MK</div>
        <div class="mockup-text">
          <div class="mockup-name">Mike K.</div>
          <div class="mockup-desc">The tone analysis on this app is insane.</div>
        </div>
        <div class="mockup-tag" style="background: rgba(0, 186, 124, 0.2); color: #00ba7c;">Joy 98%</div>
      </div>
    </div>
  </div>

  <!-- Right Side (Form) -->
  <div class="auth-right">
    
    <!-- LOGIN FORM -->
    <div id="login-block" class="auth-form-container">
      <h1 class="auth-form-title">Sign in to Friendlist</h1>
      
      <div class="input-group">
        <input type="text" id="login-user" placeholder=" " autocomplete="username">
        <label>Username</label>
      </div>
      <div class="input-group">
        <input type="password" id="login-pass" placeholder=" " autocomplete="current-password">
        <label>Password</label>
      </div>

      <button class="btn-auth" onclick="handleLogin()">Sign In</button>
      
      <div class="auth-links">
        <a onclick="switchAuth('forgot')">Forgot your password?</a>
      </div>

      <div class="auth-divider">or</div>

      <button class="btn-auth-outline" onclick="switchAuth('signup')">Create a new account</button>
    </div>

    <!-- SIGNUP FORM -->
    <div id="signup-block" class="auth-form-container" style="display:none;">
      <h1 class="auth-form-title">Create your account</h1>
      
      <div class="input-group">
        <input type="text" id="signup-user" placeholder=" " autocomplete="username">
        <label>Choose a username</label>
      </div>
      <div class="input-group">
        <input type="password" id="signup-pass" placeholder=" " autocomplete="new-password">
        <label>Create a password</label>
      </div>

      <button class="btn-auth" onclick="handleSignup()">Sign Up</button>
      
      <div class="auth-links" style="margin-top: 24px; text-align: center;">
        Already have an account? <a onclick="switchAuth('login')">Sign in</a>
      </div>
    </div>

    <!-- FORGOT PASSWORD FORM -->
    <div id="forgot-block" class="auth-form-container" style="display:none;">
      <h1 class="auth-form-title">Reset your password</h1>
      
      <div class="input-group">
        <input type="text" id="forgot-user" placeholder=" ">
        <label>Username</label>
      </div>
      <div class="input-group">
        <input type="password" id="forgot-pass" placeholder=" ">
        <label>New Password</label>
      </div>

      <button class="btn-auth" onclick="handleForgot()">Reset Password</button>
      
      <div class="auth-links" style="margin-top: 24px; text-align: center;">
        <a onclick="switchAuth('login')">Back to sign in</a>
      </div>
    </div>

  </div>
</div>

<!-- APP LAYOUT -->
<div id="app-layout">
  
  <!-- TOP NAVIGATION -->
  <header class="top-nav">
    <div class="nav-brand">
      <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
    </div>
    <div class="nav-search">
      <svg viewBox="0 0 24 24"><path d="M10.25 3.75a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm-8.5 6.5a8.5 8.5 0 1 1 15.176 5.262l4.781 4.781-1.414 1.414-4.781-4.781A8.5 8.5 0 0 1 1.75 10.25z"/></svg>
      <input type="text" placeholder="Search" disabled>
    </div>
    <div class="nav-actions">
      <button class="nav-icon-btn" onclick="toggleTheme()" title="Toggle Theme">
        <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
      </button>
      <button class="nav-icon-btn"><svg viewBox="0 0 24 24"><path d="M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg></button>
      <button class="nav-icon-btn"><svg viewBox="0 0 24 24"><path d="M1.998 5.5c0-1.381 1.119-2.5 2.5-2.5h15c1.381 0 2.5 1.119 2.5 2.5v13c0 1.381-1.119 2.5-2.5 2.5h-15c-1.381 0-2.5-1.119-2.5-2.5v-13zm2.5-.5c-.276 0-.5.224-.5.5v2.764l8 3.638 8-3.636V5.5c0-.276-.224-.5-.5-.5h-15zm15.5 5.463l-8 3.636-8-3.638V18.5c0 .276.224.5.5.5h15c.276 0 .5-.224.5-.5v-8.037z"/></svg></button>
      <button class="nav-icon-btn"><svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/></svg></button>
      
      <div class="user-pill">
        <div id="nav-avatar" class="avatar"></div>
        <span id="nav-username"></span>
        <svg viewBox="0 0 24 24"><path d="M12 16l-6-6h12z"/></svg>
      </div>
      <button class="nav-icon-btn" onclick="handleLogout()" title="Log out"><svg viewBox="0 0 24 24"><path d="M3 3h6v6H3V3zm2 2v2h2V5H5zm8-2h6v6h-6V3zm2 2v2h2V5h-2zM3 13h6v6H3v-6zm2 2v2h2v-2H5zm13-2h3v2h-3v3h-2v-3h-3v-2h3V8h2v5z"/></svg></button>
    </div>
  </header>

  <div class="main-container">
    <!-- LEFT SIDEBAR -->
    <aside class="left-sidebar">
      <div class="profile-card">
        <div class="profile-banner"></div>
        <div class="profile-info">
          <div class="profile-avatar-wrap">
            <div id="sidebar-avatar" class="profile-avatar"></div>
          </div>
          <div class="profile-header">
            <div id="sidebar-name" class="profile-name"></div>
            <div id="sidebar-handle" class="profile-handle"></div>
          </div>
          <div class="profile-bio">+ Penting gak Penting yang penting Posting ✨</div>
          <div class="profile-stats">
            <div><strong>6,664</strong> <span>Following</span></div>
            <div><strong>9,991</strong> <span>Followers</span></div>
          </div>
          <button class="profile-btn">My Profile</button>
        </div>
      </div>

      <div class="suggestions-card">
        <div class="suggestions-title">Who to follow you</div>
        <div id="suggestions-list"></div>
        <a class="show-more">Show More</a>
      </div>
    </aside>

    <!-- CENTER FEED -->
    <main class="feed-column">
      <div class="feed-header">Home</div>
      
      <!-- COMPOSER -->
      <div class="composer">
        <div id="composer-avatar" class="suggestion-avatar" style="width:48px; height:48px; font-size:20px;"></div>
        <div class="composer-input-wrapper">
          <textarea class="composer-input" id="post-text" placeholder="What's happening?" oninput="togglePostBtn()"></textarea>
          <div class="composer-actions">
            <div class="composer-tools">
              <label class="tool-pill">
                <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71z"/></svg>
                Photo
                <input type="file" id="post-image" accept="image/*" style="display:none;" onchange="document.getElementById('file-name').textContent = this.files[0] ? this.files[0].name : ''">
              </label>
              <button class="tool-pill">
                <svg viewBox="0 0 24 24"><path d="M10 15l5.19-3L10 9v6zm11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 19c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 5c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z"/></svg>
                Video
              </button>
              <button class="tool-pill">
                <svg viewBox="0 0 24 24"><path d="M14 4v5c-6.8.5-10 5.3-11 11 2.2-4.1 5.4-6 11-6v5l8-7.5-8-7.5z"/></svg>
                Thread
              </button>
              <button class="tool-pill">
                <svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>
                Schedule
              </button>
            </div>
            <button class="post-btn" id="post-btn" onclick="handleCreatePost()">Post</button>
          </div>
          <div id="file-name" style="font-size:12px; color:var(--text-secondary); margin-top:8px; padding-left:8px;"></div>
        </div>
      </div>

      <!-- POSTS FEED -->
      <div id="feed"></div>
    </main>

    <!-- RIGHT SIDEBAR (TONE ANALYSIS & TRENDS) -->
    <aside class="right-sidebar">
      
      <!-- Tone Analysis styled as a Trends Card -->
      <div class="trends-card">
        <div class="trends-header">
          <div class="trends-title">Tone Analysis</div>
        </div>
        <div id="tone-panel-body">
          <div class="tone-empty">
            Start typing a comment to see real-time tone predictions.
          </div>
        </div>
      </div>

      <div class="trends-card">
        <div class="trends-header">
          <div class="trends-title">Trend for you</div>
          <svg viewBox="0 0 24 24"><path d="M10.54 13.46l-2.77 2.77 1.41 1.41 2.77-2.77 2.77 2.77 1.41-1.41-2.77-2.77 2.77-2.77-1.41-1.41-2.77 2.77-2.77-2.77-1.41 1.41 2.77 2.77zM12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 2.5-1 4.72-2.5 6.5L21 19l-1.5 1.5-1.5-1.5c-1.78 1.5-4 2.5-6.5 2.5zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c2.21 0 4.21-.9 5.66-2.34l-1.06-1.06C15.55 17.55 13.85 18 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6c0 1.85-.45 3.55-1.26 5.05l1.06 1.06C19.1 16.21 20 14.21 20 12c0-4.41-3.59-8-8-8z"/></svg>
        </div>
        
        <div class="trend-item">
          <div class="trend-category">Trending in Indonesia</div>
          <div class="trend-topic">#Minions</div>
          <div class="trend-count">97.7 k Tweets</div>
        </div>
        <div class="trend-item">
          <div class="trend-category">Trending</div>
          <div class="trend-topic">#SeninBarokah</div>
          <div class="trend-count">87.2 k Tweets</div>
        </div>
        <div class="trend-item">
          <div class="trend-category">NFT &middot; TRENDING</div>
          <div class="trend-topic">#Texos</div>
          <div class="trend-count">122.7 k Tweets</div>
        </div>
        <div class="trend-item">
          <div class="trend-category">FOOTBALL &middot; TRENDING</div>
          <div class="trend-topic">#MUFC</div>
          <div class="trend-count">97.2 k Tweets</div>
        </div>
        <div class="trend-item">
          <div class="trend-category">FOOTBALL &middot; TRENDING</div>
          <div class="trend-topic">#Rangnick</div>
          <div class="trend-count">77.2 k Tweets</div>
        </div>
        <div class="trend-item">
          <div class="trend-category">FOOTBALL &middot; TRENDING</div>
          <div class="trend-topic">#ThxOle</div>
          <div class="trend-count">54.2 k Tweets</div>
        </div>
        <a class="show-more">Show More</a>
      </div>
    </aside>
  </div>
</div>

<script>
/* ============================================================
   THEME LOGIC
   ============================================================ */
const root = document.documentElement;
let currentTheme = localStorage.getItem('theme') || 'dark';

function applyTheme(theme) {
  root.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}
applyTheme(currentTheme);

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
}

/* ============================================================
   APP LOGIC (IndexedDB, Auth, Feed, Tone)
   ============================================================ */
var dbPromise = null;
function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open('friendlist', 1);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('users')) {
          var u = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
          u.createIndex('username', 'username', { unique: true });
        }
        if (!db.objectStoreNames.contains('posts')) {
          db.createObjectStore('posts', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('comments')) {
          var c = db.createObjectStore('comments', { keyPath: 'id', autoIncrement: true });
          c.createIndex('postId', 'postId');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  return dbPromise;
}

function dbAdd(store, data) {
  return getDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, 'readwrite');
      var req = tx.objectStore(store).add(data);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  });
}
function dbPut(store, data) {
  return getDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, 'readwrite');
      var req = tx.objectStore(store).put(data);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  });
}
function dbGetAll(store) {
  return getDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, 'readonly');
      var req = tx.objectStore(store).getAll();
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  });
}
function dbGetByIndex(store, index, value) {
  return getDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, 'readonly');
      var req = tx.objectStore(store).index(index).getAll(value);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  });
}
function dbGetOneByIndex(store, index, value) {
  return getDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, 'readonly');
      var req = tx.objectStore(store).index(index).get(value);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}
function timeAgo(ts) {
  var diff = Date.now() - ts, s = Math.floor(diff / 1000);
  if (s < 60) return 'now';
  var m = Math.floor(s / 60); if (m < 60) return m + 'm';
  var h = Math.floor(m / 60); if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
}
var AVATAR_CLASSES = ['av-1', 'av-2', 'av-3', 'av-4', 'av-5', 'av-6'];
function getAvatarClass(name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_CLASSES[Math.abs(hash) % AVATAR_CLASSES.length];
}
function initials(name) { return (name || '?').slice(0, 2).toUpperCase(); }
function fileToDataURL(file) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = function () { reject(r.error); };
    r.readAsDataURL(file);
  });
}

var session = null;
try { session = JSON.parse(localStorage.getItem('session') || 'null'); } catch (e) { session = null; }
function setSession(u) {
  session = u;
  if (u) localStorage.setItem('session', JSON.stringify(u));
  else localStorage.removeItem('session');
}

function switchAuth(mode) {
  document.getElementById('login-block').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('signup-block').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('forgot-block').style.display = mode === 'forgot' ? 'block' : 'none';
  
  // Reset animation
  var containers = document.querySelectorAll('.auth-form-container');
  containers.forEach(function(c) {
    c.style.animation = 'none';
    c.offsetHeight; /* trigger reflow */
    c.style.animation = 'fadeIn 0.4s ease-out';
  });
}

async function handleSignup() {
  var u = document.getElementById('signup-user').value.trim();
  var p = document.getElementById('signup-pass').value;
  if (!u || !p) return alert('Fill all fields');
  var ex = await dbGetOneByIndex('users', 'username', u);
  if (ex) return alert('Username taken');
  var id = await dbAdd('users', { username: u, password: p, createdAt: Date.now() });
  setSession({ id: id, username: u });
  showApp();
}

async function handleLogin() {
  var u = document.getElementById('login-user').value.trim();
  var p = document.getElementById('login-pass').value;
  var user = await dbGetOneByIndex('users', 'username', u);
  if (!user || user.password !== p) return alert('Invalid credentials');
  setSession({ id: user.id, username: user.username });
  showApp();
}

async function handleForgot() {
  var u = document.getElementById('forgot-user').value.trim();
  var p = document.getElementById('forgot-pass').value;
  if (!u || !p) return alert('Fill all fields');
  var user = await dbGetOneByIndex('users', 'username', u);
  if (!user) return alert('User not found');
  user.password = p;
  await dbPut('users', user);
  alert('Password reset. You can login now.');
  switchAuth('login');
}

function handleLogout() {
  setSession(null);
  document.getElementById('auth-view').style.display = 'flex';
  document.getElementById('app-layout').style.display = 'none';
}

function showApp() {
  document.getElementById('auth-view').style.display = 'none';
  document.getElementById('app-layout').style.display = 'flex';

  var avClass = getAvatarClass(session.username);
  var ini = initials(session.username);

  var navAv = document.getElementById('nav-avatar');
  navAv.textContent = ini; navAv.className = 'avatar ' + avClass;
  document.getElementById('nav-username').textContent = session.username;

  var sideAv = document.getElementById('sidebar-avatar');
  sideAv.textContent = ini; sideAv.className = 'profile-avatar ' + avClass;
  document.getElementById('sidebar-name').textContent = session.username;
  document.getElementById('sidebar-handle').textContent = '@' + session.username.toLowerCase();

  var compAv = document.getElementById('composer-avatar');
  compAv.textContent = ini; compAv.className = 'suggestion-avatar ' + avClass;

  loadSuggestions();
  loadFeed();
}

async function loadSuggestions() {
  var users = await dbGetAll('users');
  var html = '';
  var count = 0;
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === session.id) continue;
    if (count >= 3) break;
    var u = users[i];
    html += '<div class="suggestion-item">';
    html += '<div class="suggestion-avatar ' + getAvatarClass(u.username) + '">' + initials(u.username) + '</div>';
    html += '<div class="suggestion-info">';
    html += '<div class="suggestion-name">' + escapeHtml(u.username) + '</div>';
    html += '<div class="suggestion-handle">@' + escapeHtml(u.username.toLowerCase()) + '</div>';
    html += '</div>';
    html += '<button class="follow-btn">Follow</button>';
    html += '</div>';
    count++;
  }
  if (count === 0) {
    html = '<div style="color:var(--text-secondary); font-size:14px; margin-bottom:16px;">No other users yet.</div>';
  }
  document.getElementById('suggestions-list').innerHTML = html;
}

function togglePostBtn() {
  var text = document.getElementById('post-text').value.trim();
  var file = document.getElementById('post-image').files[0];
  var btn = document.getElementById('post-btn');
  if (text || file) { btn.classList.add('active'); } else { btn.classList.remove('active'); }
}

async function handleCreatePost() {
  var text = document.getElementById('post-text').value.trim();
  var file = document.getElementById('post-image').files[0];
  if (!text && !file) return;
  var imgData = null;
  if (file) imgData = await fileToDataURL(file);
  
  await dbAdd('posts', { userId: session.id, text: text, image: imgData, createdAt: Date.now() });
  document.getElementById('post-text').value = '';
  document.getElementById('post-image').value = '';
  document.getElementById('file-name').textContent = '';
  togglePostBtn();
  loadFeed();
}

async function loadFeed() {
  var posts = await dbGetAll('posts');
  var users = await dbGetAll('users');
  var userMap = {};
  users.forEach(u => userMap[u.id] = u.username);
  posts.sort((a, b) => b.createdAt - a.createdAt);

  if (posts.length === 0) {
    document.getElementById('feed').innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-secondary);">No posts yet. Be the first to post!</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < posts.length; i++) {
    var p = posts[i];
    var author = userMap[p.userId] || 'Unknown';
    var avClass = getAvatarClass(author);
    
    html += '<div class="post" id="post-' + p.id + '">';
    html += '<div class="suggestion-avatar ' + avClass + '" style="width:48px; height:48px; font-size:20px;">' + initials(author) + '</div>';
    html += '<div class="post-content">';
    
    // Header
    html += '<div class="post-header">';
    html += '<span class="post-name">' + escapeHtml(author) + ' <svg viewBox="0 0 24 24"><path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.918-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.337 2.25c-.416-.165-.866-.25-1.336-.25-2.21 0-3.918 1.79-3.918 4 0 .495.084.965.238 1.4-1.273.65-2.148 2.02-2.148 3.6 0 1.48.768 2.77 1.918 3.51-.143.402-.22.83-.22 1.27 0 2.21 1.71 3.998 3.918 3.998.47 0 .92-.084 1.336-.25.52 1.333 1.828 2.25 3.337 2.25s2.816-.917 3.337-2.25c.416.165.866.25 1.336.25 2.21 0 3.918-1.79 3.918-4 0-.44-.077-.868-.22-1.27 1.15-.74 1.918-2.03 1.918-3.51zm-12.354 3.853L7.35 13.56l1.414-1.414 2.793 2.793 5.65-5.65 1.415 1.415-6.478 6.478z"/></svg></span>';
    html += '<span class="post-handle">@' + escapeHtml(author.toLowerCase()) + '</span>';
    html += '<span class="post-dot">&middot;</span>';
    html += '<span class="post-time">' + timeAgo(p.createdAt) + '</span>';
    html += '</div>';
    
    // Body
    if (p.text) html += '<div class="post-text">' + escapeHtml(p.text) + '</div>';
    if (p.image) html += '<img class="post-image" src="' + p.image + '" alt="Post image">';
    
    // Engagement row
    html += '<div class="post-engagement">';
    html += '<div class="engagement-hearts"><span></span><span></span><span></span></div>';
    html += '<span>241k</span>';
    html += '<span style="margin-left:auto;">45 Comments</span>';
    html += '</div>';

    // Action Pills
    html += '<div class="post-actions" style="gap:12px;">';
    html += '<button class="action-pill-btn like"><svg viewBox="0 0 24 24"><path d="M12 21.638h-.014C9.403 21.59 1.95 14.856 1.95 8.478c0-3.064 2.525-5.754 5.403-5.754 2.29 0 3.258 1.201 4.647 2.797 1.39-1.596 2.358-2.797 4.647-2.797 2.878 0 5.403 2.69 5.403 5.754 0 6.378-7.453 13.112-10.036 13.16h-.014zm0-18.316c-1.702 0-2.423 1.104-3.708 2.585l-.942 1.085-.942-1.085c-1.285-1.48-2.006-2.585-3.708-2.585-1.92 0-3.48 1.75-3.48 3.904 0 5.34 6.606 11.232 8.82 11.232h.014c2.214 0 8.82-5.892 8.82-11.232 0-2.154-1.56-3.904-3.48-3.904z"/></svg> Like</button>';
    html += '<button class="action-pill-btn retweet"><svg viewBox="0 0 24 24"><path d="M23.77 15.67c-.292-.293-.767-.293-1.06 0l-2.22 2.22V7.65c0-2.068-1.683-3.75-3.75-3.75h-5.85c-.414 0-.75.336-.75.75s.336.75.75.75h5.85c1.24 0 2.25 1.01 2.25 2.25v10.24l-2.22-2.22c-.293-.293-.768-.293-1.06 0-.293.293-.293.768 0 1.06l3.5 3.5c.145.147.337.22.53.22s.383-.072.53-.22l3.5-3.5c.293-.293.293-.768 0-1.06zm-10.89 1.95H7.03c-1.24 0-2.25-1.01-2.25-2.25V5.13l2.22 2.22c.146.147.337.22.53.22s.383-.072.53-.22c.293-.293.293-.768 0-1.06l-3.5-3.5c-.293-.293-.767-.293-1.06 0l-3.5 3.5c-.293.293-.293.767 0 1.06.146.147.337.22.53.22s.383-.072.53-.22l2.22-2.22v10.24c0 2.068 1.683 3.75 3.75 3.75h5.85c.414 0 .75-.336.75-.75s-.336-.75-.75-.75z"/></svg> Retweet</button>';
    html += '<button class="action-pill-btn" onclick="toggleComments(' + p.id + ')"><svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"/></svg> Comment</button>';
    html += '<button class="action-pill-btn" style="flex:0; padding:8px 12px;"><svg viewBox="0 0 24 24"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z"/></svg></button>';
    html += '</div>';

    // Comments Area
    html += '<div class="comments-area" id="comments-' + p.id + '">';
    
    // Comment Input
    html += '<div class="comment-composer">';
    html += '<div class="suggestion-avatar ' + getAvatarClass(session.username) + '" style="width:32px; height:32px; font-size:14px;">' + initials(session.username) + '</div>';
    html += '<div class="comment-input-wrap">';
    html += '<textarea class="comment-input" id="c-input-' + p.id + '" placeholder="Post your reply" rows="1" oninput="debouncedAnalyze(' + p.id + ')"></textarea>';
    html += '<div class="comment-actions">';
    html += '<span class="inline-tone" id="inline-tone-' + p.id + '"></span>';
    html += '<button class="reply-btn" onclick="handlePostComment(' + p.id + ')">Reply</button>';
    html += '</div></div></div>';
    
    // Existing Comments List
    html += '<div id="c-list-' + p.id + '"></div>';
    html += '</div>'; // end comments-area
    
    html += '</div></div>'; // end post-content, post
  }
  document.getElementById('feed').innerHTML = html;
}

async function toggleComments(postId) {
  var el = document.getElementById('comments-' + postId);
  if (el.classList.contains('open')) {
    el.classList.remove('open');
  } else {
    el.classList.add('open');
    await loadComments(postId);
  }
}

async function loadComments(postId) {
  var comments = await dbGetByIndex('comments', 'postId', postId);
  var users = await dbGetAll('users');
  var userMap = {};
  users.forEach(u => userMap[u.id] = u.username);
  comments.sort((a, b) => a.createdAt - b.createdAt);

  var list = document.getElementById('c-list-' + postId);
  if (comments.length === 0) {
    list.innerHTML = '<div style="color:var(--text-secondary); font-size:13px; text-align:center; padding:10px;">No replies yet.</div>';
    return;
  }
  
  var html = '';
  for (var i = 0; i < comments.length; i++) {
    var c = comments[i];
    var author = userMap[c.userId] || 'Unknown';
    html += '<div class="comment-item">';
    html += '<div class="suggestion-avatar ' + getAvatarClass(author) + '" style="width:32px; height:32px; font-size:14px;">' + initials(author) + '</div>';
    html += '<div class="comment-bubble">';
    html += '<span class="name">' + escapeHtml(author) + '</span>';
    html += '<span>' + escapeHtml(c.text) + '</span>';
    html += '</div></div>';
  }
  list.innerHTML = html;
}

async function handlePostComment(postId) {
  var input = document.getElementById('c-input-' + postId);
  var text = input.value.trim();
  if (!text) return;
  
  await dbAdd('comments', { postId: postId, userId: session.id, text: text, createdAt: Date.now() });
  input.value = '';
  
  // Hide inline tone
  var toneEl = document.getElementById('inline-tone-' + postId);
  toneEl.classList.remove('show');
  toneEl.textContent = '';
  
  renderToneEmpty();
  loadComments(postId);
}

/* ============================================================
   TONE ANALYSIS
   ============================================================ */
var EMOJI_MAP = {
  joy: '😊',
  sadness: '😔',
  anger: '😠',
  fear: '😨',
  excitement: '🤩',
  surprise: '😲',
  neutral: '😐',
  disgust: '🤢',
  trust: '🤝'
};

var debounceTimers = {};
function debouncedAnalyze(postId) {
  clearTimeout(debounceTimers[postId]);
  debounceTimers[postId] = setTimeout(function () { analyzeTone(postId); }, 600);
}

async function analyzeTone(postId) {
  var text = document.getElementById('c-input-' + postId).value.trim();
  var toneEl = document.getElementById('inline-tone-' + postId);
  
  if (!text) {
    toneEl.classList.remove('show');
    toneEl.textContent = '';
    renderToneEmpty();
    return;
  }

  renderToneLoading();

  try {
    var res = await fetch('/api/analyze-tone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });
    var data = await res.json();
    
    if (!res.ok || data.error) {
      toneEl.classList.remove('show');
      renderToneError('Tokenizer Error', data.error || 'Service unavailable.');
      return;
    }
    
    var arr = Array.isArray(data) ? data : [data];
    var top = arr.reduce((a, b) => a.score > b.score ? a : b);
    var pct = (top.score * 100).toFixed(1);
    var emoji = EMOJI_MAP[top.label] || '😐';
    
    // Update inline pill
    toneEl.innerHTML = '<span style="font-size:14px; line-height:1;">' + emoji + '</span> ' + escapeHtml(top.label) + ' &middot; ' + pct + '%';
    toneEl.classList.add('show');
    
    // Update sidebar panel
    renderToneResult(arr, top);
    
  } catch (err) {
    toneEl.classList.remove('show');
    renderToneError('Tokenizer Error', 'Network request failed.');
  }
}

function renderToneEmpty() {
  document.getElementById('tone-panel-body').innerHTML = '<div class="tone-empty">Start typing a comment to see real-time tone predictions.</div>';
}

function renderToneLoading() {
  document.getElementById('tone-panel-body').innerHTML = '<div class="tone-empty">Analyzing emotion...</div>';
}

function renderToneResult(data, top) {
  var pctNum = top.score * 100;
  var pct = pctNum.toFixed(1);
  var emoji = EMOJI_MAP[top.label] || '😐';
  
  var statusClass = pctNum >= 70 ? 'high' : (pctNum >= 40 ? 'med' : 'low');
  var statusText = pctNum >= 70 ? 'High Confidence' : (pctNum >= 40 ? 'Medium Confidence' : 'Low Confidence');

  var html = '<div class="tone-result-box">';
  html += '<div class="tone-emoji">' + emoji + '</div>';
  html += '<div class="tone-label">Detected Emotion</div>';
  html += '<div class="tone-emotion">' + escapeHtml(top.label) + '</div>';
  
  html += '<div class="tone-score">' + pct + '<span>%</span></div>';
  
  html += '<div class="tone-bar-bg">';
  html += '<div class="tone-bar-fill" style="width:' + pct + '%"></div>';
  html += '</div>';
  
  html += '<div class="tone-status ' + statusClass + '">' + statusText + '</div>';
  html += '</div>';

  document.getElementById('tone-panel-body').innerHTML = html;
}

function renderToneError(title, detail) {
  document.getElementById('tone-panel-body').innerHTML = 
    '<div class="tone-error"><strong>' + escapeHtml(title) + '</strong><br>' + escapeHtml(detail) + '</div>';
}

/* ============================================================
   INIT
   ============================================================ */
if (session) showApp();
else document.getElementById('auth-view').style.display = 'flex';

</script>
</body>
</html>`);
});

banner();
app.listen(PORT, () => {});