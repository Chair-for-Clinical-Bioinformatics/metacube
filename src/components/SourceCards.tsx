import { Fragment, useMemo } from "react";
import type { InfoEntry } from "../data/dataModel";
import {
  CARD_BG, CARD_BG_ACTIVE, PANEL_BORDER, TEXT_BODY, TEXT_MUTED, TEXT_DIM, ACCENT,
} from "../data/theme";

// Info-box cards, one per publication. Entries that share a `title` are grouped
// into a single card listing their datasets, so a publication split into several
// datasets appears once. Clicking a card selects its source(s); when the source
// unit is finer than the card (one source per dataset row), a row click selects
// just that source. The caller highlights the cube cells containing the selection.

/** Id used to select/highlight an entry's source: the source column value
 *  (`_source`, added by the transform), else the `dataset` field. */
export function sourceId(e: InfoEntry): string | undefined {
  return e._source ?? e.dataset ?? undefined;
}

/** Toggle a set of source ids: deselect them if all are selected, else select all. */
export function toggleSources(prev: Set<string>, ids: string[]): Set<string> {
  const next = new Set(prev);
  if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
  else ids.forEach((id) => next.add(id));
  return next;
}

/** Keys ("x|y|z") of cells whose per-cell treemap contains any selected source. */
export function cellsWithSources(
  treemaps: Record<string, { d: string }[]> | undefined,
  selected: Set<string>,
): Set<string> | undefined {
  if (!treemaps || selected.size === 0) return undefined;
  const out = new Set<string>();
  for (const [key, entries] of Object.entries(treemaps)) {
    if (entries.some((e) => selected.has(e.d))) out.add(key);
  }
  return out.size > 0 ? out : undefined;
}

/** Total magnitude per source in a list of treemap entries. */
export function sourceTotals(entries: { d: string; n: number }[] | null | undefined): Map<string, number> | undefined {
  if (!entries || entries.length === 0) return undefined;
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.d, (m.get(e.d) ?? 0) + e.n);
  return m;
}

interface Group {
  key: string;
  heading?: string;
  /** Fields identical for every member (citation, doi, …), shown once. */
  shared: [string, string][];
  members: InfoEntry[];
  size: number;
}

const HIDDEN = (k: string) => k.startsWith("_") || k === "title" || k === "dataset";

export function groupEntries(entries: InfoEntry[], sizes?: Map<string, number>): Group[] {
  const groups = new Map<string, InfoEntry[]>();
  entries.forEach((e, i) => {
    const key = e.title ? `t:${e.title}` : `e:${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  });
  const sizeOf = (e: InfoEntry) => sizes?.get(sourceId(e) ?? "") ?? 0;
  return [...groups.entries()].map(([key, members]) => {
    members.sort((a, b) => sizeOf(b) - sizeOf(a) || String(a.dataset ?? "").localeCompare(String(b.dataset ?? "")));
    const first = members[0];
    const shared = Object.entries(first).filter(([k, v]) =>
      !!v && !HIDDEN(k) && members.every((m) => m[k] === v)) as [string, string][];
    return {
      key,
      heading: first.title ?? (members.length === 1 ? first.dataset : undefined),
      shared,
      members,
      // Each source counted once (rows of one publication share its source id).
      size: [...new Set(members.map((m) => sourceId(m) ?? ""))]
        .reduce((s, id) => s + (sizes?.get(id) ?? 0), 0),
    };
  }).sort((a, b) => b.size - a.size || b.members.length - a.members.length
    || String(a.heading ?? "").localeCompare(String(b.heading ?? "")));
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function FieldValue({ k, v, fontSize }: { k: string; v: string; fontSize: number }) {
  const isDoi = k === "doi";
  if (isDoi || k === "url") {
    return (
      <a href={isDoi ? `https://doi.org/${v}` : v} target="_blank" rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{ color: ACCENT, textDecoration: "none", wordBreak: "break-all", fontSize }}>{v}</a>
    );
  }
  const n = parseFloat(v);
  const display = !isNaN(n) && Number.isInteger(n) && String(n) !== v ? String(n) : v;
  return <span style={{ color: TEXT_BODY, wordBreak: "break-word", fontSize }}>{display}</span>;
}

