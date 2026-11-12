import express from 'express';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = 'openai/gpt-oss-20b';

const NO_KEY_MSG = 'Analysis service is temporarily unavailable. Please try again in a moment.';
const FAIL_MSG   = 'Analysis could not be completed. Please try again in a moment.';
const RATE_MSG   = 'Analysis is taking longer than usual. Please try again shortly.';

app.use(express.json());

function banner() {
  const key = process.env.GROQ_API_KEY;
  const keyStatus = !key ? 'MISSING' : (!key.startsWith('gsk_') ? 'SUSPICIOUS' : (key.length !== 56 ? 'SUSPICIOUS' : 'OK'));
  console.log(`\n  Friendlist Server | Model: ${MODEL} | Key: ${keyStatus} | Port: ${PORT}\n`);
}

app.get('/api/health', async (req, res) => {
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ status: 'down' });
  res.json({ status: 'ok' });
});

app.post('/api/analyze-tone', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Please write something first.' });

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(503).json({ error: NO_KEY_MSG });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_completion_tokens: 256,
        top_p: 1,
        reasoning_effort: 'low',
        stream: false,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are an AI content moderator and emotion classifier. Analyze the user text. Respond ONLY with a JSON object containing: "label" (one word, lowercase, from this exact list: joy, sadness, anger, fear, excitement, surprise, neutral, disgust, trust), "score" (number 0 to 1 representing confidence), and "isOffensive" (boolean, true if the text contains profanity, hate speech, harassment, or severe toxicity). Output valid JSON and nothing else.'
          },
          { role: 'user', content: text }
        ]
      })
    });

    if (response.status === 401) return res.status(503).json({ error: FAIL_MSG });
    if (response.status === 429) return res.status(429).json({ error: RATE_MSG });
    if (!response.ok) return res.status(503).json({ error: FAIL_MSG });

    const data = await response.json();
    let parsed;
    try {
      parsed = JSON.parse(data.choices[0].message.content);
    } catch (parseErr) {
      return res.status(503).json({ error: FAIL_MSG });
    }

    return res.json({
      label: (parsed.label || 'neutral').toLowerCase(),
      score: typeof parsed.score === 'number' ? parsed.score : 0.5,
      isOffensive: parsed.isOffensive === true
    });
  } catch (err) {
    return res.status(503).json({ error: FAIL_MSG });
  }
});

