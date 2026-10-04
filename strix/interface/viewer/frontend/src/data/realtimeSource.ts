import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionState,
  RealtimeTelemetry,
  TransportMode,
} from "@/types/control-center";
import {
  fetchAll,
  fetchRunSummary,
  fetchTranscript,
  fetchVulnerabilities,
  type LoadedRun,
  type Transcript,
  type TranscriptEvent,
} from "@/data/serverSource";
import type { Vulnerability } from "@/types/issues";

export interface RealtimeStreamOptions {
  activeRun: string | null;
  baseIntervalMs?: number;
  maxBufferEvents?: number;
  transport?: TransportMode;
}

export interface RealtimeStreamResult {
  run: LoadedRun | null;
  error: string | null;
  telemetry: RealtimeTelemetry;
  isPaused: boolean;
  bufferedCountWhilePaused: number;
  pauseFeed: () => void;
  resumeFeed: () => void;
  viewQueuedEvents: () => void;
  triggerSync: () => Promise<void>;
  resetBuffer: () => void;
}

const DEFAULT_BASE_INTERVAL_MS = 500;
const DEFAULT_MAX_BUFFER_EVENTS = 2500;
const MAX_BACKOFF_MS = 10000;
const MAX_RECONNECT_ATTEMPTS = 15;

/**
 * Realtime Event Deduplicator and Monotonic Sequencer.
 * Protects against duplicated events, replay loops, and out-of-order deliveries.
 */
export class EventStreamDeduplicator {
  private seenIds = new Set<string>();
  private deduplicatedCount = 0;
  private maxBuffer: number;

  constructor(maxBuffer = DEFAULT_MAX_BUFFER_EVENTS) {
    this.maxBuffer = maxBuffer;
  }

  public reset(): void {
    this.seenIds.clear();
    this.deduplicatedCount = 0;
  }

  public processEvents(
    existingEvents: TranscriptEvent[],
    incomingEvents: TranscriptEvent[]
  ): {
    merged: TranscriptEvent[];
    newCount: number;
    dedupCount: number;
  } {
    let newEventsFound = 0;
    const novelEvents: TranscriptEvent[] = [];

    for (const ev of incomingEvents) {
      if (!ev || !ev.id) continue;
      if (this.seenIds.has(ev.id)) {
        this.deduplicatedCount++;
        continue;
      }
      this.seenIds.add(ev.id);
      novelEvents.push(ev);
      newEventsFound++;
    }

    if (novelEvents.length === 0 && existingEvents.length > 0) {
      return {
        merged: existingEvents,
        newCount: 0,
        dedupCount: this.deduplicatedCount,
      };
    }

    // Merge and sort monotonically by timestamp and version
    const combined = [...existingEvents, ...novelEvents];
    combined.sort((a, b) => {
      const timeDiff =
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (timeDiff !== 0) return timeDiff;
      return (a.version || 0) - (b.version || 0);
    });

    // Enforce memory buffer cap (sliding window) to prevent memory leaks during deep scans
    const bounded =
      combined.length > this.maxBuffer
        ? combined.slice(combined.length - this.maxBuffer)
        : combined;

    return {
      merged: bounded,
      newCount: newEventsFound,
      dedupCount: this.deduplicatedCount,
    };
  }

  public getDeduplicatedCount(): number {
    return this.deduplicatedCount;
  }
}

/**
 * React Hook managing the Realtime Connection Lifecycle and Adaptive Polling/Streaming.
 */
