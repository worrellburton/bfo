import { useState, useRef, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Estate Map" }];
}

type Entity = {
  id: string;
  name: string;
  parentId: string | null;
  x: number;
  y: number;
  color?: string;
  quickBooksRealmId?: string;
  quickBooksName?: string;
};

type QBCompany = { realm_id: string; company_name: string };

export const INITIAL_ENTITIES: Entity[] = [
  // Root
  { id: "bfrt", name: "Burton Family Revocable Trust", parentId: null, x: 600, y: 40, color: "#6366f1" },
  // Level 1
  { id: "ll", name: "Ledger Louise, LLC", parentId: "bfrt", x: 600, y: 160 },
  // Level 2 - Main holding companies
  { id: "smv", name: "Swisshelm Mountain Ventures, LLC", parentId: "ll", x: 150, y: 300 },
  { id: "si", name: "Sundown Investments, LLC", parentId: "ll", x: 450, y: 300 },
  { id: "lb", name: "Ledger Burton, LLC", parentId: "ll", x: 750, y: 300 },
  { id: "wb", name: "Worrell Burton, LLC", parentId: "ll", x: 1050, y: 300 },
  // SMV children
  { id: "acr", name: "Arizona Center for Recovery - A New Direction, LLC", parentId: "smv", x: 80, y: 440 },
  { id: "pl", name: "Persons Lodge LLC (100%)", parentId: "smv", x: 80, y: 520 },
  { id: "bw", name: "Breezewood (100%)", parentId: "smv", x: 80, y: 600 },
  // SI children
  { id: "fdj", name: "FDJ Hesperia, LLC (100%)", parentId: "si", x: 400, y: 440 },
  { id: "cfs", name: "FDJ CFS, LLC (100%)", parentId: "si", x: 400, y: 520 },
  { id: "prb", name: "Palomino Ranch on the Bend, LLC (100%)", parentId: "si", x: 400, y: 600 },
  // LB children
  { id: "vq", name: "VQ National", parentId: "lb", x: 720, y: 440 },
  // WB children
  { id: "cd", name: "Catalog Digital, Inc", parentId: "wb", x: 1020, y: 440 },
  { id: "ah", name: "Atlas Hydration, Inc", parentId: "wb", x: 1020, y: 520 },
  // Unconnected
  { id: "qla", name: "Quail Lakes Apartments, LLC", parentId: null, x: 550, y: 720, color: "#f59e0b" },
  { id: "hsl", name: "HSL TP Hotel, LLC", parentId: null, x: 780, y: 720, color: "#ef4444" },
  { id: "hslp", name: "HSL Placita West Ltd Partnership", parentId: null, x: 1010, y: 720, color: "#8b5cf6" },
];

const NODE_W = 240;
const NODE_H = 52;