app.use((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Friendlist - Connect with the world</title>
<style>
  /* ============ THEME VARIABLES ============ */
  :root[data-theme="light"] {
    --bg: #f0f2f5;
    --card: #ffffff;
    --text-main: #050505;
    --text-secondary: #65676b;
    --border: #ced0d4;
    --hover: #f2f2f2;
    --primary: #1877f2;
    --primary-hover: #166fe5;
    --success: #42b72a;
    --success-hover: #36a420;
    --danger: #fa383e;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.1);
    --shadow-lg: 0 12px 28px rgba(0, 0, 0, 0.2), 0 2px 4px rgba(0, 0, 0, 0.1);
    --shadow-card: 0 8px 30px rgba(0, 0, 0, 0.08);
    --gradient: linear-gradient(135deg, #1877f2 0%, #9360f7 100%);
    --auth-bg: linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%);
    --input-bg: #f5f6f7;
  }

  :root[data-theme="dark"] {
    --bg: #18191a;
    --card: #242526;
    --text-main: #e4e6eb;
    --text-secondary: #b0b3b8;
    --border: #3e4042;
    --hover: #3a3b3c;
    --primary: #2e89ff;
    --primary-hover: #1877f2;
    --success: #42b72a;
    --success-hover: #36a420;
    --danger: #fa383e;
    --shadow-sm: 0 1px 2px rgba(255, 255, 255, 0.05);
    --shadow-lg: 0 12px 28px rgba(0, 0, 0, 0.5);
    --shadow-card: 0 8px 30px rgba(0, 0, 0, 0.4);
    --gradient: linear-gradient(135deg, #2e89ff 0%, #a36bff 100%);
    --auth-bg: linear-gradient(135deg, #1e0a29 0%, #0a1929 100%);
    --input-bg: #3a3b3c;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background-color: var(--bg);
    color: var(--text-main);
    font-size: 15px;
    line-height: 1.34;
    -webkit-font-smoothing: antialiased;
    transition: background-color 0.3s, color 0.3s;
  }
  button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; }
  input, textarea { font-family: inherit; color: var(--text-main); }

  /* ============ PREMIUM AUTH SCREENS ============ */
  #auth-view {
    display: none; min-height: 100vh; align-items: center; justify-content: center;
    background: var(--bg); padding: 20px;
  }

  .auth-container {
    display: flex; width: 100%; max-width: 1000px; min-height: 600px;
    background: var(--card); border-radius: 24px; overflow: hidden;
    box-shadow: var(--shadow-card); animation: fadeUp 0.6s ease-out;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Left Side (Branding) */
  .auth-left {
    flex: 1; background: var(--gradient); padding: 60px;
    display: flex; flex-direction: column; justify-content: center;
    position: relative; overflow: hidden; color: white;
  }
  
  /* Abstract floating shapes */
  .auth-left::before, .auth-left::after {
    content: ''; position: absolute; border-radius: 50%; background: rgba(255,255,255,0.1);
  }
  .auth-left::before { width: 300px; height: 300px; top: -100px; right: -100px; }
  .auth-left::after { width: 200px; height: 200px; bottom: -50px; left: -50px; }

  .auth-logo-large { font-size: 48px; font-weight: 900; letter-spacing: -2px; margin-bottom: 20px; position: relative; z-index: 2; }
  .auth-tagline { font-size: 28px; font-weight: 500; line-height: 1.3; position: relative; z-index: 2; opacity: 0.95; }

  /* Right Side (Forms) */
  .auth-right {
    flex: 1; padding: 50px; display: flex; flex-direction: column; justify-content: center;
    background: var(--card);
  }

  .auth-form-header { margin-bottom: 30px; }
  .auth-form-title { font-size: 28px; font-weight: 800; color: var(--text-main); margin-bottom: 8px; }
  .auth-form-sub { font-size: 15px; color: var(--text-secondary); }

  /* Modern Inputs with Icons */
  .input-group { position: relative; margin-bottom: 16px; }
  .input-icon {
    position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
    width: 20px; height: 20px; fill: var(--text-secondary); pointer-events: none;
  }
  .form-input {
    width: 100%; padding: 16px 16px 16px 48px; border-radius: 12px;
    border: 2px solid transparent; background: var(--input-bg);
    font-size: 16px; color: var(--text-main); transition: all 0.2s ease;
  }
  .form-input:focus {
    outline: none; border-color: var(--primary); background: var(--card);
    box-shadow: 0 0 0 4px rgba(24, 119, 242, 0.15);
  }
  .form-input::placeholder { color: var(--text-secondary); font-weight: 400; }

  /* Side-by-side inputs for Names */
  .input-row { display: flex; gap: 12px; }
  .input-row .input-group { flex: 1; margin-bottom: 16px; }

  /* Buttons */
  .btn-auth {
    width: 100%; padding: 16px; border-radius: 12px; font-weight: 700; font-size: 17px;
    transition: all 0.2s ease; margin-top: 10px;
  }
  .btn-auth.primary {
    background: var(--primary); color: white;
  }
  .btn-auth.primary:hover { background: var(--primary-hover); transform: translateY(-2px); box-shadow: 0 6px 15px rgba(24,119,242,0.3); }
  
  .btn-auth.success {
    background: var(--success); color: white;
  }
  .btn-auth.success:hover { background: var(--success-hover); transform: translateY(-2px); box-shadow: 0 6px 15px rgba(66,183,42,0.3); }

  .auth-divider { display: flex; align-items: center; text-align: center; margin: 24px 0; color: var(--text-secondary); font-size: 14px; font-weight: 500; }
  .auth-divider::before, .auth-divider::after { content: ''; flex: 1; border-bottom: 1px solid var(--border); }
  .auth-divider::before { margin-right: 10px; }
  .auth-divider::after { margin-left: 10px; }

  .auth-links { text-align: center; font-size: 15px; color: var(--text-secondary); margin-top: 20px; }
  .auth-links a { color: var(--primary); font-weight: 600; text-decoration: none; cursor: pointer; }
  .auth-links a:hover { text-decoration: underline; }

  .terms-text { font-size: 12px; color: var(--text-secondary); line-height: 1.4; margin: 16px 0; text-align: left; }
  .terms-text a { color: var(--primary); text-decoration: none; font-weight: 600; }
  .terms-text a:hover { text-decoration: underline; }

  /* ============ MAIN APP LAYOUT ============ */
  #app-layout { display: none; min-height: 100vh; flex-direction: column; background: var(--bg); }
  .top-nav { position: sticky; top: 0; z-index: 100; height: 56px; background: var(--card); box-shadow: var(--shadow-sm); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; }
  .nav-left { display: flex; align-items: center; gap: 10px; width: 300px; }
  .nav-logo { font-size: 32px; font-weight: 800; color: var(--primary); letter-spacing: -1.5px; }
  .nav-search { position: relative; width: 100%; max-width: 240px; }
  .nav-search input { width: 100%; padding: 10px 16px 10px 36px; border-radius: 99px; background: var(--bg); border: 1px solid transparent; font-size: 15px; }
  .nav-search input:focus { outline: none; border-color: var(--primary); background: var(--card); }
  .nav-search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); fill: var(--text-secondary); width: 16px; height: 16px; }
  .nav-center { display: flex; gap: 8px; height: 100%; flex: 1; justify-content: center; }
  .nav-tab { width: 100px; height: 100%; display: flex; align-items: center; justify-content: center; border-bottom: 3px solid transparent; color: var(--text-secondary); cursor: pointer; }
  .nav-tab:hover { background: var(--hover); border-radius: 8px; }
  .nav-tab.active { border-bottom-color: var(--primary); color: var(--primary); }
  .nav-tab svg { width: 28px; height: 28px; fill: currentColor; }
  .nav-right { display: flex; align-items: center; gap: 8px; width: 300px; justify-content: flex-end; }
  .nav-icon-btn { width: 40px; height: 40px; border-radius: 50%; background: var(--bg); display: flex; align-items: center; justify-content: center; }
  .nav-icon-btn:hover { background: var(--hover); }
  .nav-icon-btn svg { width: 20px; height: 20px; fill: var(--text-main); }
  .nav-avatar { width: 40px; height: 40px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; }

  .main-container { display: flex; max-width: 1600px; margin: 0 auto; width: 100%; padding-top: 16px; gap: 32px; }
  .left-sidebar { width: 280px; flex-shrink: 0; padding-left: 16px; position: sticky; top: 72px; height: calc(100vh - 72px); overflow-y: auto; }
  .sidebar-item { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 8px; font-weight: 500; font-size: 15px; cursor: pointer; margin-bottom: 4px; }
  .sidebar-item:hover { background: var(--hover); }
  .sidebar-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; flex-shrink: 0; }
  .sidebar-icon { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .sidebar-icon svg { width: 24px; height: 24px; }

  .feed-column { flex: 1; max-width: 680px; margin: 0 auto; padding-bottom: 40px; }
  .composer { background: var(--card); border-radius: 8px; padding: 12px 16px; box-shadow: var(--shadow-sm); margin-bottom: 16px; }
  .composer-top { display: flex; gap: 8px; margin-bottom: 12px; }
  .composer-input { flex: 1; padding: 8px 12px; border-radius: 20px; background: var(--hover); border: none; font-size: 17px; resize: none; outline: none; min-height: 40px; display: flex; align-items: center; color: var(--text-main); }
  .composer-input::placeholder { color: var(--text-secondary); }
  .composer-divider { height: 1px; background: var(--border); margin: 0 -16px 12px; }
  .composer-actions { display: flex; justify-content: space-between; align-items: center; }
  .composer-btn { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; font-weight: 600; font-size: 15px; color: var(--text-secondary); flex: 1; justify-content: center; }
  .composer-btn:hover { background: var(--hover); }

  .post { background: var(--card); border-radius: 8px; box-shadow: var(--shadow-sm); margin-bottom: 16px; overflow: hidden; }
  .post-header { display: flex; align-items: center; padding: 12px 16px; gap: 8px; }
  .post-info { flex: 1; }
  .post-name { font-weight: 600; font-size: 15px; color: var(--text-main); }
  .post-time { font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px; }
  .post-text { padding: 4px 16px 16px; font-size: 15px; white-space: pre-wrap; }
  .post-image { width: 100%; max-height: 500px; object-fit: cover; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .post-stats { padding: 10px 16px; display: flex; justify-content: space-between; color: var(--text-secondary); font-size: 15px; border-bottom: 1px solid var(--border); margin: 0 16px; }
  .post-actions { display: flex; padding: 4px; margin: 0 16px; }
  .post-action-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px; border-radius: 4px; font-weight: 600; color: var(--text-secondary); font-size: 15px; }
  .post-action-btn:hover { background: var(--hover); }

  .comments-area { display: none; padding: 12px 16px; background: var(--card); }
  .comments-area.open { display: block; }
  .comment-composer { display: flex; gap: 8px; margin-bottom: 12px; align-items: flex-start; }
  .comment-input-wrap { flex: 1; background: var(--hover); border-radius: 16px; padding: 8px 12px; }
  .comment-input { width: 100%; background: transparent; border: none; font-size: 15px; resize: none; outline: none; min-height: 24px; }
  .inline-tone-container { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; }
  .inline-tone-badge { display: none; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; background: var(--card); padding: 4px 10px; border-radius: 99px; border: 1px solid var(--border); color: var(--text-secondary); }
  .inline-tone-badge.show { display: inline-flex; }
  .inline-tone-emoji { font-size: 16px; }
  .reply-btn { background: transparent; color: var(--primary); font-weight: 600; padding: 6px 12px; border-radius: 6px; font-size: 14px; }
  .reply-btn:hover { background: var(--hover); }
  .comment-item { display: flex; gap: 8px; margin-bottom: 8px; }
  .comment-bubble { background: var(--hover); padding: 8px 12px; border-radius: 16px; font-size: 14px; max-width: 100%; }
  .comment-bubble .name { font-weight: 600; display: block; margin-bottom: 2px; }

  .right-sidebar { width: 280px; flex-shrink: 0; padding-right: 16px; position: sticky; top: 72px; height: calc(100vh - 72px); overflow-y: auto; }
  .widget-card { background: var(--card); border-radius: 8px; box-shadow: var(--shadow-sm); padding: 16px; margin-bottom: 16px; }
  .widget-title { font-size: 17px; font-weight: 600; color: var(--text-secondary); margin-bottom: 16px; }

  .av-1 { background: #1877f2; } .av-2 { background: #f7b928; } .av-3 { background: #f02849; }
  .av-4 { background: #42b72a; } .av-5 { background: #9360f7; } .av-6 { background: #f76128; }

  @media (max-width: 1100px) {
    .right-sidebar { display: none; }
    .main-container { justify-content: center; }
  }
  @media (max-width: 900px) {
    .left-sidebar { display: none; }
    .auth-left { display: none; }
    .auth-right { padding: 40px 20px; }
    .auth-container { max-width: 450px; min-height: auto; }
  }
  @media (max-width: 800px) {
    .nav-left .nav-search { display: none; }
    .nav-tab { width: 60px; }
  }
</style>
</head>
<body>

<!-- PREMIUM AUTH VIEW -->
<div id="auth-view">
  <div class="auth-container">
    <!-- Left Side (Branding) -->
    <div class="auth-left">
      <div class="auth-logo-large">Friendlist</div>
      <div class="auth-tagline">Connect with friends and the world around you on Friendlist.</div>
    </div>

    <!-- Right Side (Forms) -->
    <div class="auth-right">
      
      <!-- LOGIN FORM -->
      <div id="login-block" class="auth-form">
        <div class="auth-form-header">
          <h2 class="auth-form-title">Welcome back</h2>
          <p class="auth-form-sub">Log in to continue to your feed.</p>
        </div>

        <div class="input-group">
          <svg class="input-icon" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          <input class="form-input" type="text" id="login-user" placeholder="Email address or Username">
        </div>
        
        <div class="input-group">
          <svg class="input-icon" viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>
          <input class="form-input" type="password" id="login-pass" placeholder="Password">
        </div>

        <button class="btn-auth primary" onclick="handleLogin()">Log In</button>
        
        <div class="auth-links" style="margin-bottom: 24px;">
          <a onclick="switchAuth('forgot')">Forgotten password?</a>
        </div>

        <div class="auth-divider">OR</div>

        <button class="btn-auth success" onclick="switchAuth('signup')" style="background: var(--bg); color: var(--success); border: 2px solid var(--success); box-shadow: none;">Create New Account</button>
      </div>

      <!-- SIGNUP FORM -->
      <div id="signup-block" class="auth-form" style="display:none;">
        <div class="auth-form-header">
          <h2 class="auth-form-title">Create an account</h2>
          <p class="auth-form-sub">It's quick and easy.</p>
        </div>

        <div class="input-row">
          <div class="input-group">
            <svg class="input-icon" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            <input class="form-input" type="text" id="signup-fname" placeholder="First name">
          </div>
          <div class="input-group">
            <svg class="input-icon" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            <input class="form-input" type="text" id="signup-lname" placeholder="Last name">
          </div>
        </div>

        <div class="input-group">
          <svg class="input-icon" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
          <input class="form-input" type="email" id="signup-email" placeholder="Email address">
        </div>

        <div class="input-group">
          <svg class="input-icon" viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>
          <input class="form-input" type="password" id="signup-pass" placeholder="New password">
        </div>

        <div class="input-group">
          <svg class="input-icon" viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>
          <input class="form-input" type="password" id="signup-confirm" placeholder="Confirm password">
        </div>

        <div class="terms-text">
          By clicking Sign Up, you agree to our <a href="#">Terms</a>, <a href="#">Data Policy</a> and <a href="#">Cookie Policy</a>.
        </div>

        <button class="btn-auth success" onclick="handleSignup()">Sign Up</button>
        
        <div class="auth-links" style="margin-top: 24px;">
          Already have an account? <a onclick="switchAuth('login')">Log in</a>
        </div>
      </div>

      <!-- FORGOT PASSWORD FORM -->
      <div id="forgot-block" class="auth-form" style="display:none;">
        <div class="auth-form-header">
          <h2 class="auth-form-title">Reset Password</h2>
          <p class="auth-form-sub">Enter your email and a new password.</p>
        </div>

        <div class="input-group">
          <svg class="input-icon" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
          <input class="form-input" type="text" id="forgot-user" placeholder="Email address or Username">
        </div>
        
        <div class="input-group">
          <svg class="input-icon" viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>
          <input class="form-input" type="password" id="forgot-pass" placeholder="New Password">
        </div>

        <button class="btn-auth primary" onclick="handleForgot()">Reset Password</button>
        
        <div class="auth-links" style="margin-top: 24px;">
          <a onclick="switchAuth('login')">Back to Login</a>
        </div>
      </div>

    </div>
  </div>
</div>

<!-- APP LAYOUT -->
<div id="app-layout">
  <header class="top-nav">
    <div class="nav-left">
      <div class="nav-logo">Friendlist</div>
      <div class="nav-search">
        <svg viewBox="0 0 24 24"><path d="M10.25 3.75a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm-8.5 6.5a8.5 8.5 0 1 1 15.176 5.262l4.781 4.781-1.414 1.414-4.781-4.781A8.5 8.5 0 0 1 1.75 10.25z"/></svg>
        <input type="text" placeholder="Search Friendlist" disabled>
      </div>
    </div>
    
    <div class="nav-center">
      <div class="nav-tab active">
        <svg viewBox="0 0 24 24"><path d="M9.005 16.545a2.997 2.997 0 0 1 2.997-2.997A2.997 2.997 0 0 1 15 16.545V22h7V11.543L12 2 2 11.543V22h7.005z"/></svg>
      </div>
      <div class="nav-tab">
        <svg viewBox="0 0 24 24"><path d="M16.5 12c1.38 0 2.49-1.12 2.49-2.5S17.88 7 16.5 7C15.12 7 14 8.12 14 9.5s1.12 2.5 2.5 2.5zM9 11c1.66 0 2.99-1.34 2.99-3S10.66 5 9 5C7.34 5 6 6.34 6 8s1.34 3 3 3zm7.5 3c-1.83 0-5.5.92-5.5 2.75V19h11v-2.25c0-1.83-3.67-2.75-5.5-2.75zM9 13c-2.33 0-7 1.17-7 3.5V19h7v-2.25c0-.85.33-2.34 2.37-3.47C10.5 13.1 9.66 13 9 13z"/></svg>
      </div>
      <div class="nav-tab">
        <svg viewBox="0 0 24 24"><path d="M13 10h1v2h-1v2h-2v-2H9v-2h2V8h2v2zm-1-7C6.48 3 2 7.48 2 13s4.48 10 10 10 10-4.48 10-10S17.52 3 12 3zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>
      </div>
    </div>

    <div class="nav-right">
      <button class="nav-icon-btn" onclick="toggleTheme()" title="Toggle Theme">
        <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
      </button>
      <button class="nav-icon-btn">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
      </button>
      <div id="nav-avatar" class="nav-avatar" onclick="handleLogout()" title="Log out"></div>
    </div>
  </header>

  <div class="main-container">
    <aside class="left-sidebar">
      <div class="sidebar-item" onclick="handleLogout()">
        <div id="sidebar-avatar" class="sidebar-avatar"></div>
        <span id="sidebar-name">User</span>
      </div>
      <div class="sidebar-item">
        <div class="sidebar-icon" style="background: #1877f2; color: white; border-radius: 8px;">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c1.38 0 2.49-1.12 2.49-2.5S17.88 7 16.5 7C15.12 7 14 8.12 14 9.5s1.12 2.5 2.5 2.5zM9 11c1.66 0 2.99-1.34 2.99-3S10.66 5 9 5C7.34 5 6 6.34 6 8s1.34 3 3 3zm7.5 3c-1.83 0-5.5.92-5.5 2.75V19h11v-2.25c0-1.83-3.67-2.75-5.5-2.75zM9 13c-2.33 0-7 1.17-7 3.5V19h7v-2.25c0-.85.33-2.34 2.37-3.47C10.5 13.1 9.66 13 9 13z"/></svg>
        </div>
        Friends
      </div>
      <div class="sidebar-item">
        <div class="sidebar-icon" style="background: #f02849; color: white; border-radius: 8px;">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5z"/></svg>
        </div>
        Watch
      </div>
      <div class="sidebar-item">
        <div class="sidebar-icon" style="background: #9360f7; color: white; border-radius: 8px;">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        </div>
        Groups
      </div>
    </aside>

    <main class="feed-column">
      <div class="composer">
        <div class="composer-top">
          <div id="composer-avatar" class="sidebar-avatar" style="width:40px; height:40px;"></div>
          <textarea class="composer-input" id="post-text" placeholder="What's on your mind?" oninput="togglePostBtn()"></textarea>
        </div>
        <div class="composer-divider"></div>
        <div class="composer-actions">
          <label class="composer-btn" style="color: #45bd62;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71z"/></svg>
            Photo/Video
            <input type="file" id="post-image" accept="image/*" style="display:none;" onchange="document.getElementById('file-name').textContent = this.files[0] ? this.files[0].name : ''">
          </label>
          <div class="composer-btn" style="color: #f7b928;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>
            Feeling/Activity
          </div>
          <button class="btn-auth primary" id="post-btn" onclick="handleCreatePost()" style="width:auto; padding: 6px 16px; margin-bottom: 0; opacity: 0.5; pointer-events: none; font-size: 15px;">Post</button>
        </div>
        <div id="file-name" style="font-size:12px; color:var(--text-secondary); margin-top:8px;"></div>
      </div>

      <div id="feed"></div>
    </main>

    <aside class="right-sidebar">
      <div class="widget-card">
        <div class="widget-title">Contacts</div>
        <div id="contacts-list"></div>
      </div>
    </aside>
  </div>
</div>

<script>
/* ============================================================
   THEME LOGIC
   ============================================================ */
const root = document.documentElement;
let currentTheme = localStorage.getItem('theme') || 'light';
function applyTheme(theme) { root.setAttribute('data-theme', theme); localStorage.setItem('theme', theme); }
applyTheme(currentTheme);
function toggleTheme() { currentTheme = currentTheme === 'dark' ? 'light' : 'dark'; applyTheme(currentTheme); }

/* ============================================================
   APP LOGIC (IndexedDB, Auth, Feed, Tone)
   ============================================================ */
var dbPromise = null;
function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open('friendlist', 2);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('users')) {
          var u = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
          u.createIndex('username', 'username', { unique: true });
          u.createIndex('email', 'email', { unique: true });
        } else {
          var tx = e.target.transaction;
          var userStore = tx.objectStore('users');
          if (!userStore.indexNames.contains('email')) {
            userStore.createIndex('email', 'email', { unique: true });
          }
        }
        if (!db.objectStoreNames.contains('posts')) db.createObjectStore('posts', { keyPath: 'id', autoIncrement: true });
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
  return getDB().then(db => new Promise((res, rej) => {
    var tx = db.transaction(store, 'readwrite'); var req = tx.objectStore(store).add(data);
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  }));
}
function dbPut(store, data) {
  return getDB().then(db => new Promise((res, rej) => {
    var tx = db.transaction(store, 'readwrite'); var req = tx.objectStore(store).put(data);
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  }));
}
function dbGetAll(store) {
  return getDB().then(db => new Promise((res, rej) => {
    var tx = db.transaction(store, 'readonly'); var req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  }));
}
function dbGetByIndex(store, index, value) {
  return getDB().then(db => new Promise((res, rej) => {
    var tx = db.transaction(store, 'readonly'); var req = tx.objectStore(store).index(index).getAll(value);
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  }));
}
function dbGetOneByIndex(store, index, value) {
  return getDB().then(db => new Promise((res, rej) => {
    var tx = db.transaction(store, 'readonly'); var req = tx.objectStore(store).index(index).get(value);
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  }));
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function timeAgo(ts) {
  var diff = Date.now() - ts, s = Math.floor(diff / 1000);
  if (s < 60) return 'Just now';
  var m = Math.floor(s / 60); if (m < 60) return m + 'm';
  var h = Math.floor(m / 60); if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
}
var AVATAR_CLASSES = ['av-1', 'av-2', 'av-3', 'av-4', 'av-5', 'av-6'];
function getAvatarClass(name) {
  var hash = 0; for (var i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_CLASSES[Math.abs(hash) % AVATAR_CLASSES.length];
}
function initials(name) { 
  var parts = name.split(' ');
  if(parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase(); 
}
function fileToDataURL(file) {
  return new Promise((res, rej) => {
    var r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file);
  });
}

var session = null;
try { session = JSON.parse(localStorage.getItem('session') || 'null'); } catch (e) { session = null; }
function setSession(u) { session = u; if (u) localStorage.setItem('session', JSON.stringify(u)); else localStorage.removeItem('session'); }

function showAuth(mode) {
  document.getElementById('auth-view').style.display = 'flex';
  document.getElementById('app-layout').style.display = 'none';
  switchAuth(mode);
}

function switchAuth(mode) {
  document.getElementById('login-block').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('signup-block').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('forgot-block').style.display = mode === 'forgot' ? 'block' : 'none';
}

async function handleSignup() {
  var fname = document.getElementById('signup-fname').value.trim();
  var lname = document.getElementById('signup-lname').value.trim();
  var email = document.getElementById('signup-email').value.trim();
  var pass = document.getElementById('signup-pass').value;
  var confirm = document.getElementById('signup-confirm').value;

  if (!fname || !lname || !email || !pass || !confirm) return alert('Please fill in all fields.');
  if (pass !== confirm) return alert('Passwords do not match.');
  if (pass.length < 6) return alert('Password must be at least 6 characters.');

  var username = fname + ' ' + lname;

  var exEmail = await dbGetOneByIndex('users', 'email', email);
  if (exEmail) return alert('This email is already registered.');
  
  var exUser = await dbGetOneByIndex('users', 'username', username);
  if (exUser) return alert('A user with this name already exists. Please try a different variation.');

  var id = await dbAdd('users', { username: username, email: email, password: pass, createdAt: Date.now() });
  setSession({ id: id, username: username, email: email }); 
  showApp();
}

async function handleLogin() {
  var input = document.getElementById('login-user').value.trim();
  var p = document.getElementById('login-pass').value;
  if (!input || !p) return alert('Please fill in all fields.');
  
  var user = await dbGetOneByIndex('users', 'email', input);
  if (!user) {
    user = await dbGetOneByIndex('users', 'username', input);
  }

  if (!user || user.password !== p) return alert('Invalid credentials.');
  
  setSession({ id: user.id, username: user.username, email: user.email }); 
  showApp();
}

async function handleForgot() {
  var input = document.getElementById('forgot-user').value.trim();
  var p = document.getElementById('forgot-pass').value;
  if (!input || !p) return alert('Fill all fields');
  
  var user = await dbGetOneByIndex('users', 'email', input);
  if (!user) {
    user = await dbGetOneByIndex('users', 'username', input);
  }

  if (!user) return alert('User not found');
  
  user.password = p; 
  await dbPut('users', user);
  alert('Password reset. You can login now.'); 
  switchAuth('login');
}

function handleLogout() {
  setSession(null);
  showAuth('login');
}

function showApp() {
  document.getElementById('auth-view').style.display = 'none';
  document.getElementById('app-layout').style.display = 'flex';

  var avClass = getAvatarClass(session.username);
  var ini = initials(session.username);

  var navAv = document.getElementById('nav-avatar');
  navAv.textContent = ini; navAv.className = 'nav-avatar ' + avClass;

  var sideAv = document.getElementById('sidebar-avatar');
  sideAv.textContent = ini; sideAv.className = 'sidebar-avatar ' + avClass;
  document.getElementById('sidebar-name').textContent = session.username;

  var compAv = document.getElementById('composer-avatar');
  compAv.textContent = ini; compAv.className = 'sidebar-avatar ' + avClass;
  
  document.getElementById('post-text').placeholder = "What's on your mind, " + session.username.split(' ')[0] + "?";

  loadContacts();
  loadFeed();
}

async function loadContacts() {
  var users = await dbGetAll('users');
  var html = ''; var count = 0;
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === session.id) continue;
    if (count >= 5) break;
    var u = users[i];
    html += '<div class="sidebar-item" style="margin-bottom: 8px; padding: 4px;">';
    html += '<div class="sidebar-avatar ' + getAvatarClass(u.username) + '" style="width: 32px; height: 32px; font-size: 12px;">' + initials(u.username) + '</div>';
    html += '<span style="font-weight: 600; font-size: 15px; margin-left: 8px;">' + escapeHtml(u.username) + '</span>';
    html += '</div>'; count++;
  }
  if (count === 0) html = '<div style="color:var(--text-secondary); font-size:14px;">No contacts yet.</div>';
  document.getElementById('contacts-list').innerHTML = html;
}

function togglePostBtn() {
  var text = document.getElementById('post-text').value.trim();
  var file = document.getElementById('post-image').files[0];
  var btn = document.getElementById('post-btn');
  if (text || file) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; } 
  else { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }
}

