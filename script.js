"use strict";

// ─── SUPABASE CONFIG ───────────────────────────────────────────────
const SB_URL = "https://sdrmbrrhgovkzzlmdqul.supabase.co";
const SB_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcm1icnJoZ292a3p6bG1kcXVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MTcwNjEsImV4cCI6MjA4OTE5MzA2MX0.YIcN9PQRcKAvCq-3_wpom3Ir-uD8tCZh2efg7Xasyyg";

// Direct REST helper — no SDK needed
async function sbPost(path, body) {
  const r = await fetch(SB_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SB_KEY,
      Authorization: "Bearer " + SB_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { ok: r.ok, data, status: r.status };
}

async function sbGet(path) {
  const r = await fetch(SB_URL + path, {
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
  });
  const data = await r.json();
  return { ok: r.ok, data };
}

async function sbUpsert(table, row, onConflict) {
  const url = `${SB_URL}/rest/v1/${table}?on_conflict=${onConflict}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SB_KEY,
      Authorization: "Bearer " + SB_KEY,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  return { ok: r.ok, status: r.status };
}

async function sbInsert(table, row) {
  const url = `${SB_URL}/rest/v1/${table}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SB_KEY,
      Authorization: "Bearer " + SB_KEY,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  return { ok: r.ok, status: r.status };
}

// ─── CONSTANTS ─────────────────────────────────────────────────────
const FREE_LIMIT = 3;
const RESET_MS = 12 * 3600 * 1000;

const BANNED = [
  /prompt\s*(ai|generator|tool|maker|builder|engine|app|website|platform)/i,
  /build\s*(a\s+)?(ai|prompt)\s*(generator|tool|app|website|clone)/i,
  /create\s*(a\s+)?prompt\s*(generator|tool|app|system)/i,
  /make\s*(a\s+)?prompt\s*(generator|tool|app)/i,
  /ai\s*that\s*(generates?|creates?|makes?)\s*prompts/i,
  /clone\s*(of|this)\s*prompt/i,
];
const isBanned = (t) => BANNED.some((p) => p.test(t));

let currentUser = null;
let selectedCat = "general";
let selectedTone = "professional";
let fullPromptText = "";
let timerInterval = null;
let dropdownOpen = false;

const LS = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  },
};

// ─── INIT ──────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  setupPills();

  // Show local file warning if opened via file://
  if (isLocalFile()) {
    document.getElementById("localWarning").style.display = "block";
  }

  // Restore session from localStorage
  const saved = LS.get("pai_user");
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      showApp();
    } catch (e) {
      showAuth();
    }
  } else {
    // Check URL for Google OAuth token (hash fragment)
    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      handleOAuthCallback(hash);
    } else {
      showAuth();
    }
  }

  document.addEventListener("click", (e) => {
    const btn = document.getElementById("userBtn");
    const dd = document.getElementById("userDropdown");
    if (
      dropdownOpen &&
      btn &&
      dd &&
      !btn.contains(e.target) &&
      !dd.contains(e.target)
    ) {
      closeDropdown();
    }
  });
});

function setupPills() {
  document.querySelectorAll(".pill").forEach((p) => {
    p.addEventListener("click", () => {
      document
        .querySelectorAll(".pill")
        .forEach((x) => x.classList.remove("active"));
      p.classList.add("active");
      selectedCat = p.getAttribute("data-cat");
    });
  });
  document.querySelectorAll(".tone-btn").forEach((b) => {
    b.addEventListener("click", () => {
      document
        .querySelectorAll(".tone-btn")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      selectedTone = b.getAttribute("data-tone");
    });
  });
}

// ─── ROUTING ───────────────────────────────────────────────────────
function showAuth() {
  document.getElementById("authPage").classList.add("active");
  document.getElementById("appPage").classList.remove("active");
}
function showApp() {
  document.getElementById("authPage").classList.remove("active");
  document.getElementById("appPage").classList.add("active");
  updateUserUI();
  updateUsageUI();
}
function showLogin() {
  document.getElementById("loginForm").style.display = "";
  document.getElementById("registerForm").style.display = "none";
  document.getElementById("loginError").style.display = "none";
}
function showRegister() {
  document.getElementById("loginForm").style.display = "none";
  document.getElementById("registerForm").style.display = "";
  document.getElementById("regError").style.display = "none";
}

