import { useState, useEffect } from "react";
import {
  Settings,
  Palette,
  Cpu,
  Radio,
  Zap,
  Bell,
  Activity,
  ShieldCheck,
  RotateCcw,
  Check,
  AlertCircle,
} from "lucide-react";
import type { LoadedRun } from "@/data/serverSource";

interface SettingsViewProps {
  run: LoadedRun | null;
  pollInterval?: number;
  onUpdatePollInterval?: (interval: number) => void;
}

export function SettingsView({ run, pollInterval = 1000, onUpdatePollInterval }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<
    "appearance" | "runtime" | "connection" | "performance" | "notifications" | "diagnostics"
  >("appearance");

  // Local persisted settings state
  const [compactMode, setCompactMode] = useState<boolean>(() => {
    return localStorage.getItem("strix_ui_compact") === "true";
  });
  const [accentColor, setAccentColor] = useState<string>(() => {
    return localStorage.getItem("strix_ui_accent") || "indigo";
  });
  const [currentPoll, setCurrentPoll] = useState<number>(pollInterval);
  const [maxEventsInMemory, setMaxEventsInMemory] = useState<number>(() => {
    return parseInt(localStorage.getItem("strix_ui_max_events") || "2000", 10);
  });
  const [soundAlerts, setSoundAlerts] = useState<boolean>(() => {
    return localStorage.getItem("strix_ui_sound") === "true";
  });
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Sync to localStorage
  const handleSave = () => {
    localStorage.setItem("strix_ui_compact", String(compactMode));
    localStorage.setItem("strix_ui_accent", accentColor);
    localStorage.setItem("strix_ui_max_events", String(maxEventsInMemory));
    localStorage.setItem("strix_ui_sound", String(soundAlerts));
    if (onUpdatePollInterval) {
      onUpdatePollInterval(currentPoll);
    }
    setSaveStatus("Settings saved successfully");
    setTimeout(() => setSaveStatus(null), 2000);
  };

  const handleResetDefaults = () => {
    localStorage.removeItem("strix_ui_compact");
    localStorage.removeItem("strix_ui_accent");
    localStorage.removeItem("strix_ui_max_events");
    localStorage.removeItem("strix_ui_sound");
    setCompactMode(false);
    setAccentColor("indigo");
    setCurrentPoll(1000);
    setMaxEventsInMemory(2000);
    setSoundAlerts(false);
    if (onUpdatePollInterval) {
      onUpdatePollInterval(1000);
    }
    setSaveStatus("Reset to defaults");
    setTimeout(() => setSaveStatus(null), 2000);
  };

  useEffect(() => {
    setCurrentPoll(pollInterval);
  }, [pollInterval]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Top Header */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-indigo-400" />
          <h2 className="text-base font-semibold tracking-tight text-zinc-100">Control Center Settings</h2>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus && (
            <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> {saveStatus}
            </span>
          )}
          <button
            onClick={handleResetDefaults}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-800 rounded border border-zinc-700 transition-colors"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded border border-indigo-500 transition-colors shadow-sm"
          >
            Save Changes
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Settings Navigation Sub-Sidebar */}
        <div className="w-52 border-r border-zinc-800 bg-zinc-900/30 p-2 space-y-1">
          {[
            { id: "appearance", label: "Appearance", icon: Palette },
            { id: "runtime", label: "Runtime & Model", icon: Cpu },
            { id: "connection", label: "Connection & Polling", icon: Radio },
            { id: "performance", label: "Performance", icon: Zap },
            { id: "notifications", label: "Notifications", icon: Bell },
            { id: "diagnostics", label: "Diagnostics & System", icon: Activity },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                  isActive
                    ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 font-semibold"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}

          {/* Security Assurance Box */}
          <div className="mt-8 p-3 bg-zinc-900/60 border border-zinc-800 rounded-lg">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 mb-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Safe Secrets Policy
            </div>
            <p className="text-[10px] text-zinc-400 leading-normal">
              STRIX NEVER exposes or stores sensitive API keys in the browser. Credentials reside securely in system
              environment variables on the host.
            </p>
          </div>
        </div>

        {/* Settings Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "appearance" && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Visual Theme & Aesthetics</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Customize the appearance of the Strix Control Center.</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <div>
                    <label className="text-xs font-medium text-zinc-200 block">Dark Mode Aesthetic</label>
                    <span className="text-[11px] text-zinc-400">Professional cyber-security dark theme (default).</span>
                  </div>
                  <span className="px-2.5 py-1 text-xs font-mono font-medium bg-zinc-800 border border-zinc-700 rounded text-zinc-300">
                    Always Dark
                  </span>
                </div>

                <div className="flex items-center justify-between p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <div>
                    <label className="text-xs font-medium text-zinc-200 block">Compact Layout Mode</label>
                    <span className="text-[11px] text-zinc-400">Reduce padding and spacing for high-density displays.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={compactMode}
                    onChange={(e) => setCompactMode(e.target.checked)}
                    className="w-4 h-4 rounded bg-zinc-950 border-zinc-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <div>
                    <label className="text-xs font-medium text-zinc-200 block">Accent Accent Tint</label>
                    <span className="text-[11px] text-zinc-400">Primary UI highlight color.</span>
                  </div>
                  <select
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 rounded px-2.5 py-1 focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    <option value="indigo">Indigo (Standard)</option>
                    <option value="emerald">Emerald (Tactical)</option>
                    <option value="violet">Violet (Modern)</option>
                    <option value="amber">Amber (Security Warning)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === "runtime" && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Runtime & Model Configuration</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Parameters driving the active autonomous pentest engine.</p>
              </div>

              <div className="space-y-4">
                <div className="p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-200">Active LLM Model Architecture</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      Host Configured
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Model is selected via the <code className="text-zinc-300 font-mono text-[11px]">STRIX_LLM</code>{" "}
                    environment variable (LiteLLM router). Current configuration uses LiteLLM fallbacks and resilient retries.
                  </p>
                </div>

                <div className="p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-200">Active Scan Mode</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700">
                      {run?.summary.scanMode || "quick"}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Modes available: <code className="text-zinc-300 font-mono">quick</code> (focused surface) or{" "}
                    <code className="text-zinc-300 font-mono">deep</code> (full recursive sub-agents).
                  </p>
                </div>

                <div className="p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-200">Agent Steering Capability</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Enabled (/api/agents/steer)
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Allows real-time human operator guidance into the coordinator agent context loop without interrupting execution.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "connection" && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Connection & Realtime Synchronization</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Control how the UI synchronizes with the Strix viewer backend.</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <div>
                    <label className="text-xs font-medium text-zinc-200 block">Telemetry Polling Interval</label>
                    <span className="text-[11px] text-zinc-400">Frequency of updates from the Strix REST API.</span>
                  </div>
                  <select
                    value={currentPoll}
                    onChange={(e) => setCurrentPoll(Number(e.target.value))}
                    className="bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 rounded px-2.5 py-1 focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    <option value={500}>500 ms (High Frequency)</option>
                    <option value={1000}>1,000 ms (Standard)</option>
                    <option value={2000}>2,000 ms (Relaxed)</option>
                    <option value={5000}>5,000 ms (Low Bandwidth)</option>
                  </select>
                </div>

                <div className="p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-200">API Endpoint Origin</span>
                    <span className="text-xs font-mono text-zinc-400">
                      {window.location.origin || "http://127.0.0.1"}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Connected locally to ephemeral Python loopback server with isolated session cookie protection.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "performance" && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Performance & Memory</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Fine-tune memory utilization and rendering overhead.</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <div>
                    <label className="text-xs font-medium text-zinc-200 block">Maximum Events In-Memory Buffer</label>
                    <span className="text-[11px] text-zinc-400">Limits browser memory consumption for long pentest runs.</span>
                  </div>
                  <select
                    value={maxEventsInMemory}
                    onChange={(e) => setMaxEventsInMemory(Number(e.target.value))}
                    className="bg-zinc-950 border border-zinc-800 text-xs text-zinc-200 rounded px-2.5 py-1 focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    <option value={1000}>1,000 events</option>
                    <option value={2000}>2,000 events (Default)</option>
                    <option value={5000}>5,000 events</option>
                    <option value={10000}>10,000 events</option>
                  </select>
                </div>

                <div className="p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between">
                  <div>
                    <label className="text-xs font-medium text-zinc-200 block">Agent Graph Physics & Animation</label>
                    <span className="text-[11px] text-zinc-400">Accelerated ReactFlow graph layout engine.</span>
                  </div>
                  <span className="text-xs font-mono text-emerald-400">Hardware Accelerated</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "notifications" && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Alerts & Notifications</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Auditory and visual notifications for critical findings.</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                  <div>
                    <label className="text-xs font-medium text-zinc-200 block">Critical Vulnerability Alerts</label>
                    <span className="text-[11px] text-zinc-400">Audio cue when Critical or High finding is discovered.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={soundAlerts}
                    onChange={(e) => setSoundAlerts(e.target.checked)}
                    className="w-4 h-4 rounded bg-zinc-950 border-zinc-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === "diagnostics" && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Diagnostics & System Status</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Information on the host environment and gate baselines.</p>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between">
                  <span className="text-zinc-400">P1-1 Windows CI Baseline:</span>
                  <span className="text-emerald-400 font-semibold">HOMOLOGATED</span>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between">
                  <span className="text-zinc-400">P1-2 Go TUI Baseline:</span>
                  <span className="text-emerald-400 font-semibold">HOMOLOGATED (Coexists with Web UI)</span>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between">
                  <span className="text-zinc-400">P2-2 LiteLLM Routing Baseline:</span>
                  <span className="text-emerald-400 font-semibold">HOMOLOGATED</span>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between">
                  <span className="text-zinc-400">Viewer Frontend Stack:</span>
                  <span className="text-zinc-200">React 19.2 + Vite 6 + Tailwind v4</span>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between">
                  <span className="text-zinc-400">Active Run Name:</span>
                  <span className="text-zinc-200">{run?.summary.runName || run?.summary.runId || "N/A"}</span>
                </div>
              </div>

              <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300 leading-relaxed font-sans">
                  The Web Control Center and the Go TUI operate concurrently over the same session artifacts and backend events. Neither replaces the other.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