async function handleCreatePost() {
  var text = document.getElementById('post-text').value.trim();
  var file = document.getElementById('post-image').files[0];
  if (!text && !file) return;
  var imgData = null; if (file) imgData = await fileToDataURL(file);
  await dbAdd('posts', { userId: session.id, text: text, image: imgData, createdAt: Date.now() });
  document.getElementById('post-text').value = '';
  document.getElementById('post-image').value = '';
  document.getElementById('file-name').textContent = '';
  togglePostBtn(); loadFeed();
}

async function loadFeed() {
  var posts = await dbGetAll('posts');
  var users = await dbGetAll('users');
  var userMap = {}; users.forEach(u => userMap[u.id] = u.username);
  posts.sort((a, b) => b.createdAt - a.createdAt);

  if (posts.length === 0) {
    document.getElementById('feed').innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-secondary);">No posts yet. Be the first to post!</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < posts.length; i++) {
    var p = posts[i]; var author = userMap[p.userId] || 'Unknown'; var avClass = getAvatarClass(author);
    
    html += '<div class="post" id="post-' + p.id + '">';
    html += '<div class="post-header">';
    html += '<div class="sidebar-avatar ' + avClass + '" style="width:40px; height:40px; font-size:16px;">' + initials(author) + '</div>';
    html += '<div class="post-info">';
    html += '<div class="post-name">' + escapeHtml(author) + '</div>';
    html += '<div class="post-time">' + timeAgo(p.createdAt) + ' &middot; <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.5 6.5L7 11 4.5 8.5l1-1L7 9l3.5-3.5 1 1z"/></svg></div>';
    html += '</div></div>';
    
    if (p.text) html += '<div class="post-text">' + escapeHtml(p.text) + '</div>';
    if (p.image) html += '<img class="post-image" src="' + p.image + '" alt="Post image">';
    
    html += '<div class="post-stats"><div style="display:flex; align-items:center; gap:4px;">';
    html += '<span style="background:#1877f2; color:white; border-radius:50%; width:18px; height:18px; display:flex; align-items:center; justify-content:center; font-size:10px;">👍</span>';
    html += '<span style="background:#f02849; color:white; border-radius:50%; width:18px; height:18px; display:flex; align-items:center; justify-content:center; font-size:10px; margin-left:-4px;">❤️</span>';
    html += '<span style="margin-left:4px;">241</span></div><div>45 Comments</div></div>';

    html += '<div class="post-actions">';
    html += '<button class="post-action-btn"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 21.638h-.014C9.403 21.59 1.95 14.856 1.95 8.478c0-3.064 2.525-5.754 5.403-5.754 2.29 0 3.258 1.201 4.647 2.797 1.39-1.596 2.358-2.797 4.647-2.797 2.878 0 5.403 2.69 5.403 5.754 0 6.378-7.453 13.112-10.036 13.16h-.014zm0-18.316c-1.702 0-2.423 1.104-3.708 2.585l-.942 1.085-.942-1.085c-1.285-1.48-2.006-2.585-3.708-2.585-1.92 0-3.48 1.75-3.48 3.904 0 5.34 6.606 11.232 8.82 11.232h.014c2.214 0 8.82-5.892 8.82-11.232 0-2.154-1.56-3.904-3.48-3.904z"/></svg> Like</button>';
    html += '<button class="post-action-btn" onclick="toggleComments(' + p.id + ')"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"/></svg> Comment</button>';
    html += '<button class="post-action-btn"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M14 4v5c-6.8.5-10 5.3-11 11 2.2-4.1 5.4-6 11-6v5l8-7.5-8-7.5z"/></svg> Share</button>';
    html += '</div>';

    html += '<div class="comments-area" id="comments-' + p.id + '">';
    
    html += '<div class="comment-composer">';
    html += '<div class="sidebar-avatar ' + getAvatarClass(session.username) + '" style="width:32px; height:32px; font-size:12px;">' + initials(session.username) + '</div>';
    html += '<div class="comment-input-wrap">';
    html += '<textarea class="comment-input" id="c-input-' + p.id + '" placeholder="Write a comment..." rows="1" oninput="debouncedAnalyze(' + p.id + ')"></textarea>';
    
    html += '<div class="inline-tone-container">';
    html += '<div class="inline-tone-badge" id="tone-badge-' + p.id + '"></div>';
    html += '<button class="reply-btn" onclick="handlePostComment(' + p.id + ')">Reply</button>';
    html += '</div>';
    
    html += '</div></div>';
    
    html += '<div id="c-list-' + p.id + '"></div>';
    html += '</div>'; 
    html += '</div>'; 
  }
  document.getElementById('feed').innerHTML = html;
}