export function useRealtimeStream({
  activeRun,
  baseIntervalMs = DEFAULT_BASE_INTERVAL_MS,
  maxBufferEvents = DEFAULT_MAX_BUFFER_EVENTS,
  transport = "realtime",
}: RealtimeStreamOptions): RealtimeStreamResult {
  const [run, setRun] = useState<LoadedRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("CONNECTING");
  const [transportMode, setTransportMode] = useState<TransportMode>(transport);
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [bufferedCountWhilePaused, setBufferedCountWhilePaused] =
    useState<number>(0);

  // Telemetry metrics
  const totalEventsRef = useRef<number>(0);
  const deduplicatedCountRef = useRef<number>(0);
  const recentEventTimestamps = useRef<number[]>([]);
  const [eventsPerSec, setEventsPerSec] = useState<number>(0);

  // Deduplicator instance
  const dedupRef = useRef(new EventStreamDeduplicator(maxBufferEvents));
  const finishedRef = useRef<boolean>(false);
  const pausedSnapshotEventsRef = useRef<TranscriptEvent[] | null>(null);
  const latestAllEventsRef = useRef<TranscriptEvent[]>([]);

  // Keep deduplicator updated if maxBuffer changes
  useEffect(() => {
    dedupRef.current = new EventStreamDeduplicator(maxBufferEvents);
  }, [maxBufferEvents]);

  // Reset deduplicator when activeRun changes
  useEffect(() => {
    dedupRef.current.reset();
    finishedRef.current = false;
    pausedSnapshotEventsRef.current = null;
    latestAllEventsRef.current = [];
    setBufferedCountWhilePaused(0);
    setConnectionState("CONNECTING");
    setError(null);
  }, [activeRun]);

  // Rolling calculation of events per second
  const recordEventArrivals = (count: number) => {
    if (count <= 0) return;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      recentEventTimestamps.current.push(now);
    }
    // Retain timestamps from last 5 seconds
    const cutoff = now - 5000;
    recentEventTimestamps.current = recentEventTimestamps.current.filter(
      (t) => t > cutoff
    );
    const rate = recentEventTimestamps.current.length / 5;
    setEventsPerSec(Number(rate.toFixed(1)));
  };

  const pauseFeed = useCallback(() => {
    setIsPaused(true);
    if (run) {
      pausedSnapshotEventsRef.current = [...run.transcript.events];
    }
  }, [run]);

  const resumeFeed = useCallback(() => {
    setIsPaused(false);
    pausedSnapshotEventsRef.current = null;
    setBufferedCountWhilePaused(0);
    if (latestAllEventsRef.current.length > 0) {
      setRun((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          transcript: {
            ...prev.transcript,
            events: [...latestAllEventsRef.current],
          },
        };
      });
    }
  }, []);

  const viewQueuedEvents = useCallback(() => {
    if (latestAllEventsRef.current.length > 0) {
      pausedSnapshotEventsRef.current = [...latestAllEventsRef.current];
      setBufferedCountWhilePaused(0);
      setRun((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          transcript: {
            ...prev.transcript,
            events: [...latestAllEventsRef.current],
          },
        };
      });
    }
  }, []);

  const resetBuffer = useCallback(() => {
    dedupRef.current.reset();
    setRun((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        transcript: {
          ...prev.transcript,
          events: [],
        },
      };
    });
  }, []);

  // Primary tick function
  const executeTick = useCallback(async () => {
    try {
      const { summary, raw, finished } = await fetchRunSummary(activeRun);

      // Handle terminal finished state
      if (finished && !finishedRef.current) {
        finishedRef.current = true;
        const full = await fetchAll(activeRun);
        setRun(full);
        setConnectionState("CONNECTED");
        setLastHeartbeat(new Date().toISOString());
        setReconnectAttempts(0);
        setError(null);
        return;
      }

      // Fetch live transcript and vulnerabilities in parallel
      const [rawTranscript, vulnerabilities] = await Promise.all([
        fetchTranscript(activeRun).catch(
          () => ({ agents: [], events: [] }) as Transcript
        ),
        fetchVulnerabilities(summary.runId, activeRun).catch(
          () => [] as Vulnerability[]
        ),
      ]);

      const nowIso = new Date().toISOString();
      setLastHeartbeat(nowIso);
      setConnectionState("CONNECTED");
      setReconnectAttempts(0);
      setError(null);

      setRun((prev) => {
        const existingEvents = prev?.transcript.events || [];
        const { merged, newCount, dedupCount } =
          dedupRef.current.processEvents(existingEvents, rawTranscript.events);

        deduplicatedCountRef.current = dedupCount;
        totalEventsRef.current = merged.length;
        latestAllEventsRef.current = merged;
        recordEventArrivals(newCount);

        if (isPaused) {
          setBufferedCountWhilePaused((c) => c + newCount);
        }

        const eventsToDisplay = isPaused
          ? pausedSnapshotEventsRef.current || merged
          : merged;

        return {
          summary,
          raw,
          finished,
          vulnerabilities,
          reportMarkdown: prev?.reportMarkdown ?? null,
          transcript: {
            agents: rawTranscript.agents,
            events: eventsToDisplay,
          },
        };
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setError(msg);
      setReconnectAttempts((prev) => {
        const next = prev + 1;
        if (next > MAX_RECONNECT_ATTEMPTS) {
          setConnectionState("ERROR");
        } else {
          setConnectionState("RECONNECTING");
        }
        return next;
      });
    }
  }, [activeRun, isPaused]);

  // Main polling / stream lifecycle effect with exponential backoff & visibility optimization
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const computeDelay = (attempts: number): number => {
      if (attempts === 0) {
        // When document is hidden, reduce frequency to save CPU/battery
        return typeof document !== "undefined" && document.hidden
          ? baseIntervalMs * 4
          : baseIntervalMs;
      }
      // Exponential backoff with jitter on error
      const exp = Math.min(
        MAX_BACKOFF_MS,
        baseIntervalMs * Math.pow(1.5, Math.min(attempts, 8))
      );
      const jitter = Math.random() * 200;
      return Math.floor(exp + jitter);
    };

    const runLoop = async () => {
      if (cancelled) return;
      if (finishedRef.current) return;

      await executeTick();

      if (!cancelled && !finishedRef.current) {
        const delay = computeDelay(reconnectAttempts);
        timer = setTimeout(runLoop, delay);
      }
    };

    // Initial full load
    (async () => {
      try {
        setConnectionState("CONNECTING");
        const full = await fetchAll(activeRun);
        if (cancelled) return;
        setRun(full);
        setConnectionState("CONNECTED");
        setLastHeartbeat(new Date().toISOString());

        if (full.finished) {
          finishedRef.current = true;
        } else {
          const delay = computeDelay(0);
          timer = setTimeout(runLoop, delay);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Initial load failed";
        setError(msg);
        setConnectionState("ERROR");
      }
    })();

    // Visibility change handler: resume promptly when tab is foregrounded
    const handleVisibilityChange = () => {
      if (!document.hidden && !finishedRef.current) {
        if (timer) clearTimeout(timer);
        void executeTick().then(() => {
          if (!cancelled && !finishedRef.current) {
            timer = setTimeout(runLoop, computeDelay(reconnectAttempts));
          }
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeRun, baseIntervalMs, executeTick, reconnectAttempts]);

  const errorCount = (run?.transcript.events || []).filter((ev) => {
    const d = (ev.data as Record<string, unknown>) || {};
    return (
      d.error != null ||
      d.is_error === true ||
      d.status === "failed" ||
      d.status === "error" ||
      d.event_type === "error" ||
      (ev as unknown as { type: string }).type === "error"
    );
  }).length;

  const telemetry: RealtimeTelemetry = {
    connectionState,
    transportMode,
    reconnectAttempts,
    lastHeartbeat,
    totalEventsReceived: totalEventsRef.current,
    deduplicatedCount: deduplicatedCountRef.current,
    eventsPerSecond: eventsPerSec,
    bufferSize: run?.transcript.events.length || 0,
    isPaused,
    errorCount,
  };

  return {
    run,
    error,
    telemetry,
    isPaused,
    bufferedCountWhilePaused,
    pauseFeed,
    resumeFeed,
    viewQueuedEvents,
    triggerSync: executeTick,
    resetBuffer,
  };
}
