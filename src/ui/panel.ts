import type { Line, Network } from '../data/types';
import { linesAtStation } from '../map/features';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const typeBadge = (line: Line) =>
  `<span class="badge badge-${line.type}">${line.type === 'night' ? '☾ Night train' : '☀ Day train'}</span>`;

const seasonalBadge = (line: Line) => (line.seasonal ? `<span class="badge badge-seasonal">Seasonal</span>` : '');

/** Group raw class names ("couchette (4-berth)", "sleeper"…) into the three families travellers care about. */
function classFamilies(classes: string[]): string[] {
  const fam = new Set<string>();
  for (const c of classes) {
    const k = c.toLowerCase();
    if (k.includes('sleep') || k.includes('capsule')) fam.add('Sleeper');
    else if (k.includes('couchette')) fam.add('Couchette');
    else if (k.includes('seat')) fam.add('Seat');
  }
  return ['Seat', 'Couchette', 'Sleeper'].filter((f) => fam.has(f));
}

export interface PanelHandlers {
  onSelectLine(id: string): void;
  onSelectStation(id: string): void;
  onClose(): void;
}

export class Panel {
  constructor(private el: HTMLElement, private network: Network, private h: PanelHandlers) {
    el.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-line],[data-station],[data-close]');
      if (!target) return;
      if (target.dataset.close !== undefined) this.h.onClose();
      else if (target.dataset.line) this.h.onSelectLine(target.dataset.line);
      else if (target.dataset.station) this.h.onSelectStation(target.dataset.station);
    });
  }

  hide() {
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
  }

  private show(html: string) {
    this.el.innerHTML = `
      <div class="sheet-handle" aria-hidden="true"></div>
      <button class="close" data-close aria-label="Close">✕</button>
      ${html}`;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    this.el.scrollTop = 0;
  }

  showLine(line: Line, km: number | undefined) {
    const op = this.network.operators[line.operator];
    const stops = line.calls.filter((c) => c.stop).length;
    const hasTimes = line.calls.some((c) => c.arr || c.dep);
    const rows = line.calls
      .map((c, i) => {
        const s = this.network.stations[c.station];
        const terminus = i === 0 || i === line.calls.length - 1;
        const cls = c.stop ? (terminus ? 'call stop terminus' : 'call stop') : 'call pass';
        const time = i === line.calls.length - 1 ? c.arr ?? c.dep : c.dep ?? c.arr;
        return `<li class="${cls}">
          <button class="call-btn" data-station="${esc(c.station)}">
            <span class="call-name">${esc(s.name)}</span>
            ${c.stop ? '' : '<span class="call-note">passes through</span>'}
            ${time ? `<span class="call-time">${esc(time)}</span>` : ''}
          </button>
        </li>`;
      })
      .join('');

    const families = classFamilies(line.classes);
    const source =
      line.source === 'back-on-track'
        ? `Data: <a href="https://github.com/Back-on-Track-eu/night-train-data" target="_blank" rel="noopener">Back-on-Track Open Night Train Database</a> (ODbL).
           ${hasTimes ? `Times shown for ${esc(line.trainNumbers[0])}.` : ''} Check with the operator before booking.`
        : 'Day line entered by hand: main stops only, times not filled yet.';

    this.show(`
      <header class="panel-head line-${line.type}">
        <div class="badges">${typeBadge(line)}${seasonalBadge(line)}</div>
        <h2>${esc(line.name)}</h2>
        <p class="meta">
          <span class="train-numbers">${line.trainNumbers.map(esc).join(' · ')}</span><br />
          ${op ? (op.url ? `<a href="${esc(op.url)}" target="_blank" rel="noopener">${esc(op.name)}</a>` : esc(op.name)) : esc(line.operator)}
          ${km ? ` · ${km.toLocaleString('en')} km` : ''} · ${stops} stops
        </p>
      </header>
      <dl class="facts">
        <div><dt>Runs</dt><dd>${esc(line.days)}</dd></div>
        ${families.length ? `<div><dt>On board</dt><dd class="chips">${families.map((f) => `<span class="chip">${f}</span>`).join('')}</dd></div>` : ''}
      </dl>
      <ol class="calls line-${line.type}">${rows}</ol>
      <p class="disclaimer">${source}</p>
    `);
  }

  showStation(stationId: string) {
    const s = this.network.stations[stationId];
    const { stopping, passing } = linesAtStation(this.network, stationId);
    const item = (l: Line) => {
      const call = l.calls.find((c) => c.station === stationId);
      const time = call?.dep ?? call?.arr;
      return `
      <li><button class="line-btn line-${l.type}" data-line="${esc(l.id)}">
        <span class="swatch"></span>
        <span class="line-btn-text">
          <span>${esc(l.name)}</span>
          <small>${esc(l.trainNumbers[0])}${time ? ` · ${esc(time)}` : ''}${l.seasonal ? ' · seasonal' : ''}</small>
        </span>
      </button></li>`;
    };
    const night = stopping.filter((l) => l.type === 'night');
    const day = stopping.filter((l) => l.type === 'day');

    this.show(`
      <header class="panel-head">
        <span class="badge">Station · ${esc(s.country)}</span>
        <h2>${esc(s.name)}</h2>
      </header>
      ${night.length ? `<h3>Night trains</h3><ul class="line-list">${night.map(item).join('')}</ul>` : ''}
      ${day.length ? `<h3>Day trains</h3><ul class="line-list">${day.map(item).join('')}</ul>` : ''}
      ${passing.length ? `<h3>Passing through (no stop)</h3><ul class="line-list muted">${passing.map(item).join('')}</ul>` : ''}
    `);
  }
}