// ─── AUTH HEADERS ──────────────────────────────────────────────────
function authHeaders(extra) {
  return Object.assign(
    {
      "Content-Type": "application/json",
      apikey: SB_KEY,
      "X-Client-Info": "prompt-ai/1.0",
    },
    extra || {},
  );
}

function isLocalFile() {
  return window.location.protocol === "file:";
}

function corsError(errEl) {
  showErr(
    errEl,
    "⚠️ This file is opened locally (file://). Supabase requires a real URL. " +
      "Please host the file first — upload to Netlify Drop (netlify.com/drop) " +
      "or GitHub Pages, then try again.",
  );
}

// ─── AUTH — EMAIL/PASSWORD via Supabase Auth REST ──────────────────
async function doLogin() {
  const email = document
    .getElementById("loginEmail")
    .value.trim()
    .toLowerCase();
  const pass = document.getElementById("loginPass").value;
  const err = document.getElementById("loginError");
  err.style.display = "none";

  if (!email || !pass) {
    showErr(err, "Please fill in all fields.");
    return;
  }
  if (isLocalFile()) {
    corsError(err);
    return;
  }

  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in...';

  try {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await r.json();

    if (!r.ok) {
      const msg =
        data.error_description ||
        data.msg ||
        data.error ||
        "Invalid email or password.";
      showErr(
        err,
        msg === "Invalid login credentials"
          ? "Wrong email or password. Try again."
          : msg,
      );
    } else {
      await saveSession(data);
    }
  } catch (e) {
    showErr(
      err,
      "Could not reach the server. Make sure you're on a hosted URL, not a local file.",
    );
  }

  btn.disabled = false;
  btn.innerHTML = "Sign In";
}

async function doRegister() {
  const name = document.getElementById("regName").value.trim();
  const email = document
    .getElementById("regEmail")
    .value.trim()
    .toLowerCase();
  const pass = document.getElementById("regPass").value;
  const err = document.getElementById("regError");
  err.style.display = "none";

  if (!name || !email || !pass) {
    showErr(err, "Please fill in all fields.");
    return;
  }
  if (pass.length < 6) {
    showErr(err, "Password needs at least 6 characters.");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showErr(err, "That doesn't look like a valid email.");
    return;
  }
  if (isLocalFile()) {
    corsError(err);
    return;
  }

  const btn = document.getElementById("regBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creating account...';

  try {
    const r = await fetch(`${SB_URL}/auth/v1/signup`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        email,
        password: pass,
        data: { full_name: name },
      }),
    });
    const data = await r.json();

    if (!r.ok) {
      const msg =
        data.error_description ||
        data.msg ||
        data.error ||
        "Registration failed.";
      showErr(err, msg);
      btn.disabled = false;
      btn.innerHTML = "Create Account";
      return;
    }

    if (data.access_token) {
      await saveSession(data, name);
    } else {
      // Email confirmation required — show success
      err.style.cssText =
        "display:block;color:var(--success);background:rgba(52,211,153,0.08);border-color:rgba(52,211,153,0.2);";
      err.textContent =
        "✓ Account created! Check your email to confirm, then sign in.";
      setTimeout(showLogin, 3500);
    }
  } catch (e) {
    showErr(
      err,
      "Could not reach the server. Make sure you're on a hosted URL, not a local file.",
    );
  }

  btn.disabled = false;
  btn.innerHTML = "Create Account";
}

async function saveSession(authData, overrideName) {
  const user = authData.user;
  if (!user) return;

  const name =
    overrideName ||
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email.split("@")[0];
  const provider = user.app_metadata?.provider || "email";

  // Save to our users table
  await sbUpsert(
    "users",
    {
      id: user.id,
      name: name,
      email: user.email,
      provider: provider,
    },
    "id",
  );

  currentUser = { id: user.id, name, email: user.email, provider };
  LS.set("pai_user", JSON.stringify(currentUser));
  showApp();
  showToast("Welcome, " + name.split(" ")[0] + "! ⚡", "success");
}

async function handleOAuthCallback(hash) {
  // Parse access_token from URL hash after Google OAuth redirect
  const params = new URLSearchParams(hash.replace("#", ""));
  const accessToken = params.get("access_token");
  if (!accessToken) {
    showAuth();
    return;
  }

  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_KEY, Authorization: "Bearer " + accessToken },
    });
    const user = await r.json();
    if (r.ok && user.id) {
      // Clean URL
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname,
      );
      await saveSession({ access_token: accessToken, user });
    } else {
      showAuth();
    }
  } catch (e) {
    showAuth();
  }
}

