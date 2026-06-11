"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  getLarkAuthorizeUrl,
  isAuthRequired,
  useAuth,
} from "@tide/core";

/**
 * Tide login — editorial split-screen.
 *
 * Left  : dark navy hero with serif wordmark, drifting tide-lines and meta tags.
 * Right : warm off-white form panel with hairline inputs and a Lark SSO option.
 * Falls back to a single column on small viewports.
 */
function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isAuthenticated, hydrated } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = searchParams?.get("redirect") || "/";
  const oauthError = searchParams?.get("auth_error");

  // If already signed in (e.g. tokens persisted), bounce away from /auth/login.
  useEffect(() => {
    if (hydrated && isAuthenticated) {
      router.replace(redirectTo);
    }
  }, [hydrated, isAuthenticated, redirectTo, router]);

  useEffect(() => {
    if (oauthError) {
      setError(`Lark 登录失败：${oauthError}`);
    }
  }, [oauthError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password.trim()) {
      setError("请输入用户名和密码");
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      router.replace(redirectTo);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("用户名或密码错误");
      } else if (err instanceof ApiError) {
        const body = err.body as { detail?: string } | string | null;
        const detail =
          typeof body === "object" && body && "detail" in body
            ? body.detail
            : typeof body === "string"
              ? body
              : null;
        setError(detail || `登录失败 (${err.status})`);
      } else {
        setError("网络异常，请稍后重试");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0b0d14] text-white">
      {/* Page-wide grain & vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        }}
      />

      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* ─── LEFT : Hero ─────────────────────────────────────────────── */}
        <section className="relative flex flex-col justify-between overflow-hidden px-8 py-10 sm:px-14 sm:py-14 lg:px-20 lg:py-16">
          {/* Layered atmospheric gradient */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 80% at 80% 0%, rgba(99,102,241,0.35) 0%, rgba(11,13,20,0) 55%), radial-gradient(80% 70% at 0% 100%, rgba(56,189,248,0.18) 0%, rgba(11,13,20,0) 60%), linear-gradient(180deg, #0b0d14 0%, #0a0c12 60%, #07080d 100%)",
            }}
          />
          {/* Drifting tide lines */}
          <svg
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[55%] w-full opacity-[0.55]"
            viewBox="0 0 1200 600"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="tide-line" x1="0%" x2="100%">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
                <stop offset="50%" stopColor="#a5b4fc" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
              </linearGradient>
            </defs>
            {Array.from({ length: 9 }).map((_, i) => (
              <path
                key={i}
                d={`M -50 ${260 + i * 38} C 200 ${
                  220 + i * 38
                }, 500 ${300 + i * 38}, 800 ${260 + i * 38} S 1300 ${
                  220 + i * 38
                }, 1300 ${260 + i * 38}`}
                fill="none"
                stroke="url(#tide-line)"
                strokeWidth={i % 2 === 0 ? 0.7 : 0.5}
                style={{
                  animation: `tide-drift ${14 + i * 1.4}s ease-in-out ${i * 0.3}s infinite alternate`,
                  transformOrigin: "center",
                }}
              />
            ))}
          </svg>

          {/* Top meta strip */}
          <div className="relative z-10 flex items-center justify-between text-[10px] uppercase tracking-[0.34em] text-white/55">
            <div className="flex items-center gap-3">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.7)]" />
              <span>System · Online</span>
            </div>
            <span className="hidden sm:inline">Ⅰ · Agentic Ops Console</span>
          </div>

          {/* Wordmark + tagline */}
          <div className="relative z-10 mt-16 sm:mt-20">
            <p className="mb-6 text-[11px] uppercase tracking-[0.5em] text-white/45">
              Welcome back to
            </p>
            <h1
              className="font-serif italic text-[clamp(5rem,14vw,11rem)] leading-[0.85] tracking-[-0.04em]"
              style={{
                background:
                  "linear-gradient(180deg, #ffffff 0%, #c7d2fe 55%, #6366f1 110%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                textShadow: "0 0 80px rgba(99,102,241,0.25)",
              }}
            >
              tide
              <span className="not-italic align-super text-[0.18em] tracking-[0.4em] text-indigo-300/80">
                ®
              </span>
            </h1>
            <div className="mt-8 flex max-w-xl items-start gap-5">
              <span className="mt-2 h-px w-12 shrink-0 bg-white/40" />
              <p className="font-serif text-base leading-relaxed text-white/75 sm:text-lg">
                让多智能体编排像潮汐一样，<em className="italic text-indigo-200">规律、可观测、可掌控</em>。<br />
                登录以进入你的工作台。
              </p>
            </div>
          </div>

          {/* Footer index */}
          <div className="relative z-10 mt-16 grid grid-cols-3 gap-6 border-t border-white/10 pt-6 text-[10px] uppercase tracking-[0.28em] text-white/45 sm:max-w-md">
            <div>
              <div className="mb-1 text-white/30">Index 01</div>
              <div className="text-white/70">Workflow</div>
            </div>
            <div>
              <div className="mb-1 text-white/30">Index 02</div>
              <div className="text-white/70">Schedules</div>
            </div>
            <div>
              <div className="mb-1 text-white/30">Index 03</div>
              <div className="text-white/70">Kanban</div>
            </div>
          </div>
        </section>

        {/* ─── RIGHT : Form ────────────────────────────────────────────── */}
        <section className="relative flex items-center justify-center bg-[#fafaf7] px-6 py-14 text-[#0b0d14] sm:px-12 lg:px-16">
          {/* Editorial corner ticks */}
          <div aria-hidden className="pointer-events-none absolute inset-6 hidden lg:block">
            <span className="absolute left-0 top-0 h-3 w-px bg-black/30" />
            <span className="absolute left-0 top-0 h-px w-3 bg-black/30" />
            <span className="absolute right-0 top-0 h-3 w-px bg-black/30" />
            <span className="absolute right-0 top-0 h-px w-3 bg-black/30" />
            <span className="absolute bottom-0 left-0 h-3 w-px bg-black/30" />
            <span className="absolute bottom-0 left-0 h-px w-3 bg-black/30" />
            <span className="absolute bottom-0 right-0 h-3 w-px bg-black/30" />
            <span className="absolute bottom-0 right-0 h-px w-3 bg-black/30" />
          </div>

          <div className="w-full max-w-[420px]">
            {/* Header */}
            <div className="mb-10 flex items-center justify-between text-[10px] uppercase tracking-[0.34em] text-black/45">
              <span>§ Sign in</span>
              <span className="font-mono">v0.1 · 2026</span>
            </div>

            <h2 className="font-serif text-4xl leading-tight tracking-tight text-[#0b0d14]">
              进入你的<br />
              <span className="italic text-indigo-600">工作潮汐</span>。
            </h2>
            <p className="mt-3 text-sm text-black/55">
              使用本地账户登录，或通过 Lark 单点登录继续。
            </p>

            {/* Lark SSO */}
            <a
              href={getLarkAuthorizeUrl()}
              className="group mt-9 flex h-12 w-full items-center justify-between rounded-none border border-black/15 bg-white px-5 text-sm font-medium text-[#0b0d14] transition-all hover:border-black/80 hover:bg-black hover:text-white"
            >
              <span className="flex items-center gap-3">
                <LarkMark className="h-4 w-4" />
                继续使用 Lark 登录
              </span>
              <span className="font-mono text-[11px] opacity-60 transition-transform group-hover:translate-x-1">
                ↗
              </span>
            </a>

            {/* Divider */}
            <div className="my-7 flex items-center gap-3 text-[10px] uppercase tracking-[0.32em] text-black/40">
              <span className="h-px flex-1 bg-black/15" />
              <span>or with credentials</span>
              <span className="h-px flex-1 bg-black/15" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <FieldRow
                label="用户名"
                badge="01"
                name="username"
                value={username}
                onChange={setUsername}
                placeholder="admin"
                autoComplete="username"
                disabled={submitting}
              />
              <FieldRow
                label="密码"
                badge="02"
                name="password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                type="password"
                autoComplete="current-password"
                disabled={submitting}
              />

              {error && (
                <div className="border-l-2 border-rose-500 bg-rose-50/70 px-3 py-2 text-[13px] text-rose-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="group relative flex h-12 w-full items-center justify-between overflow-hidden bg-[#0b0d14] px-5 text-sm font-medium uppercase tracking-[0.24em] text-white transition-all hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{submitting ? "正在登录…" : "登 入 工 作 台"}</span>
                <span className="font-mono text-[11px] opacity-80 transition-transform group-hover:translate-x-1">
                  →
                </span>
              </button>
            </form>

            {/* Footer note */}
            <div className="mt-10 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-black/40">
              <span>Tide · Agentic Ops</span>
              <span className="font-mono">{!isAuthRequired() ? "auth · optional" : "auth · required"}</span>
            </div>
          </div>
        </section>
      </div>

      {/* Local CSS for tide drift */}
      <style>{`
        @keyframes tide-drift {
          0%   { transform: translateX(-2%) translateY(0); opacity: 0.55; }
          50%  { transform: translateX(0%)  translateY(-4px); opacity: 0.85; }
          100% { transform: translateX(2%)  translateY(2px); opacity: 0.45; }
        }
      `}</style>
    </div>
  );
}

interface FieldRowProps {
  label: string;
  badge: string;
  name?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  autoComplete?: string;
  disabled?: boolean;
}

function FieldRow({
  label,
  badge,
  name,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  disabled,
}: FieldRowProps) {
  return (
    <label className="group block">
      <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.32em] text-black/55">
        <span>{label}</span>
        <span className="font-mono text-black/35">{badge}</span>
      </div>
      <div className="relative">
        <input
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={type}
          autoComplete={autoComplete}
          disabled={disabled}
          className="block w-full border-0 border-b border-black/20 bg-transparent px-0 py-2.5 text-base text-[#0b0d14] outline-none placeholder:text-black/25 focus:border-indigo-600 disabled:opacity-60"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-px left-0 h-px w-0 bg-indigo-600 transition-all duration-300 group-focus-within:w-full"
        />
      </div>
    </label>
  );
}

function LarkMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 13c4 4 9 4 14 0" />
      <path d="M5 9c4 4 9 4 14 0" />
      <path d="M7 5c4 4 9 4 14 0" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