async function toggleComments(postId) {
  var el = document.getElementById('comments-' + postId);
  if (el.classList.contains('open')) el.classList.remove('open');
  else { el.classList.add('open'); await loadComments(postId); }
}

async function loadComments(postId) {
  var comments = await dbGetByIndex('comments', 'postId', postId);
  var users = await dbGetAll('users');
  var userMap = {}; users.forEach(u => userMap[u.id] = u.username);
  comments.sort((a, b) => a.createdAt - b.createdAt);

  var list = document.getElementById('c-list-' + postId);
  if (comments.length === 0) {
    list.innerHTML = '<div style="color:var(--text-secondary); font-size:14px; text-align:center; padding:10px;">No comments yet.</div>';
    return;
  }
  
  var html = '';
  for (var i = 0; i < comments.length; i++) {
    var c = comments[i]; var author = userMap[c.userId] || 'Unknown';
    html += '<div class="comment-item">';
    html += '<div class="sidebar-avatar ' + getAvatarClass(author) + '" style="width:32px; height:32px; font-size:12px;">' + initials(author) + '</div>';
    html += '<div class="comment-bubble"><span class="name">' + escapeHtml(author) + '</span><span>' + escapeHtml(c.text) + '</span></div>';
    html += '</div>';
  }
  list.innerHTML = html;
}