export default function EstateMap() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [entities, setEntities] = useState<Entity[]>(INITIAL_ENTITIES);
  const loaded = useRef(false);
  const skipNextSave = useRef(false);

  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connecting, setConnecting] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [qbCompanies, setQbCompanies] = useState<QBCompany[]>([]);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [assetIdByName, setAssetIdByName] = useState<Record<string, string>>({});
  const [mouseDownScreen, setMouseDownScreen] = useState<{ x: number; y: number } | null>(null);
  const [didDrag, setDidDrag] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  // Subscribe to Firebase for real-time shared estate map
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue, get, set } = await import("firebase/database");

      // Seed initial entities if nothing exists yet
      try {
        const snap = await get(ref(db, "estate-map/entities"));
        if (!snap.exists()) {
          await set(ref(db, "estate-map/entities"), INITIAL_ENTITIES);
        }
      } catch (err) {
        console.error("Estate map seed error:", err);
      }

      unsubscribe = onValue(ref(db, "estate-map/entities"), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          // Firebase may return an array or object — normalize to array
          const arr: Entity[] = Array.isArray(data)
            ? data.filter(Boolean)
            : Object.values(data);
          skipNextSave.current = true;
          setEntities(arr);
        }
        loaded.current = true;
      });
    }
    setup();
    return () => unsubscribe?.();
  }, []);

  // Debounced save to Firebase — skip while dragging or when echoing a remote update
  useEffect(() => {
    if (!loaded.current) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (dragging) return;
    const timer = setTimeout(async () => {
      try {
        const { db } = await import("../firebase");
        const { ref, set } = await import("firebase/database");
        await set(ref(db, "estate-map/entities"), entities);
      } catch (err) {
        console.error("Estate map save error:", err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [entities, dragging]);

  // Fetch connected QuickBooks companies
  useEffect(() => {
    async function loadQB() {
      try {
        const res = await fetch("/api/quickbooks/data?report=list");
        const data = await res.json();
        const list: { realm_id: string; company_name: string }[] = data?.companies || [];
        // Resolve company names for each
        const resolved = await Promise.all(
          list.map(async (c) => {
            if (c.company_name) return c;
            try {
              const infoRes = await fetch(`/api/quickbooks/data?report=company-info&realm_id=${c.realm_id}`);
              const info = await infoRes.json();
              return { realm_id: c.realm_id, company_name: info?.CompanyInfo?.CompanyName || c.realm_id };
            } catch {
              return { realm_id: c.realm_id, company_name: c.realm_id };
            }
          })
        );
        setQbCompanies(resolved);
      } catch {
        setQbCompanies([]);
      }
    }
    loadQB();
  }, []);

  // Subscribe to Firebase assets and build a name -> id lookup.
  // Seed any Estate Map entities that don't exist as assets yet.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let seeded = false;
    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue, push, get } = await import("firebase/database");

      // One-time seed: create any missing entities as assets
      if (!seeded && !localStorage.getItem("bfo-assets-seeded-v1")) {
        seeded = true;
        try {
          const snap = await get(ref(db, "assets"));
          const existing = snap.val() || {};
          const existingNames = new Set<string>(
            Object.values(existing).map((a: any) => (a?.name || "").toLowerCase())
          );
          for (const ent of INITIAL_ENTITIES) {
            if (!existingNames.has(ent.name.toLowerCase())) {
              const lower = ent.name.toLowerCase();
              const type = lower.includes("inc") && !lower.includes("llc") ? "C-Corp" : "LLC";
              await push(ref(db, "assets"), {
                name: ent.name,
                type,
                state: "",
                ein: "",
                createdAt: Date.now(),
              });
            }
          }
          localStorage.setItem("bfo-assets-seeded-v1", "1");
        } catch (err) {
          console.error("Estate seed error:", err);
        }
      }

      unsubscribe = onValue(ref(db, "assets"), (snapshot) => {
        const data = snapshot.val();
        const map: Record<string, string> = {};
        if (data) {
          for (const [id, value] of Object.entries(data)) {
            const name = (value as any)?.name;
            if (name) map[name.toLowerCase()] = id;
          }
        }
        setAssetIdByName(map);
      });
    }
    setup();
    return () => unsubscribe?.();
  }, []);

  function handleAttachQB(entityId: string, realmId: string | null) {
    const company = realmId ? qbCompanies.find((c) => c.realm_id === realmId) : null;
    setEntities((prev) =>
      prev.map((e) =>
        e.id === entityId
          ? {
              ...e,
              quickBooksRealmId: realmId || undefined,
              quickBooksName: company?.company_name || undefined,
            }
          : e
      )
    );
    setAttachingId(null);
  }

  const getEntityById = useCallback((id: string) => entities.find((e) => e.id === id), [entities]);

  function handleMouseDown(e: React.MouseEvent, entityId: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const entity = getEntityById(entityId);
    if (!entity) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragging(entityId);
    setMouseDownScreen({ x: e.clientX, y: e.clientY });
    setDidDrag(false);
    setDragOffset({
      x: (e.clientX - rect.left) / zoom - pan.x - entity.x,
      y: (e.clientY - rect.top) / zoom - pan.y - entity.y,
    });
  }

  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-entity]")) return;
    if ((e.target as HTMLElement).closest("[data-line]")) return;
    setSelectedLineId(null);
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x * zoom, y: e.clientY - pan.y * zoom });
  }

  function handleMouseMove(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = (e.clientX - rect.left) / zoom - pan.x;
    const my = (e.clientY - rect.top) / zoom - pan.y;
    setMousePos({ x: mx, y: my });

    // Track whether a drag has occurred (>4px screen movement)
    if (dragging && mouseDownScreen && !didDrag) {
      const dx = e.clientX - mouseDownScreen.x;
      const dy = e.clientY - mouseDownScreen.y;
      if (dx * dx + dy * dy > 16) setDidDrag(true);
    }

    if (dragging && didDrag) {
      setEntities((prev) =>
        prev.map((ent) =>
          ent.id === dragging
            ? { ...ent, x: mx - dragOffset.x, y: my - dragOffset.y }
            : ent
        )
      );
    }
    if (isPanning) {
      setPan({
        x: (e.clientX - panStart.x) / zoom,
        y: (e.clientY - panStart.y) / zoom,
      });
    }
  }

  function handleMouseUp() {
    if (dragging && connecting) {
      // Find entity under cursor
      const target = entities.find(
        (e) =>
          e.id !== connecting &&
          mousePos.x >= e.x &&
          mousePos.x <= e.x + NODE_W &&
          mousePos.y >= e.y &&
          mousePos.y <= e.y + NODE_H
      );
      if (target) {
        // Set connecting entity's parent to target
        setEntities((prev) =>
          prev.map((e) => (e.id === connecting ? { ...e, parentId: target.id } : e))
        );
      }
    }

    // Click (not a drag) — navigate to the entity's asset detail page
    if (dragging && !didDrag && !connecting) {
      const entity = getEntityById(dragging);
      if (entity) {
        const assetId = assetIdByName[entity.name.toLowerCase()];
        if (assetId) navigate(`/assets/${assetId}`);
      }
    }

    setDragging(null);
    setIsPanning(false);
    setConnecting(null);
    setMouseDownScreen(null);
    setDidDrag(false);
  }

  function handleConnectStart(e: React.MouseEvent, entityId: string) {
    e.stopPropagation();
    setConnecting(entityId);
  }

  function handleDisconnect(entityId: string) {
    setEntities((prev) =>
      prev.map((e) => (e.id === entityId ? { ...e, parentId: null } : e))
    );
  }

  function handleDoubleClick(e: React.MouseEvent, entityId: string) {
    e.stopPropagation();
    const entity = getEntityById(entityId);
    if (!entity) return;
    setEditingId(entityId);
    setEditName(entity.name);
  }

  function handleEditSubmit() {
    if (editingId && editName.trim()) {
      setEntities((prev) =>
        prev.map((e) => (e.id === editingId ? { ...e, name: editName.trim() } : e))
      );
    }
    setEditingId(null);
  }

  function handleAddEntity() {
    const id = `entity-${Date.now()}`;
    setEntities((prev) => [
      ...prev,
      { id, name: "New Entity", parentId: null, x: -pan.x + 400, y: -pan.y + 400 },
    ]);
  }

  function handleDeleteEntity(entityId: string) {
    setEntities((prev) => {
      // Remove entity and disconnect its children
      return prev
        .filter((e) => e.id !== entityId)
        .map((e) => (e.parentId === entityId ? { ...e, parentId: null } : e));
    });
  }

  function handleReset() {
    if (confirm("Reset estate map to default layout?")) {
      setEntities(INITIAL_ENTITIES);
      setPan({ x: 0, y: 0 });
      setZoom(1);
    }
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.6, Math.min(2, z * delta)));
  }

  // Keyboard: Delete/Backspace removes selected connection, Escape clears selection
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedLineId) {
        e.preventDefault();
        handleDisconnect(selectedLineId);
        setSelectedLineId(null);
      } else if (e.key === "Escape") {
        setSelectedLineId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLineId]);

  // Draw connection lines
  function getLines() {
    const lines: { childId: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const entity of entities) {
      if (entity.parentId) {
        const parent = getEntityById(entity.parentId);
        if (parent) {
          lines.push({
            childId: entity.id,
            x1: parent.x + NODE_W / 2,
            y1: parent.y + NODE_H,
            x2: entity.x + NODE_W / 2,
            y2: entity.y,
          });
        }
      }
    }
    return lines;
  }

  const lines = getLines();

  const btnClass = isDark
    ? "border border-white/10 hover:border-white/20 text-gray-400 hover:text-white"
    : "border border-gray-200 hover:border-gray-400 text-gray-500 hover:text-gray-900";

  return (
    <div>
      <style>{`
        @keyframes qb-pulse {
          0%, 100% {
            box-shadow: 0 0 6px rgba(34,197,94,0.8), 0 0 12px rgba(34,197,94,0.6), 0 0 20px rgba(34,197,94,0.4);
          }
          50% {
            box-shadow: 0 0 10px rgba(34,197,94,1), 0 0 20px rgba(34,197,94,0.8), 0 0 30px rgba(34,197,94,0.6);
          }
        }
      `}</style>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Link to="/" className={`${isDark ? "text-gray-500 hover:text-white" : "text-gray-400 hover:text-gray-900"} transition-colors`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Estate Map</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleAddEntity} className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${btnClass}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Entity
          </button>
          <button onClick={handleReset} className={`text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${btnClass}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Reset
          </button>
          <div className={`flex items-center gap-1 text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}>
            <button onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))} className={`px-2 py-1 rounded ${btnClass}`}>-</button>
            <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className={`px-2 py-1 rounded ${btnClass}`}>+</button>
          </div>
        </div>
      </div>
      <p className={`text-sm mb-4 ${isDark ? "text-gray-500" : "text-gray-500"}`}>
        Click to open entity page. Drag to reposition. Double-click to rename. Click a line then press Delete to remove.
      </p>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={`rounded-xl border overflow-hidden cursor-grab active:cursor-grabbing ${isDark ? "border-white/10 bg-[#0a0a0f]" : "border-gray-200 bg-gray-50"}`}
        style={{ height: "calc(100vh - 160px)", position: "relative" }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          style={{
            transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
            transformOrigin: "0 0",
            position: "absolute",
            inset: 0,
          }}
        >
          {/* SVG Connection Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ width: "3000px", height: "2000px" }}>
            {lines.map((line) => {
              const midY = (line.y1 + line.y2) / 2;
              const d = `M ${line.x1} ${line.y1} C ${line.x1} ${midY}, ${line.x2} ${midY}, ${line.x2} ${line.y2}`;
              const isSelected = selectedLineId === line.childId;
              return (
                <g key={line.childId} data-line style={{ pointerEvents: "auto" }}>
                  {/* Wide invisible hit area */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    style={{ cursor: "pointer" }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSelectedLineId(line.childId);
                    }}
                  />
                  {/* Visible stroke */}
                  <path
                    d={d}
                    fill="none"
                    stroke={
                      isSelected
                        ? "#3b82f6"
                        : isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"
                    }
                    strokeWidth={isSelected ? 3 : 2}
                    style={{ pointerEvents: "none" }}
                  />
                </g>
              );
            })}
            {/* Active connecting line */}
            {connecting && (
              <line
                x1={(() => {
                  const e = getEntityById(connecting);
                  return e ? e.x + NODE_W / 2 : 0;
                })()}
                y1={(() => {
                  const e = getEntityById(connecting);
                  return e ? e.y + NODE_H : 0;
                })()}
                x2={mousePos.x}
                y2={mousePos.y}
                stroke="#22c55e"
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            )}
          </svg>

          {/* Entity Nodes */}
          {entities.map((entity) => {
            const isRoot = entity.parentId === null && !["qla", "hsl", "hslp"].includes(entity.id) && entity.id === "bfrt";
            const isUnconnected = entity.parentId === null && entity.id !== "bfrt";
            const depth = getDepth(entity, entities);
            const nodeColor = entity.color || (depth === 0 ? "#6366f1" : depth === 1 ? "#3b82f6" : undefined);

            return (
              <div
                key={entity.id}
                data-entity
                className={`absolute select-none group ${dragging === entity.id ? "z-20" : "z-10"}`}
                style={{
                  left: entity.x,
                  top: entity.y,
                  width: NODE_W,
                }}
                onMouseDown={(e) => handleMouseDown(e, entity.id)}
                onDoubleClick={(e) => handleDoubleClick(e, entity.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDisconnect(entity.id);
                }}
              >
                <div
                  className={`rounded-lg border-2 px-3 py-2.5 text-center text-xs font-medium transition-shadow cursor-move ${
                    dragging === entity.id ? "shadow-xl" : "shadow-sm hover:shadow-md"
                  } ${
                    isDark
                      ? "bg-[#141419] border-white/15 text-gray-200 hover:border-white/30"
                      : "bg-white border-gray-300 text-gray-800 hover:border-gray-500"
                  }`}
                  style={nodeColor ? {
                    borderColor: nodeColor + (isDark ? "60" : "80"),
                    background: isDark ? nodeColor + "10" : nodeColor + "08",
                  } : undefined}
                >
                  {editingId === entity.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={handleEditSubmit}
                      onKeyDown={(e) => { if (e.key === "Enter") handleEditSubmit(); if (e.key === "Escape") setEditingId(null); }}
                      className={`w-full text-center text-xs bg-transparent border-b outline-none ${isDark ? "border-white/30 text-white" : "border-gray-400 text-gray-900"}`}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="leading-tight block" title={entity.name}>
                      {entity.name.length > 40 ? entity.name.slice(0, 37) + "..." : entity.name}
                    </span>
                  )}
                </div>

                {/* Connect handle (bottom) */}
                <div
                  className={`absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-crosshair flex items-center justify-center ${
                    isDark ? "bg-green-500 border-2 border-[#141419]" : "bg-green-500 border-2 border-white"
                  }`}
                  onMouseDown={(e) => handleConnectStart(e, entity.id)}
                  title="Drag to connect"
                >
                  <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16" /></svg>
                </div>

                {/* Delete button */}
                {!isRoot && (
                  <button
                    className={`absolute -top-2 -right-2 w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center ${
                      isDark ? "bg-red-500/80 text-white hover:bg-red-500" : "bg-red-500 text-white hover:bg-red-600"
                    }`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); handleDeleteEntity(entity.id); }}
                    title="Delete entity"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}

                {/* QuickBooks attach button (top-left) */}
                <button
                  className={`absolute -top-2 -left-2 w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center ${
                    entity.quickBooksRealmId
                      ? "bg-green-500 text-white hover:bg-green-600"
                      : isDark ? "bg-blue-500/80 text-white hover:bg-blue-500" : "bg-blue-500 text-white hover:bg-blue-600"
                  }`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setAttachingId(entity.id); }}
                  title={entity.quickBooksRealmId ? `QuickBooks: ${entity.quickBooksName}` : "Attach QuickBooks"}
                >
                  <span className="text-[8px] font-bold leading-none">QB</span>
                </button>

                {/* Persistent glowing QuickBooks logo when attached */}
                {entity.quickBooksRealmId && (
                  <div
                    className="absolute -bottom-7 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full flex items-center justify-center bg-white"
                    style={{
                      boxShadow:
                        "0 0 8px rgba(34,197,94,0.9), 0 0 16px rgba(34,197,94,0.7), 0 0 24px rgba(34,197,94,0.5)",
                      animation: "qb-pulse 2s ease-in-out infinite",
                    }}
                    title={entity.quickBooksName || "QuickBooks"}
                  >
                    <img
                      src="https://cdn.brandfetch.io/quickbooks.com?c=1id3n10pdBTarCHI0db"
                      alt="QuickBooks"
                      className="w-4 h-4 object-contain"
                      draggable={false}
                    />
                  </div>
                )}

                {/* Disconnect indicator */}
                {isUnconnected && !entity.quickBooksRealmId && (
                  <div className={`absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${
                    isDark ? "bg-amber-500/20 text-amber-400" : "bg-amber-100 text-amber-600"
                  }`}>
                    unlinked
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Instructions overlay */}
        <div className={`absolute bottom-3 left-3 text-[10px] px-2.5 py-1.5 rounded-lg ${isDark ? "bg-black/60 text-gray-400" : "bg-white/80 text-gray-500 border border-gray-200"}`}>
          Click to open  |  Drag to move  |  Scroll to zoom  |  Green dot to connect  |  Click line + Delete to remove
        </div>
      </div>

      {/* Attach QuickBooks modal */}
      {attachingId && (() => {
        const entity = getEntityById(attachingId);
        if (!entity) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setAttachingId(null)}>
            <div className="absolute inset-0 bg-black/60" />
            <div
              onClick={(e) => e.stopPropagation()}
              className={`relative w-full max-w-md rounded-xl shadow-2xl border ${
                isDark ? "bg-[#141419] border-white/10" : "bg-white border-gray-200"
              }`}
            >
              <div className={`p-5 border-b ${isDark ? "border-white/10" : "border-gray-200"}`}>
                <h3 className={`font-semibold text-sm ${isDark ? "text-white" : "text-gray-900"}`}>Attach QuickBooks Account</h3>
                <p className={`text-xs mt-1 ${isDark ? "text-gray-500" : "text-gray-500"}`}>{entity.name}</p>
              </div>
              <div className="p-5">
                {qbCompanies.length === 0 ? (
                  <div className={`text-center py-6 ${isDark ? "text-gray-500" : "text-gray-500"}`}>
                    <p className="text-xs mb-3">No QuickBooks accounts connected.</p>
                    <Link
                      to="/tools/quickbooks"
                      className={`text-xs underline ${isDark ? "text-blue-400" : "text-blue-600"}`}
                    >
                      Connect QuickBooks
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-80 overflow-y-auto">
                    {qbCompanies.map((c) => {
                      const isCurrent = entity.quickBooksRealmId === c.realm_id;
                      return (
                        <button
                          key={c.realm_id}
                          onClick={() => handleAttachQB(entity.id, c.realm_id)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg text-xs transition-colors flex items-center justify-between ${
                            isCurrent
                              ? isDark ? "bg-green-500/15 text-green-400 border border-green-500/30" : "bg-green-50 text-green-700 border border-green-300"
                              : isDark ? "hover:bg-white/5 text-gray-300 border border-white/5" : "hover:bg-gray-50 text-gray-700 border border-gray-200"
                          }`}
                        >
                          <span className="truncate">{c.company_name}</span>
                          {isCurrent && (
                            <svg className="w-4 h-4 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className={`p-4 border-t flex items-center justify-between ${isDark ? "border-white/10" : "border-gray-200"}`}>
                {entity.quickBooksRealmId ? (
                  <button
                    onClick={() => handleAttachQB(entity.id, null)}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                      isDark ? "text-red-400 hover:bg-red-500/10 border border-red-500/20" : "text-red-600 hover:bg-red-50 border border-red-200"
                    }`}
                  >
                    Detach
                  </button>
                ) : <span />}
                <button
                  onClick={() => setAttachingId(null)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${btnClass}`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function getDepth(entity: Entity, entities: Entity[]): number {
  let depth = 0;
  let current = entity;
  while (current.parentId) {
    const parent = entities.find((e) => e.id === current.parentId);
    if (!parent) break;
    current = parent;
    depth++;
  }
  return depth;
}