export function SourceCards({
  entries, sizes, countLabel, selected, onToggle, hovered, onHover, size = "small", maxGroups, columns,
}: {
  entries: InfoEntry[];
  /** Magnitude per source id (e.g. cells), used for sorting and shown per source. */
  sizes?: Map<string, number>;
  countLabel?: string;
  selected?: Set<string>;
  /** Toggle these source ids in the highlight selection. */
  onToggle?: (ids: string[]) => void;
  /** Source id hovered elsewhere (e.g. a treemap tile) — its card is highlighted. */
  hovered?: string | null;
  onHover?: (id: string | null) => void;
  size?: "small" | "large";
  /** Figure capture: cap the number of cards. */
  maxGroups?: number;
  /** Figure capture: lay cards out in CSS columns. */
  columns?: number;
}) {
  const groups = useMemo(() => groupEntries(entries, sizes), [entries, sizes]);
  const shown = maxGroups ? groups.slice(0, maxGroups) : groups;
  const fs = size === "large" ? 12 : 11;
  const unit = countLabel ? ` ${countLabel}` : "";

  return (
    <div
      data-testid="info-box"
      style={columns
        ? { columnCount: columns, columnGap: 14 }
        : { display: "flex", flexDirection: "column", gap: size === "large" ? 10 : 5 }}
    >
      {shown.map((g) => {
        const ids = [...new Set(g.members.map(sourceId).filter((x): x is string => !!x))];
        // Rows are separately selectable only if each row is its own source.
        const rowsAreSources = ids.length > 1;
        const nSel = ids.filter((id) => selected?.has(id)).length;
        const active = ids.length > 0 && nSel === ids.length;
        const partial = nSel > 0 && !active;
        const isHovered = !!hovered && ids.includes(hovered);
        const clickable = !!onToggle && ids.length > 0;
        const listMembers = g.members.length > 1 || (g.members[0].title && g.members[0].dataset);
        return (
          <div key={g.key}
            onClick={clickable ? () => onToggle!(ids) : undefined}
            onMouseEnter={onHover && ids.length === 1 ? () => onHover(ids[0]) : undefined}
            onMouseLeave={onHover && ids.length === 1 ? () => onHover(null) : undefined}
            title={clickable ? "Click to highlight the cube cells containing this publication" : undefined}
            style={{
              padding: size === "large" ? "10px 12px" : "7px 9px",
              background: active || isHovered ? CARD_BG_ACTIVE : CARD_BG,
              border: active ? `1.5px solid ${ACCENT}` : partial || isHovered ? `1.5px dashed ${ACCENT}` : `1px solid ${PANEL_BORDER}`,
              borderRadius: size === "large" ? 8 : 6,
              cursor: clickable ? "pointer" : "default",
              ...(columns ? { breakInside: "avoid" as const, marginBottom: 8 } : {}),
            }}
          >
            {g.heading && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
                <span style={{ fontWeight: 700, fontSize: fs + 0.5, color: TEXT_BODY, wordBreak: "break-word" }}>{g.heading}</span>
                {!rowsAreSources && g.size > 0 && (
                  <span style={{ flexShrink: 0, fontSize: fs - 0.5, color: TEXT_DIM }}>{fmt(g.size)}{unit}</span>
                )}
              </div>
            )}
            {g.shared.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", rowGap: 2, columnGap: 8 }}>
                {g.shared.map(([k, v]) => (
                  <Fragment key={k}>
                    <span style={{ color: TEXT_DIM, fontWeight: 600, textTransform: "capitalize", fontSize: fs }}>{k}</span>
                    <FieldValue k={k} v={v} fontSize={fs} />
                  </Fragment>
                ))}
              </div>
            )}
            {listMembers && (
              <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 2 }}>
                {g.members.map((m, i) => {
                  const id = rowsAreSources ? sourceId(m) : undefined;
                  const on = rowsAreSources ? !!id && !!selected?.has(id) : active;
                  const n = id ? sizes?.get(id) : undefined;
                  return (
                    <div key={i}
                      onClick={onToggle && id ? (e) => { e.stopPropagation(); onToggle([id]); } : undefined}
                      onMouseEnter={onHover && id ? () => onHover(id) : undefined}
                      onMouseLeave={onHover && id ? () => onHover(null) : undefined}
                      title={onToggle && id ? "Click to highlight only this dataset" : undefined}
                      style={{
                        display: "flex", justifyContent: "space-between", gap: 8,
                        fontSize: fs - 0.5, color: on ? ACCENT : TEXT_MUTED,
                        fontWeight: on ? 600 : 400,
                        padding: "1px 4px", borderRadius: 3,
                        background: on ? CARD_BG : "transparent",
                        cursor: onToggle && (id || clickable) ? "pointer" : "default",
                      }}
                    >
                      <span style={{ wordBreak: "break-word" }}>{m.dataset ?? sourceId(m)}</span>
                      {n != null && <span style={{ flexShrink: 0, color: TEXT_DIM }}>{fmt(n)}{unit}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {maxGroups && groups.length > shown.length && (
        <div style={{ breakInside: "avoid", fontSize: 11, color: TEXT_DIM, fontStyle: "italic", padding: "4px 2px" }}>
          + {groups.length - shown.length} more
        </div>
      )}
    </div>
  );
}
