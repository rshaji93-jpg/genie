"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import CarromBlitzGame from "./CarromBlitzGame";
import HandCricketGame from "./HandCricketGame";
import QuickGridDuel from "./QuickGridDuel";
import QuickLudoExpress from "./QuickLudoExpress";

type GameId = "carrom-blitz" | "hand-cricket" | "quick-ludo" | "quick-grid";
type GameSnapshot = { state: Record<string, unknown>; version: number };

const GAMES: { id: GameId; label: string }[] = [
  { id: "carrom-blitz", label: "Carrom Blitz" },
  { id: "hand-cricket", label: "Hand Cricket" },
  { id: "quick-ludo", label: "Quick Ludo" },
  { id: "quick-grid", label: "Quick Grid Duel" },
];

export default function RoomGamesDrawer({
  roomId,
  credential,
  playerId,
  onClose,
}: {
  roomId: string;
  credential: string;
  playerId: string;
  onClose: () => void;
}) {
  const [gameId, setGameId] = useState<GameId>("hand-cricket");
  const [snapshot, setSnapshot] = useState<GameSnapshot>({ state: {}, version: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let firstLoad = true;
    const refresh = async () => {
      try {
        const response = await apiRequest(
          `/api/games/state?game_id=${encodeURIComponent(gameId)}&room_id=${encodeURIComponent(roomId)}`,
          { headers: { Authorization: `Bearer ${credential}` }, cache: "no-store" },
        );
        if (!response.ok) throw new Error(`Could not load the room game (${response.status}).`);
        const result = await response.json() as { state: Record<string, unknown>; version: number };
        if (active) {
          setSnapshot((current) => result.version > current.version || firstLoad
            ? { state: result.state, version: result.version }
            : current);
          setError("");
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load room game state.");
      } finally {
        if (active && firstLoad) {
          firstLoad = false;
          setLoading(false);
        }
      }
    };
    setLoading(true);
    setError("");
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [credential, gameId, roomId]);

  async function updateState(state: Record<string, unknown>) {
    setError("");
    try {
      const response = await apiRequest("/api/games/state", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
        body: JSON.stringify({
          game_id: gameId,
          room_id: roomId,
          state,
          expected_version: snapshot.version,
        }),
      });
      if (!response.ok) throw new Error(
        response.status === 409
          ? "Another player updated the game. Switch games and back to refresh."
          : `Game state could not be synced (${response.status}).`,
      );
      const result = await response.json() as GameSnapshot;
      setSnapshot(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Game state could not be synced.");
    }
  }

  return (
    <section aria-label="Room games" className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <strong>Play together</strong>
        <button aria-label="Close games" className="rounded px-2 py-1 text-sm hover:bg-slate-100" onClick={onClose} type="button">Close</button>
      </div>
      <div aria-label="Select a game" className="mb-3 flex flex-wrap gap-2">
        {GAMES.map((game) => (
          <button
            aria-pressed={game.id === gameId}
            className={`rounded-full border px-3 py-1.5 text-xs ${game.id === gameId ? "border-cyan-700 bg-cyan-50 font-semibold" : "bg-white"}`}
            key={game.id}
            onClick={() => setGameId(game.id)}
            type="button"
          >{game.label}</button>
        ))}
      </div>
      {loading ? <p className="text-sm text-slate-500">Loading shared game state…</p> : (
        <>
          {gameId === "carrom-blitz" && <CarromBlitzGame state={snapshot.state} onStateChange={(state) => void updateState(state)} />}
          {gameId === "hand-cricket" && <HandCricketGame playerId={playerId} state={snapshot.state} onStateChange={(state) => void updateState(state)} />}
          {gameId === "quick-ludo" && <QuickLudoExpress state={snapshot.state} onStateChange={(state) => void updateState(state)} />}
          {gameId === "quick-grid" && <QuickGridDuel state={snapshot.state} onStateChange={(state) => void updateState(state)} />}
        </>
      )}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </section>
  );
}
