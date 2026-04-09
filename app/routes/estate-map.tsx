import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router";
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
};

const INITIAL_ENTITIES: Entity[] = [
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
  const canvasRef = useRef<HTMLDivElement>(null);

  const [entities, setEntities] = useState<Entity[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("bfo-estate-map");
      if (saved) {
        try { return JSON.parse(saved); } catch {}
      }
    }
    return INITIAL_ENTITIES;
  });

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

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem("bfo-estate-map", JSON.stringify(entities));
  }, [entities]);

  const getEntityById = useCallback((id: string) => entities.find((e) => e.id === id), [entities]);

  function handleMouseDown(e: React.MouseEvent, entityId: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const entity = getEntityById(entityId);
    if (!entity) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragging(entityId);
    setDragOffset({
      x: (e.clientX - rect.left) / zoom - pan.x - entity.x,
      y: (e.clientY - rect.top) / zoom - pan.y - entity.y,
    });
  }

  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-entity]")) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x * zoom, y: e.clientY - pan.y * zoom });
  }

  function handleMouseMove(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = (e.clientX - rect.left) / zoom - pan.x;
    const my = (e.clientY - rect.top) / zoom - pan.y;
    setMousePos({ x: mx, y: my });

    if (dragging) {
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
    setDragging(null);
    setIsPanning(false);
    setConnecting(null);
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
    setZoom((z) => Math.max(0.3, Math.min(2, z * delta)));
  }

  // Draw connection lines
  function getLines() {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const entity of entities) {
      if (entity.parentId) {
        const parent = getEntityById(entity.parentId);
        if (parent) {
          lines.push({
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
            <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} className={`px-2 py-1 rounded ${btnClass}`}>-</button>
            <span className="w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className={`px-2 py-1 rounded ${btnClass}`}>+</button>
          </div>
        </div>
      </div>
      <p className={`text-sm mb-4 ${isDark ? "text-gray-500" : "text-gray-500"}`}>
        Drag entities to reposition. Right-click for options. Double-click to rename.
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
            {lines.map((line, i) => {
              const midY = (line.y1 + line.y2) / 2;
              return (
                <path
                  key={i}
                  d={`M ${line.x1} ${line.y1} C ${line.x1} ${midY}, ${line.x2} ${midY}, ${line.x2} ${line.y2}`}
                  fill="none"
                  stroke={isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"}
                  strokeWidth={2}
                />
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
                    onClick={(e) => { e.stopPropagation(); handleDeleteEntity(entity.id); }}
                    title="Delete entity"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}

                {/* Disconnect indicator */}
                {isUnconnected && (
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
          Scroll to zoom  |  Drag background to pan  |  Green dot to connect  |  Right-click to disconnect
        </div>
      </div>
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
