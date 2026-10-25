"use client";

type LudoState = Record<string, unknown> & { tokens?: number[][]; currentPlayer?: number };

export default function QuickLudoExpress({
  state,
  onStateChange,
}: {
  state: LudoState;
  onStateChange: (next: LudoState) => void;
}) {
  const tokens = Array.isArray(state.tokens) && Array.isArray(state.tokens[0])
    ? state.tokens
    : [[0, 0], [0, 0], [0, 0], [0, 0]];
  const currentPlayer = typeof state.currentPlayer === "number" ? state.currentPlayer : 0;
  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50 p-3">
      <strong>Quick Ludo Express</strong>
      <p className="my-2 text-sm">Two-token race for 2–4 room friends.</p>
      <div className="mb-2 flex gap-2">
        {[2, 3, 4].map((count) => (
          <button
            aria-pressed={tokens.length === count}
            className="rounded border bg-white px-2 py-1 text-xs"
            key={count}
            onClick={() => onStateChange({
              tokens: Array.from({ length: count }, () => [0, 0]),
              currentPlayer: 0,
            })}
            type="button"
          >{count} players</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tokens.map((playerTokens, player) => (
          <div className={`rounded-lg border p-2 ${player === currentPlayer ? "border-violet-500 bg-white" : "border-transparent bg-white/70"}`} key={player}>
            <strong className="text-sm">Player {player + 1}</strong>
            {playerTokens.map((position, token) => (
              <button
                aria-label={`Move player ${player + 1} token ${token + 1}`}
                className="mt-1 block w-full rounded border px-2 py-1 text-xs"
                disabled={player !== currentPlayer || position >= 24}
                key={token}
                onClick={() => {
                  const next = tokens.map((items) => [...items]);
                  next[player][token] = Math.min(24, position + 1);
                  onStateChange({ tokens: next, currentPlayer: (player + 1) % tokens.length });
                }}
                type="button"
              >Token {token + 1} · {position}/24</button>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs">Move one token on your turn; first player to finish both wins.</p>
    </section>
  );
}