async function handlePostComment(postId) {
  var input = document.getElementById('c-input-' + postId);
  var text = input.value.trim();
  if (!text) return;

  var moderation = toneCache[postId];
  if (moderation && moderation.isOffensive) {
    var proceed = confirm("Warning: This comment has been flagged as potentially offensive or toxic. Are you sure you want to post it?");
    if (!proceed) return;
  }

  await dbAdd('comments', { postId: postId, userId: session.id, text: text, createdAt: Date.now() });
  input.value = '';
  
  var badge = document.getElementById('tone-badge-' + postId);
  badge.classList.remove('show');
  delete toneCache[postId];

  loadComments(postId);
}

/* ============================================================
   TONE ANALYSIS
   ============================================================ */
var EMOJI_MAP = {
  joy: '😊', sadness: '😔', anger: '😡', fear: '😨',
  excitement: '🤩', surprise: '😲', neutral: '😐', disgust: '🤢', trust: '🤝'
};
var toneCache = {};
var debounceTimers = {};

function debouncedAnalyze(postId) {
  clearTimeout(debounceTimers[postId]);
  debounceTimers[postId] = setTimeout(function () { analyzeTone(postId); }, 600);
}

async function analyzeTone(postId) {
  var text = document.getElementById('c-input-' + postId).value.trim();
  var badge = document.getElementById('tone-badge-' + postId);
  
  if (!text) {
    badge.classList.remove('show');
    delete toneCache[postId];
    return;
  }

  badge.innerHTML = '<span style="color:var(--text-secondary);">Analyzing...</span>';
  badge.classList.add('show');

  try {
    var res = await fetch('/api/analyze-tone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });
    var data = await res.json();
    
    if (!res.ok || data.error) {
      badge.innerHTML = '<span style="color:var(--danger);">Error</span>';
      delete toneCache[postId];
      return;
    }
    
    toneCache[postId] = data;

    var emoji = EMOJI_MAP[data.label] || '😐';
    var pct = Math.round(data.score * 100);
    var warningHtml = data.isOffensive ? '<span style="color:var(--danger); margin-left:4px;">(Offensive)</span>' : '';
    
    badge.innerHTML = '<span class="inline-tone-emoji">' + emoji + '</span> ' + escapeHtml(data.label) + ' &middot; ' + pct + '%' + warningHtml;
    badge.classList.add('show');
    
  } catch (err) {
    badge.innerHTML = '<span style="color:var(--danger);">Offline</span>';
    delete toneCache[postId];
  }
}

/* ============================================================
   INIT
   ============================================================ */
if (session) showApp();
else showAuth('login');
</script>
</body>
</html>`);
});

banner();
app.listen(PORT, '0.0.0.0', () => {
  console.log('Friendlist server running on port ' + PORT);
});