function doGoogleLogin() {
  // Redirect to Supabase Google OAuth
  const redirectTo = encodeURIComponent(
    window.location.href.split("#")[0],
  );
  window.location.href = `${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}`;
}

function doLogout() {
  closeDropdown();
  LS.remove("pai_user");
  currentUser = null;
  document.getElementById("userGoal").value = "";
  document.getElementById("outputCard").classList.remove("visible");
  document.getElementById("blockedMsg").style.display = "none";
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  showAuth();
  showLogin();
  showToast("Signed out. See you soon!", "");
}

// ─── USER UI ───────────────────────────────────────────────────────
function updateUserUI() {
  if (!currentUser) return;
  const initials = currentUser.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  document.getElementById("userAvatar").textContent = initials;
  document.getElementById("userLabel").textContent =
    currentUser.name.split(" ")[0];
  document.getElementById("dropdownName").textContent = currentUser.name;
  document.getElementById("dropdownEmail").textContent =
    currentUser.email || "";
}
function toggleDropdown() {
  dropdownOpen = !dropdownOpen;
  document
    .getElementById("userDropdown")
    .classList.toggle("open", dropdownOpen);
}
function closeDropdown() {
  dropdownOpen = false;
  document.getElementById("userDropdown").classList.remove("open");
}

// ─── USAGE ─────────────────────────────────────────────────────────
function usageKey() {
  return "pai_usage_" + (currentUser ? currentUser.id : "anon");
}

function getUsage() {
  const r = LS.get(usageKey());
  if (!r) return { count: 0, resetAt: null };
  try {
    return JSON.parse(r);
  } catch (e) {
    return { count: 0, resetAt: null };
  }
}

function incrementUsage() {
  let u = getUsage();
  const now = Date.now();
  if (!u.resetAt || now >= u.resetAt) {
    u = { count: 1, resetAt: now + RESET_MS };
  } else {
    u.count++;
  }
  LS.set(usageKey(), JSON.stringify(u));
  return u;
}

function checkUsage() {
  const u = getUsage();
  const now = Date.now();
  if (!u.resetAt || now >= u.resetAt)
    return { allowed: true, remaining: FREE_LIMIT, resetAt: null };
  if (u.count >= FREE_LIMIT)
    return { allowed: false, remaining: 0, resetAt: u.resetAt };
  return {
    allowed: true,
    remaining: FREE_LIMIT - u.count,
    resetAt: u.resetAt,
  };
}

function updateUsageUI() {
  const s = checkUsage();
  const badge = document.getElementById("usageBadge");
  document.getElementById("usageText").textContent =
    s.remaining + " left";
  badge.className = "usage-badge";
  if (s.remaining === 1) badge.classList.add("low");
  if (s.remaining === 0) badge.classList.add("empty");
}

