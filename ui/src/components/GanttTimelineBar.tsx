import React, { useMemo, useState } from 'react';
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
          label: `${ev.sat_name.split('·')[0].trim()} → ${ev.target_name}`,
          kind: ev.kind,
          color: ev.kind === 'target_imaging' ? '#f97316' : '#34d399',
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
    <div className="h-52 bg-slate-900 border-t border-slate-800 flex flex-col select-none">
      {/* Top Scrubber & Controls Header */}
      <div className="px-3 py-1.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sky-400">⏱ STK Timeline & Access Gantt</span>
          <div className="flex bg-slate-900 border border-slate-800 rounded-md p-0.5">
            <button
              onClick={() => setTab('gantt')}
              className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition ${
                tab === 'gantt'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📊 แถบเวลา Gantt ({filteredEvents.length})
            </button>
            <button
              onClick={() => setTab('table')}
              className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition ${
                tab === 'table'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📋 ตารางรายงาน Access
            </button>
          </div>

          <select
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value as typeof filterKind)}
            className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-[11px]"
          >
            <option value="all">แสดงทั้งหมด (สถานี + ถ่ายภาพ)</option>
            <option value="target_imaging">📸 เฉพาะช่วงถ่ายภาพเป้าหมาย (Imaging)</option>
            <option value="station_pass">📡 เฉพาะช่วงติดต่อสถานี (Station Pass)</option>
          </select>
        </div>

        {/* Continuous Time Scrubber Slider */}
        <div className="flex-1 flex items-center gap-2 max-w-xl">
          <span className="text-[10px] font-mono text-slate-400">
            {new Date(windowStartMs).toISOString().slice(11, 16)}
          </span>
          <input
            type="range"
            min={windowStartMs}
            max={windowEndMs}
            step={5000}
            value={Math.max(windowStartMs, Math.min(windowEndMs, simTimeMs))}
            onChange={(e) => onSeekTimeMs(Number(e.target.value))}
            className="flex-1 accent-sky-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <span className="text-[10px] font-mono text-slate-400">
            +{windowHours}h
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onRecomputeEvents}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px]"
          >
            🔄 คำนวณใหม่
          </button>
          <button
            onClick={handleCopyCsv}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px]"
          >
            {copiedCsv ? '✅ คัดลอกแล้ว!' : '📄 Export CSV'}
          </button>
        </div>
      </div>

      {/* Main Content: Gantt Bars OR Access Table */}
      {tab === 'gantt' ? (
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 relative">
          {ganttRows.length === 0 ? (
            <div className="text-slate-500 text-xs py-8 text-center">
              ไม่พบช่วงเวลาติดต่อหรือถ่ายภาพในช่วงเวลานี้ — ลองปรับมุมเอียงกล้องสูงสุด (Max Slew) หรือเพิ่มดาวเทียม
            </div>
          ) : (
            ganttRows.map((row) => (
              <div key={row.key} className="flex items-center gap-3 text-xs">
                <div className="w-56 truncate flex items-center gap-1.5 text-[11px] text-slate-300">
                  <span>{row.kind === 'target_imaging' ? '📸' : '📡'}</span>
                  <span className="truncate" title={row.label}>
                    {row.label}
                  </span>
                </div>

                {/* Timeline Track */}
                <div
                  className="relative flex-1 h-5 bg-slate-950/90 border border-slate-800/90 rounded overflow-hidden cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    onSeekTimeMs(windowStartMs + pct * totalSpanMs);
                  }}
                >
                  {/* Hour tick marks */}
                  {[0.25, 0.5, 0.75].map((f) => (
                    <div
                      key={f}
                      style={{ left: `${f * 100}%` }}
                      className="absolute inset-y-0 w-px bg-slate-800/60"
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
                        className="absolute inset-y-0.5 rounded-sm opacity-85 hover:opacity-100 hover:ring-2 hover:ring-white transition"
                        title={`${row.label} | ${new Date(ev.start_ms)
                          .toISOString()
                          .slice(11, 19)} UTC (${(ev.duration_s / 60).toFixed(1)} นาที) — คลิกเพื่อกระโดดไปดูจังหวะนี้!`}
                      />
                    );
                  })}

                  {/* Current Simulation Time Playhead Line */}
                  <div
                    style={{ left: `${playheadPct}%` }}
                    className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-400 shadow-[0_0_6px_#38bdf8]"
                  />
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800 text-[11px]">
                <th className="py-1 px-2">ประเภท</th>
                <th className="py-1 px-2">ดาวเทียม</th>
                <th className="py-1 px-2">สถานี / เป้าหมาย</th>
                <th className="py-1 px-2">เริ่ม (UTC)</th>
                <th className="py-1 px-2">สิ้นสุด (UTC)</th>
                <th className="py-1 px-2">ระยะเวลา</th>
                <th className="py-1 px-2">ค่าสำคัญ</th>
                <th className="py-1 px-2 text-right">การกระทำ</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((ev) => (
                <tr
                  key={ev.id}
                  className="border-b border-slate-800/50 hover:bg-slate-800/40 text-[11px]"
                >
                  <td className="py-1 px-2">
                    {ev.kind === 'target_imaging' ? (
                      <span className="text-orange-400 font-semibold">📸 ถ่ายภาพ</span>
                    ) : (
                      <span className="text-emerald-400 font-semibold">📡 ติดต่อสถานี</span>
                    )}
                  </td>
                  <td className="py-1 px-2 font-medium text-slate-200">{ev.sat_name}</td>
                  <td className="py-1 px-2 text-slate-300">{ev.target_name}</td>
                  <td className="py-1 px-2 font-mono text-slate-300">
                    {new Date(ev.start_ms).toISOString().slice(5, 19).replace('T', ' ')}
                  </td>
                  <td className="py-1 px-2 font-mono text-slate-300">
                    {new Date(ev.end_ms).toISOString().slice(11, 19)}
                  </td>
                  <td className="py-1 px-2 font-mono text-slate-300">
                    {(ev.duration_s / 60).toFixed(1)} นาที
                  </td>
                  <td className="py-1 px-2 text-slate-300">
                    {ev.kind === 'target_imaging'
                      ? `Off-nadir ต่ำสุด ${ev.metric_value.toFixed(1)}° (แดด ${ev.sun_el_deg?.toFixed(0)}°)`
                      : `มุมเงยสูงสุด ${ev.metric_value.toFixed(1)}°`}
                  </td>
                  <td className="py-1 px-2 text-right">
                    <button
                      onClick={() => onSeekTimeMs(ev.best_ms)}
                      className="px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500 hover:text-slate-950 text-sky-300 font-semibold transition"
                    >
                      ▶ ไปที่เวลานี้
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
