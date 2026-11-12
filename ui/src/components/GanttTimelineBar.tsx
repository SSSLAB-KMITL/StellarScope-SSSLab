import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Camera,
  Check,
  Clock,
  Download,
  Play,
  Radio,
  RefreshCw,
  Table2,
} from 'lucide-react';
import { GanttEventItem } from '../engine/orbitalEngine';

interface GanttTimelineBarProps {
  simTimeMs: number;
  windowStartMs: number;
  windowHours: number;
  onSeekTimeMs: (ms: number) => void;
  events: GanttEventItem[];
  onRecomputeEvents: () => void;
}

export const GanttTimelineBar: React.FC<GanttTimelineBarProps> = ({
  simTimeMs,
  windowStartMs,
  windowHours,
  onSeekTimeMs,
  events,
  onRecomputeEvents,
}) => {
  const [tab, setTab] = useState<'gantt' | 'table'>('gantt');
  const [filterKind, setFilterKind] = useState<'all' | 'station_pass' | 'target_imaging'>('all');
  const [copiedCsv, setCopiedCsv] = useState(false);

  const windowEndMs = windowStartMs + windowHours * 3600_000;
  const totalSpanMs = Math.max(1, windowEndMs - windowStartMs);

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => (filterKind === 'all' ? true : ev.kind === filterKind));
  }, [events, filterKind]);

  // Group events into rows by (sat_name -> target_name)
  const ganttRows = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        label: string;
        kind: 'station_pass' | 'target_imaging';
        color: string;
        items: GanttEventItem[];
      }
    >();
    for (const ev of filteredEvents) {
      const key = `${ev.sat_id}::${ev.kind}::${ev.target_id}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: `${ev.sat_name.split('·')[0].trim()} to ${ev.target_name}`,
          kind: ev.kind,
          color: ev.kind === 'target_imaging' ? '#d97706' : '#059669',
          items: [],
        });
      }
      map.get(key)!.items.push(ev);
    }
    return Array.from(map.values());
  }, [filteredEvents]);

  const playheadPct = Math.max(
    0,
    Math.min(100, ((simTimeMs - windowStartMs) / totalSpanMs) * 100)
  );

  const handleCopyCsv = () => {
    const header = 'type,satellite,target,start_utc,end_utc,best_utc,duration_s,metric_deg\n';
    const rows = filteredEvents
      .map(
        (e) =>
          `${e.kind},"${e.sat_name}","${e.target_name}",${new Date(e.start_ms).toISOString()},${new Date(
            e.end_ms
          ).toISOString()},${new Date(e.best_ms).toISOString()},${e.duration_s.toFixed(
            0
          )},${e.metric_value.toFixed(1)}`
      )
      .join('\n');
    navigator.clipboard?.writeText(header + rows);
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 1800);
  };

  return (
    <section
      aria-label="Mission Timeline and Access Report"
      className="h-52 bg-[var(--color-surface)] border-t border-[var(--color-rule)] flex flex-col select-none shrink-0"
    >
      {/* Top Scrubber & Controls Header */}
      <div className="px-4 py-2 bg-[var(--color-paper)] border-b border-[var(--color-rule)] flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-display font-semibold text-[var(--color-ink)]">
            <Clock className="w-3.5 h-3.5 text-[var(--color-accent)]" />
            <span>Mission Timeline & Access</span>
          </div>

          <div className="flex bg-[var(--color-surface-muted)] border border-[var(--color-rule)] rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setTab('gantt')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                tab === 'gantt'
                  ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm border border-[var(--color-rule)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Gantt ({filteredEvents.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('table')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                tab === 'table'
                  ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm border border-[var(--color-rule)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Access Table</span>
            </button>
          </div>

          <select
            aria-label="Filter timeline events"
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value as typeof filterKind)}
            className="bg-[var(--color-surface)] border border-[var(--color-rule)] text-[var(--color-ink)] rounded-lg px-2.5 py-1 text-xs"
          >
            <option value="all">All events (Stations + Imaging)</option>
            <option value="target_imaging">Target imaging windows</option>
            <option value="station_pass">Ground station passes</option>
          </select>
        </div>

        {/* Continuous Time Scrubber Slider */}
        <div className="flex-1 flex items-center gap-2.5 max-w-xl">
          <span className="text-xs font-mono-num text-[var(--color-muted)]">
            {new Date(windowStartMs).toISOString().slice(11, 16)}
          </span>
          <input
            aria-label="Simulation timeline scrubber"
            type="range"
            min={windowStartMs}
            max={windowEndMs}
            step={5000}
            value={Math.max(windowStartMs, Math.min(windowEndMs, simTimeMs))}
            onChange={(e) => onSeekTimeMs(Number(e.target.value))}
            className="flex-1 h-1.5 bg-[var(--color-paper-3)] rounded-lg cursor-pointer"
          />
          <span className="text-xs font-mono-num text-[var(--color-muted)]">
            +{windowHours}h
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRecomputeEvents}
            className="px-2.5 py-1 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-paper-2)] text-[var(--color-ink)] border border-[var(--color-rule)] text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[var(--color-muted)]" />
            <span>Recompute</span>
          </button>
          <button
            type="button"
            onClick={handleCopyCsv}
            className="px-2.5 py-1 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-paper-2)] text-[var(--color-ink)] border border-[var(--color-rule)] text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            {copiedCsv ? (
              <>
                <Check className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                <span className="text-[var(--color-accent)]">Copied CSV</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-[var(--color-muted)]" />
                <span>Export CSV</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Content: Gantt Bars OR Access Table */}
      {tab === 'gantt' ? (
        <div className="flex-1 overflow-y-auto px-4 py-2.5 space-y-2 relative">
          {ganttRows.length === 0 ? (
            <div className="text-[var(--color-muted)] text-xs py-8 text-center">
              No station passes or imaging windows found in this 24-hour window. Increase Max Off-Nadir Slew or add a satellite.
            </div>
          ) : (
            ganttRows.map((row) => (
              <div key={row.key} className="flex items-center gap-3 text-xs">
                <div className="w-56 truncate flex items-center gap-2 text-xs text-[var(--color-ink-2)] font-medium">
                  {row.kind === 'target_imaging' ? (
                    <Camera className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                  ) : (
                    <Radio className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                  )}
                  <span className="truncate" title={row.label}>
                    {row.label}
                  </span>
                </div>

                {/* Timeline Track */}
                <div
                  className="relative flex-1 h-5 bg-[var(--color-surface-muted)] border border-[var(--color-rule)] rounded-md overflow-hidden cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    onSeekTimeMs(windowStartMs + pct * totalSpanMs);
                  }}
                >
                  {/* Quarter-window tick marks */}
                  {[0.25, 0.5, 0.75].map((f) => (
                    <div
                      key={f}
                      style={{ left: `${f * 100}%` }}
                      className="absolute inset-y-0 w-px bg-[var(--color-rule)]"
                    />
                  ))}

                  {/* Event Access Bars */}
                  {row.items.map((ev) => {
                    const leftPct = Math.max(
                      0,
                      ((ev.start_ms - windowStartMs) / totalSpanMs) * 100
                    );
                    const widthPct = Math.max(
                      0.55,
                      ((ev.end_ms - ev.start_ms) / totalSpanMs) * 100
                    );
                    return (
                      <button
                        type="button"
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeekTimeMs(ev.best_ms);
                        }}
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          backgroundColor: row.color,
                        }}
                        className="absolute inset-y-0.5 rounded-sm opacity-90 hover:opacity-100 hover:ring-2 hover:ring-[var(--color-ink)] transition-opacity"
                        title={`${row.label} | ${new Date(ev.start_ms)
                          .toISOString()
                          .slice(11, 19)} UTC (${(ev.duration_s / 60).toFixed(1)} min) — Click to jump`}
                      />
                    );
                  })}

                  {/* Current Simulation Time Playhead Line */}
                  <div
                    style={{ left: `${playheadPct}%` }}
                    className="pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--color-accent)]"
                  />
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-1.5">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-[var(--color-muted)] border-b border-[var(--color-rule)] text-xs font-medium">
                <th className="py-1.5 px-2 font-medium">Type</th>
                <th className="py-1.5 px-2 font-medium">Satellite</th>
                <th className="py-1.5 px-2 font-medium">Station / Target</th>
                <th className="py-1.5 px-2 font-medium">Start (UTC)</th>
                <th className="py-1.5 px-2 font-medium">End (UTC)</th>
                <th className="py-1.5 px-2 font-medium">Duration</th>
                <th className="py-1.5 px-2 font-medium">Key Metric</th>
                <th className="py-1.5 px-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((ev) => (
                <tr
                  key={ev.id}
                  className="border-b border-[var(--color-rule)]/60 hover:bg-[var(--color-paper-2)] text-xs transition-colors"
                >
                  <td className="py-1.5 px-2">
                    {ev.kind === 'target_imaging' ? (
                      <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
                        <Camera className="w-3.5 h-3.5" />
                        <span>Imaging</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                        <Radio className="w-3.5 h-3.5" />
                        <span>Station Pass</span>
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 font-medium text-[var(--color-ink)]">{ev.sat_name}</td>
                  <td className="py-1.5 px-2 text-[var(--color-ink-2)]">{ev.target_name}</td>
                  <td className="py-1.5 px-2 font-mono-num text-[var(--color-ink-2)]">
                    {new Date(ev.start_ms).toISOString().slice(5, 19).replace('T', ' ')}
                  </td>
                  <td className="py-1.5 px-2 font-mono-num text-[var(--color-ink-2)]">
                    {new Date(ev.end_ms).toISOString().slice(11, 19)}
                  </td>
                  <td className="py-1.5 px-2 font-mono-num text-[var(--color-ink-2)]">
                    {(ev.duration_s / 60).toFixed(1)} min
                  </td>
                  <td className="py-1.5 px-2 text-[var(--color-ink-2)]">
                    {ev.kind === 'target_imaging'
                      ? `Min off-nadir ${ev.metric_value.toFixed(1)}° (Sun ${ev.sun_el_deg?.toFixed(0)}°)`
                      : `Max elevation ${ev.metric_value.toFixed(1)}°`}
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <button
                      type="button"
                      onClick={() => onSeekTimeMs(ev.best_ms)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-ink)] text-[var(--color-accent-deep)] font-medium transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      <span>Jump</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