// ─── GENERATE ──────────────────────────────────────────────────────
async function generatePrompt() {
  const goal = document.getElementById("userGoal").value.trim();
  const blockedEl = document.getElementById("blockedMsg");
  blockedEl.style.display = "none";

  if (!goal) {
    showToast("Tell us what you need first.", "error");
    return;
  }
  if (isBanned(goal)) {
    blockedEl.style.display = "block";
    document.getElementById("outputCard").classList.remove("visible");
    return;
  }

  const status = checkUsage();
  if (!status.allowed) {
    showGate(status.resetAt);
    return;
  }

  const btn = document.getElementById("generateBtn");
  const outputCard = document.getElementById("outputCard");
  const outputEl = document.getElementById("promptOutput");
  const tipBox = document.getElementById("tipBox");

  tipBox.style.display = "none";
  fullPromptText = "";
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Building...';
  outputCard.classList.add("visible");
  outputEl.innerHTML =
    '<div class="loading-indicator"><div class="dots"><span></span><span></span><span></span></div>&nbsp; On it...</div>';

  // ── STEP 1: Analyse what kind of goal this actually is ──────────────
  // Each category has distinct failure modes and prompt patterns that work.
  // A real engineer thinks about WHY prompts fail before writing one.

  const catPlaybook = {
    general: {
      desc: "a general task",
      failureModes:
        "vague outputs, AI makes too many assumptions, no clear success criteria",
      mustHave:
        'a precise deliverable, explicit success criteria, scope boundaries, and a "think step by step" anchor where reasoning helps',
      formatNote:
        'Use clear sections if the output has multiple parts. End with a self-check instruction like "Before responding, verify your answer covers X, Y, Z."',
    },
    writing: {
      desc: "a writing task",
      failureModes:
        "generic voice, wrong tone, wrong length, AI writes for itself not the audience, clichéd openings, weak structure",
      mustHave:
        "exact audience definition, publication/platform context, precise word count or length range, structural blueprint, voice guidance with a concrete example sentence showing the style, explicit list of what NOT to do",
      formatNote:
        'Include: "Do not start with [X]", "Avoid clichés like [Y]", "The ideal opening sentence does [Z]". Give the AI a negative example so it knows what to dodge.',
    },
    coding: {
      desc: "a coding / technical task",
      failureModes:
        "wrong language version, missing error handling, no edge cases, unexplained code, insecure patterns, untested assumptions",
      mustHave:
        "language + exact version, runtime/environment, input/output spec with concrete examples, edge cases to handle explicitly, error handling requirements, whether to include comments/docs, performance constraints if any",
      formatNote:
        "Use this structure in the prompt: (1) Problem statement with example input/output, (2) Constraints and requirements, (3) What the response must include — code + explanation + test cases.",
    },
    business: {
      desc: "a business task",
      failureModes:
        "generic advice that ignores company context, no actionability, missing numbers/metrics, outputs that sound smart but change nothing",
      mustHave:
        'company stage/size/industry context, specific metrics or KPIs involved, decision-maker audience, time constraints, what "done" looks like (a deck? a memo? a decision?), what constraints exist (budget, team size, time)',
      formatNote:
        'Prompt should ask for: executive summary first, then supporting detail. Include "List specific, implementable next steps with owners and deadlines."',
    },
    image: {
      desc: "an AI image generation task (Midjourney, DALL-E, Stable Diffusion, Flux)",
      failureModes:
        "muddy composition, wrong mood, inconsistent style, AI guesses lighting and fails, no negative prompts so unwanted elements appear",
      mustHave:
        'subject + action + setting, art style (be specific: "oil painting in the style of Edward Hopper" not "painterly"), lighting setup, colour palette (name specific colours or reference a mood like "golden hour warmth"), camera angle/composition, mood/atmosphere, aspect ratio, negative prompts to exclude',
      formatNote:
        "For Midjourney: format as a comma-separated visual description ending with --ar 16:9 --style raw --v 6. For DALL-E: write as a flowing descriptive paragraph. Specify which tool the prompt targets.",
    },
    marketing: {
      desc: "a marketing task",
      failureModes:
        "copy that sounds like every other brand, no hook, wrong channel format, missing CTA, ignores the target customer's actual pain points",
      mustHave:
        "target customer with specific demographics AND psychographics (what keeps them up at night?), channel (Instagram caption vs Google Ad vs email subject line are completely different), brand voice with 3 adjectives, the ONE thing the customer should feel/do after reading, word/character limits if applicable, what competitors do that we must NOT sound like",
      formatNote:
        'For copy tasks: ask for 3 variations so the user can pick. Include "Write a version that leads with the pain, one that leads with the benefit, one that leads with social proof."',
    },
    education: {
      desc: "an education or learning task",
      failureModes:
        "explanation pitched at wrong level, too abstract, no analogies, no checks for understanding, info dumping without structure",
      mustHave:
        "learner's exact knowledge level (what do they already know?), learning objective (what should they be able to DO after?), preferred explanation style (analogy-heavy? step-by-step? example-first?), whether to include practice questions, any known misconceptions to proactively address",
      formatNote:
        "Structure the prompt to produce: (1) Core concept in one sentence, (2) Analogy or real-world example, (3) Detailed explanation, (4) Common mistakes to avoid, (5) 2-3 practice questions with answers.",
    },
    research: {
      desc: "a research or analysis task",
      failureModes:
        "surface-level summaries, confident hallucinations, no citation awareness, missing counterarguments, conclusions not grounded in evidence",
      mustHave:
        'research question stated precisely, scope (time range, geography, domain), required depth (overview vs deep analysis), format for citing uncertainty ("If you are not certain, say so explicitly"), whether counterarguments are needed, output format (report? bullet points? executive brief?)',
      formatNote:
        'Always include: "Flag any claims you are less than 90% confident about with [UNCERTAIN]." and "Present the strongest counterargument to your main conclusion."',
    },
  };

  const toneInstruction = {
    professional:
      "Write in a formal, authoritative register. Sentences are complete and precise. No slang, no contractions in formal sections. The reader is a professional making a real decision.",
    casual:
      "Write as a brilliant, knowledgeable friend — warm, direct, no corporate stiffness. Use contractions, be conversational, but never sacrifice accuracy for friendliness.",
    persuasive:
      "Every sentence should move the reader toward a decision or action. Lead with what they care about, not what you want to say. Build momentum. Make saying yes feel obvious.",
    technical:
      "Be exact. Use correct domain terminology without over-explaining it to experts. Prioritise precision over readability. Include specifics — versions, parameters, thresholds.",
    creative:
      "Prioritise originality and surprise. Avoid the first idea — it's probably a cliché. Use vivid, concrete sensory language. The unexpected detail beats the expected one every time.",
    concise:
      "Every word must earn its place. Cut adjectives. Cut throat-clearing. Cut hedging. State the thing directly. If a sentence can be shorter, it must be shorter.",
  };

  const pb = catPlaybook[selectedCat] || catPlaybook.general;
  const toneInst =
    toneInstruction[selectedTone] || toneInstruction.professional;

  const sys = `You are a prompt engineer with 5+ years of hands-on experience building prompts for production AI systems across dozens of industries. You have personally written thousands of prompts, studied what makes them fail, iterated obsessively, and developed strong opinions about what actually works vs what sounds good in theory.

You are not building prompts from a template. You are diagnosing what the user actually needs, identifying the specific ways a naive prompt would fail for this request, and engineering around those failure modes precisely.

THE USER'S REQUEST IS: ${pb.desc}

KNOWN FAILURE MODES FOR THIS TYPE: ${pb.failureModes}

WHAT THIS PROMPT MUST CONTAIN: ${pb.mustHave}

FORMAT STRATEGY: ${pb.formatNote}

TONE INSTRUCTION (apply throughout the generated prompt): ${toneInst}

YOUR PROCESS — think through this before writing:
1. What is the user ACTUALLY trying to accomplish? (Look past their words to their real goal)
2. What would a naive AI do wrong with a vague version of this request?
3. What context is the AI missing that would cause it to guess wrong?
4. What does "done well" look like for this task — what are the specific quality signals?
5. What should the AI explicitly NOT do?

Now write the prompt.

HARD RULES:
- Output ONLY the finished, ready-to-paste prompt. No preamble. No "Here is your prompt:". No markdown fences around it.
- The prompt opens directly with a specific role/persona for the AI — make it precise and contextually appropriate, not generic.
- Every instruction must be actionable and unambiguous. Remove any instruction the AI could interpret more than one way.
- No vague quality words: never write "high quality", "comprehensive", "detailed" without defining what that means in concrete terms.
- The user pastes this with zero edits and gets an excellent result. If they'd need to fill in a blank or guess at anything, you've failed.
- Length calibration: short focused tasks = 150-250 words. Medium complexity = 250-450 words. Deep/multi-part tasks = 450-650 words. Never pad. Never truncate important constraints.
- After the complete prompt, leave exactly two blank lines, then write: TIP: followed by one specific, non-obvious tip (under 20 words) that meaningfully improves results when using this prompt.`;

  // ── GEMINI API KEY — paste yours here ──────────────────────────────
  // Get a FREE key at: aistudio.google.com → Get API Key
  const GEMINI_KEY = "AIzaSyCYiAFeTN6zh2lg3hJzXAAADGuCaNDbqKQ";

  // Build the full prompt by combining system + user message
  // Gemini Flash doesn't use a separate system role — we combine them
  const fullUserMessage = `${sys}

---

USER GOAL: "${goal}"

Think through the 5-step process silently, then output ONLY the final prompt. Nothing before it, nothing after it except the TIP line.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: fullUserMessage }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1800,
            topP: 0.95,
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_NONE",
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_NONE",
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_NONE",
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_NONE",
            },
          ],
        }),
      },
    );

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data.error?.message || "API error " + res.status;
      throw new Error(errMsg);
    }

    // Extract text from Gemini response
    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!txt) throw new Error("No response received. Try again.");

    const tipMatch =
      txt.match(/\n\nTIP:\s*(.+)/i) || txt.match(/\nTIP:\s*(.+)/i);
    if (tipMatch) {
      fullPromptText = txt.substring(0, txt.indexOf(tipMatch[0])).trim();
      document.getElementById("tipText").textContent = tipMatch[1].trim();
      tipBox.style.display = "block";
    } else {
      fullPromptText = txt.trim();
    }
    outputEl.textContent = fullPromptText;

    const newUsage = incrementUsage();
    updateUsageUI();

    // Log to Supabase (fire and forget — don't await, don't block UX)
    sbInsert("events", {
      type: "generation",
      user_id: currentUser?.id || null,
      email: currentUser?.email || null,
      category: selectedCat,
      tone: selectedTone,
    });

    if (newUsage.count >= FREE_LIMIT) {
      setTimeout(() => showGate(newUsage.resetAt), 1600);
    }
  } catch (err) {
    outputCard.classList.remove("visible");
    showToast("Something went wrong: " + err.message, "error");
  }

  btn.disabled = false;
  btn.innerHTML = "Build My Prompt ⚡";
}

// ─── GATE + TIMER ──────────────────────────────────────────────────
function showGate(resetAt) {
  document.getElementById("gateOverlay").classList.add("active");
  if (resetAt) startTimer(resetAt);
}
function closeGate() {
  document.getElementById("gateOverlay").classList.remove("active");
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}
function startTimer(resetAt) {
  if (timerInterval) clearInterval(timerInterval);
  const tick = () => {
    const diff = Math.max(0, resetAt - Date.now());
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    document.getElementById("timerDisplay").textContent =
      pad(h) + ":" + pad(m) + ":" + pad(s);
    if (diff <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      closeGate();
      updateUsageUI();
      showToast("You're back! Prompts reset. ⚡", "success");
    }
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}
const pad = (n) => String(n).padStart(2, "0");

// ─── WAITLIST ──────────────────────────────────────────────────────
function showWaitlist() {
  document.getElementById("waitlistFormView").style.display = "";
  document.getElementById("waitlistSuccess").style.display = "none";
  document.getElementById("wlError").style.display = "none";
  if (currentUser)
    document.getElementById("wlEmail").value = currentUser.email || "";
  document.getElementById("waitlistOverlay").classList.add("active");
}
function closeWaitlist() {
  document.getElementById("waitlistOverlay").classList.remove("active");
}
async function joinWaitlist() {
  const email = document
    .getElementById("wlEmail")
    .value.trim()
    .toLowerCase();
  const whatsapp = document.getElementById("wlWhatsapp").value.trim();
  const err = document.getElementById("wlError");
  const btn = document.getElementById("wlBtn");
  err.style.display = "none";

  if (!email || !whatsapp) {
    showErr(err, "Fill in both fields.");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showErr(err, "That doesn't look like a valid email.");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Joining...';

  try {
    await sbUpsert(
      "waitlist",
      {
        email,
        whatsapp,
        user_id: currentUser?.id || null,
      },
      "email",
    );

    sbInsert("events", {
      type: "waitlist",
      email,
      user_id: currentUser?.id || null,
    });
  } catch (e) {
    /* silent fail — still show success */
  }

  btn.disabled = false;
  btn.innerHTML = "Count Me In 🎯";
  document.getElementById("waitlistFormView").style.display = "none";
  document.getElementById("waitlistSuccess").style.display = "block";
}

// ─── COPY ──────────────────────────────────────────────────────────
function copyPrompt() {
  const text =
    fullPromptText ||
    document.getElementById("promptOutput").innerText ||
    "";
  if (!text || text.includes("On it")) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(showCopied)
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (e) {}
  document.body.removeChild(ta);
  if (ok) showCopied();
  else showToast("Long-press the text above to copy manually.", "error");
}
function showCopied() {
  const btn = document.getElementById("copyBtn");
  btn.classList.add("copied");
  btn.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
  showToast("Copied ✓", "success");
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy';
  }, 2500);
}

// ─── HELPERS ───────────────────────────────────────────────────────
function showErr(el, msg) {
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}
function showToast(msg, type) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + (type || "");
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}
